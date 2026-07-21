const Subscription = require("../db/models/subscription.model");
const User = require("../db/models/user.model");
const { getPlan } = require("../utils/planLimits");

/**
 * Révoque isPremium en DB + en mémoire si nécessaire.
 * Appelé quand l'abonnement est expiré ou inexistant.
 */
async function revokePremium(user) {
  // Ne jamais révoquer un accès accordé manuellement (bêta testeurs)
  if (user && user.manualPremium) return;
  // Ne pas révoquer si l'utilisateur a un plan payant dans son User doc
  // (protège contre la désynchronisation entre Subscription collection et User doc)
  const embeddedPlan = user?.subscription?.plan;
  if (["essentiel", "pro", "business"].includes(embeddedPlan)) return;
  if (user && user.isPremium) {
    user.isPremium = false;
    await User.findByIdAndUpdate(user._id, { isPremium: false });
  }
}

/**
 * Calcule isPro/currentPlan/daysLeft/... pour UN user donné (effets de bord DB
 * inclus — sync du doc Subscription, révocation si expiré). Pris en paramètre
 * plutôt que de fermer sur req.user pour pouvoir être réutilisé avec l'owner
 * d'un établissement quand l'utilisateur connecté n'est qu'un collaborateur
 * (cf. middlewares/injectCompany.js — le plan suit l'établissement, pas le
 * compte connecté).
 */
