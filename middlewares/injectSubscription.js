const Subscription = require("../db/models/subscription.model");
const User = require("../db/models/user.model");
const { getPlan } = require("../utils/planLimits");

/**
 * Révoque isPremium en DB + en mémoire si nécessaire.
 * Appelé quand l'abonnement est expiré ou inexistant.
 */
async function revokePremium(req) {
  // Ne jamais révoquer un accès accordé manuellement (bêta testeurs)
  if (req.user && req.user.manualPremium) return;
  // Ne pas révoquer si l'utilisateur a un plan payant dans son User doc
  // (protège contre la désynchronisation entre Subscription collection et User doc)
  const embeddedPlan = req.user?.subscription?.plan;
  if (["pro", "business"].includes(embeddedPlan)) return;
  if (req.user && req.user.isPremium) {
    req.user.isPremium = false;
    await User.findByIdAndUpdate(req.user._id, { isPremium: false });
  }
}

module.exports = async (req, res, next) => {
  try {
    if (!req.user) {
      return next();
    }

    // ── Bypass manuel : bêta testeurs avec manualPremium=true (prod + dev)
    if (req.user.manualPremium) {
      const expiry = req.user.manualPremiumExpiry;
      const now    = new Date();

      // Si la durée de test est dépassée → révoquer automatiquement
      if (expiry && new Date(expiry) < now) {
        await User.findByIdAndUpdate(req.user._id, {
          manualPremium: false,
          isPremium: false,
          manualPremiumExpiry: null,
          "subscription.status": "inactive",
        });
        req.user.manualPremium = false;
        req.user.isPremium     = false;
        // Fall through → sera traité comme free ci-dessous
      } else {
        if (!req.user.isPremium) {
          await User.findByIdAndUpdate(req.user._id, { isPremium: true });
          req.user.isPremium = true;
        }

        const diffMs    = expiry ? new Date(expiry) - now : null;
        const diffDays  = diffMs !== null ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : null;
        const diffHours = diffMs !== null ? Math.ceil(diffMs / (1000 * 60 * 60)) : null;

        res.locals.isPro         = true;
        res.locals.currentPlan   = (req.user.subscription && req.user.subscription.plan) || "pro";
        res.locals.subscription  = null;
        res.locals.autoRenew     = false;
        res.locals.isExpired     = false;
        res.locals.isBetaAccess  = true;

        if (diffDays === null) {
          // Accès infini
          res.locals.daysLeft   = null;
          res.locals.hoursLeft  = null;
          res.locals.isExpiring = false;
        } else if (diffDays <= 1) {
          res.locals.daysLeft   = 0;
          res.locals.hoursLeft  = diffHours > 0 ? diffHours : 1;
          res.locals.isExpiring = true;
        } else {
          res.locals.daysLeft   = diffDays;
          res.locals.hoursLeft  = null;
          res.locals.isExpiring = diffDays <= 3;
        }

        return next();
      }
    }

    // (Ancien bypass dev qui figeait daysLeft à 999 en permanence — supprimé.
    // Le flux unifié ci-dessous (recherche Subscription, sinon fallback sur
    // manualPremiumExpiry) calcule maintenant un vrai compte à rebours dans
    // TOUS les cas, dev comme prod — plus besoin de cas spécial.)

    const subscription = await Subscription.findOne({
      user: req.user._id,
      status: "active",
    }).lean();

    if (subscription) {
      const now = new Date();
      const diffMs    = new Date(subscription.endDate) - now;
      const diffDays  = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));

      // ── Sync req.user so getLimit()/getPlan() see the correct plan ──
      // The embedded user.subscription may lag behind the Subscription collection
      // (e.g. webhook not yet written). Overwrite in-memory so all controllers
      // calling getPlan(req.user) get the right result for this request.
      if (req.user.subscription) {
        req.user.subscription.status = "active";
        req.user.subscription.plan   = subscription.plan || "pro";
      } else {
        req.user.subscription = { status: "active", plan: subscription.plan || "pro" };
      }

      res.locals.subscription = subscription;
      res.locals.autoRenew    = subscription.autoRenew;
      res.locals.currentPlan  = subscription.plan || "pro";

      if (diffMs <= 0) {
        // ── Abonnement expiré ──
        res.locals.isPro      = false;
        res.locals.currentPlan = "basic";
        res.locals.daysLeft   = 0;
        res.locals.hoursLeft  = 0;
        res.locals.isExpired  = true;
        res.locals.isExpiring = false;
        await revokePremium(req); // DB + mémoire
      } else if (diffDays <= 1) {
        // ── Moins de 24h restantes ──
        res.locals.isPro      = true;
        res.locals.daysLeft   = 0;
        res.locals.hoursLeft  = diffHours > 0 ? diffHours : 1;
        res.locals.isExpired  = false;
        res.locals.isExpiring = true;
      } else {
        res.locals.isPro      = true;
        res.locals.daysLeft   = diffDays;
        res.locals.hoursLeft  = null;
        res.locals.isExpired  = false;
        res.locals.isExpiring = diffDays <= 3;
      }
    } else {
      // ── Pas de doc Subscription actif dans la collection ──
      // Fallback : si User doc a un plan payant (même si isPremium est faux à cause de revokePremium)
      // On vérifie subscription.status = "active" ET plan valide dans le User doc
      const embeddedPlan   = req.user.subscription?.plan;
      const embeddedStatus = req.user.subscription?.status;
      const validPlans     = ["pro", "business"];
      const hasPremiumUser = validPlans.includes(embeddedPlan) &&
        (embeddedStatus === "active" || req.user.isPremium ||
         req.user.subscription?.stripeSubscriptionId || req.user.subscription?.stripeCustomerId);

      if (hasPremiumUser) {
        // Source de vérité pour le compte à rebours : manualPremiumExpiry si
        // défini (octroi manuel via superadmin), sinon accès considéré illimité
        // tant qu'aucune date n'a été fixée — on n'invente jamais un "30" fixe.
        const manualExpiry = req.user.manualPremiumExpiry ? new Date(req.user.manualPremiumExpiry) : null;
        const endDate = manualExpiry || (() => {
          const d = new Date();
          d.setMonth(d.getMonth() + 1);
          return d;
        })();

        // Recréer/mettre à jour le doc Subscription manquant pour les prochaines
        // requêtes. upsert (pas create()) : un `create()` plantait silencieusement
        // sur l'index unique sparse de stripeSubscriptionId dès qu'un 2e utilisateur
        // sans Stripe (stripeSubscriptionId explicitement `null`) passait par ici —
        // Mongo traite `null` explicite comme une valeur indexée, pas comme "absent",
        // donc l'index sparse ne protégeait pas du duplicata. Résultat : le doc
        // n'était JAMAIS recréé après le premier utilisateur manuel, et ce fallback
        // (avec son daysLeft figé) tournait en boucle pour tout le monde après lui.
        const stripeSubId = req.user.subscription?.stripeSubscriptionId || undefined;
        try {
          await Subscription.findOneAndUpdate(
            { user: req.user._id, status: "active" },
            {
              user:     req.user._id,
              plan:     embeddedPlan,
              status:   "active",
              startDate: new Date(),
              endDate,
              stripeCustomerId:    req.user.subscription?.stripeCustomerId || null,
              ...(stripeSubId ? { stripeSubscriptionId: stripeSubId } : {}),
              amount:   0,
              currency: "eur",
              autoRenew: true,
            },
            { upsert: true, setDefaultsOnInsert: true }
          );
        } catch (createErr) {
          console.error(`[injectSubscription] Erreur recréation Subscription pour ${req.user._id}:`, createErr.message);
        }

        res.locals.isPro        = true;
        res.locals.currentPlan  = embeddedPlan;
        res.locals.subscription = null;
        res.locals.autoRenew    = true;
        res.locals.isExpired    = false;

        if (!manualExpiry) {
          // Pas de date fixée par le superadmin → accès illimité.
          res.locals.daysLeft   = null;
          res.locals.hoursLeft  = null;
          res.locals.isExpiring = false;
        } else {
          const now = new Date();
          const diffMs   = endDate - now;
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
          if (diffMs <= 0) {
            res.locals.daysLeft   = 0;
            res.locals.hoursLeft  = 0;
            res.locals.isExpiring = true;
          } else if (diffDays <= 1) {
            res.locals.daysLeft   = 0;
            res.locals.hoursLeft  = diffHours > 0 ? diffHours : 1;
            res.locals.isExpiring = true;
          } else {
            res.locals.daysLeft   = diffDays;
            res.locals.hoursLeft  = null;
            res.locals.isExpiring = diffDays <= 3;
          }
        }
      } else {
        // Vraiment free — pas de plan premium
        res.locals.isPro        = false;
        res.locals.currentPlan  = "basic";
        res.locals.subscription = null;
        res.locals.autoRenew    = false;
        res.locals.daysLeft     = 0;
        res.locals.hoursLeft    = null;
        res.locals.isExpired    = false;
        res.locals.isExpiring   = false;
        await revokePremium(req);
      }
    }

    next();
  } catch (error) {
    console.error("injectSubscription error:", error);
    next();
  }
};