async function resolveSubscriptionState(user) {
  const locals = {};
  if (!user) return locals;

  // ── Bypass manuel : bêta testeurs avec manualPremium=true (prod + dev)
  if (user.manualPremium) {
    const expiry = user.manualPremiumExpiry;
    const now    = new Date();

    // Si la durée de test est dépassée → révoquer automatiquement
    if (expiry && new Date(expiry) < now) {
      await User.findByIdAndUpdate(user._id, {
        manualPremium: false,
        isPremium: false,
        manualPremiumExpiry: null,
        "subscription.status": "inactive",
      });
      user.manualPremium = false;
      user.isPremium     = false;
      // Fall through → sera traité comme free ci-dessous
    } else {
      if (!user.isPremium) {
        await User.findByIdAndUpdate(user._id, { isPremium: true });
        user.isPremium = true;
      }

      const diffMs    = expiry ? new Date(expiry) - now : null;
      const diffDays  = diffMs !== null ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : null;
      const diffHours = diffMs !== null ? Math.ceil(diffMs / (1000 * 60 * 60)) : null;

      locals.currentPlan   = (user.subscription && user.subscription.plan) || "pro";
      locals.isPro         = ["pro", "business"].includes(locals.currentPlan);
      locals.subscription  = null;
      locals.autoRenew     = false;
      locals.isExpired     = false;
      locals.isBetaAccess  = true;

      if (diffDays === null) {
        // Accès infini
        locals.daysLeft   = null;
        locals.hoursLeft  = null;
        locals.isExpiring = false;
      } else if (diffDays <= 1) {
        locals.daysLeft   = 0;
        locals.hoursLeft  = diffHours > 0 ? diffHours : 1;
        locals.isExpiring = true;
      } else {
        locals.daysLeft   = diffDays;
        locals.hoursLeft  = null;
        locals.isExpiring = diffDays <= 3;
      }

      // Date d'expiration (pour l'affichage) + avertissement de paiement.
      locals.trialExpiryDate = expiry ? new Date(expiry) : null;
      // On n'avertit QUE si l'accès expire bientôt ET que l'utilisateur n'a
      // pas de moyen de paiement par défaut (sinon il n'a rien à faire — le
      // prélèvement se fera tout seul le moment venu). Sans customer Stripe,
      // getUserPaymentMethods renvoie [] instantanément (aucun appel réseau).
      if (locals.isExpiring) {
        try {
          let hasDefaultPM = false;
          if (user.subscription && user.subscription.stripeCustomerId) {
            const { getUserPaymentMethods } = require("../controllers/admin.controller");
            const pms = await getUserPaymentMethods(user);
            hasDefaultPM = Array.isArray(pms) && pms.some((pm) => pm.isDefault);
          }
          locals.showTrialWarning = !hasDefaultPM;
        } catch (_) {
          // En cas d'erreur Stripe, on avertit par prudence (mieux vaut prévenir).
          locals.showTrialWarning = true;
        }
      }

      return locals;
    }
  }

  const subscription = await Subscription.findOne({
    user: user._id,
    status: "active",
  }).lean();

  if (subscription) {
    const now = new Date();
    const diffMs    = new Date(subscription.endDate) - now;
    const diffDays  = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));

    // ── Sync user so getLimit()/getPlan() see the correct plan ──
    // The embedded user.subscription may lag behind the Subscription collection
    // (e.g. webhook not yet written). Overwrite in-memory so all controllers
    // calling getPlan(user) get the right result for this request.
    if (user.subscription) {
      user.subscription.status = "active";
      user.subscription.plan   = subscription.plan || "pro";
    } else {
      user.subscription = { status: "active", plan: subscription.plan || "pro" };
    }

    locals.subscription = subscription;
    locals.autoRenew    = subscription.autoRenew;
    locals.currentPlan  = subscription.plan || "pro";

    if (diffMs <= 0) {
      // ── Abonnement expiré ──
      locals.isPro      = false;
      locals.currentPlan = "basic";
      locals.daysLeft   = 0;
      locals.hoursLeft  = 0;
      locals.isExpired  = true;
      locals.isExpiring = false;
      await revokePremium(user); // DB + mémoire
    } else if (diffDays <= 1) {
      // ── Moins de 24h restantes ──
      locals.isPro      = true;
      locals.daysLeft   = 0;
      locals.hoursLeft  = diffHours > 0 ? diffHours : 1;
      locals.isExpired  = false;
      locals.isExpiring = true;
    } else {
      locals.isPro      = true;
      locals.daysLeft   = diffDays;
      locals.hoursLeft  = null;
      locals.isExpired  = false;
      locals.isExpiring = diffDays <= 3;
    }
  } else {
    // ── Pas de doc Subscription actif dans la collection ──
    // Fallback : si User doc a un plan payant (même si isPremium est faux à cause de revokePremium)
    // On vérifie subscription.status = "active" ET plan valide dans le User doc
    const embeddedPlan   = user.subscription?.plan;
    const embeddedStatus = user.subscription?.status;
    const validPlans     = ["essentiel", "pro", "business"];
    const hasPremiumUser = validPlans.includes(embeddedPlan) &&
      (embeddedStatus === "active" || user.isPremium ||
       user.subscription?.stripeSubscriptionId || user.subscription?.stripeCustomerId);

    if (hasPremiumUser) {
      // Source de vérité pour le compte à rebours : manualPremiumExpiry si
      // défini (octroi manuel via superadmin), sinon accès considéré illimité
      // tant qu'aucune date n'a été fixée — on n'invente jamais un "30" fixe.
      const manualExpiry = user.manualPremiumExpiry ? new Date(user.manualPremiumExpiry) : null;
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
      const stripeSubId = user.subscription?.stripeSubscriptionId || undefined;
      try {
        await Subscription.findOneAndUpdate(
          { user: user._id, status: "active" },
          {
            user:     user._id,
            plan:     embeddedPlan,
            status:   "active",
            startDate: new Date(),
            endDate,
            stripeCustomerId:    user.subscription?.stripeCustomerId || null,
            ...(stripeSubId ? { stripeSubscriptionId: stripeSubId } : {}),
            amount:   0,
            currency: "eur",
            autoRenew: true,
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
      } catch (createErr) {
        console.error(`[injectSubscription] Erreur recréation Subscription pour ${user._id}:`, createErr.message);
      }

      locals.isPro        = true;
      locals.currentPlan  = embeddedPlan;
      locals.subscription = null;
      locals.autoRenew    = true;
      locals.isExpired    = false;

      if (!manualExpiry) {
        // Pas de date fixée par le superadmin → accès illimité.
        locals.daysLeft   = null;
        locals.hoursLeft  = null;
        locals.isExpiring = false;
      } else {
        const now = new Date();
        const diffMs   = endDate - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
        if (diffMs <= 0) {
          locals.daysLeft   = 0;
          locals.hoursLeft  = 0;
          locals.isExpiring = true;
        } else if (diffDays <= 1) {
          locals.daysLeft   = 0;
          locals.hoursLeft  = diffHours > 0 ? diffHours : 1;
          locals.isExpiring = true;
        } else {
          locals.daysLeft   = diffDays;
          locals.hoursLeft  = null;
          locals.isExpiring = diffDays <= 3;
        }
      }
    } else {
      // Vraiment free — pas de plan premium
      locals.isPro        = false;
      locals.currentPlan  = "basic";
      locals.subscription = null;
      locals.autoRenew    = false;
      locals.daysLeft     = 0;
      locals.hoursLeft    = null;
      locals.isExpired    = false;
      locals.isExpiring   = false;
      await revokePremium(user);
    }
  }

  // ── isPro = plan Pro OU Business uniquement ────────────────────────────────
  // "essentiel" est un plan PAYANT mais ce n'est PAS un plan Pro : il ne
  // débloque aucune fonctionnalité Pro (rappels, perso, formulaires, équipe…).
  // On recalcule isPro de façon centralisée pour ne dépendre d'aucune branche.
  locals.isPro = ["pro", "business"].includes(locals.currentPlan);

  return locals;
}

module.exports = async (req, res, next) => {
  try {
    if (!req.user) {
      return next();
    }
    const locals = await resolveSubscriptionState(req.user);
    Object.assign(res.locals, locals);
    next();
  } catch (error) {
    console.error("injectSubscription error:", error);
    next();
  }
};

module.exports.resolveSubscriptionState = resolveSubscriptionState;
