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

    // ── Bypass local : si NODE_ENV=development et isPremium=true SANS vrai abonnement Stripe
    // Si un vrai Subscription doc existe → on utilise le flux normal (vraies dates)
    if (process.env.NODE_ENV !== "production" && req.user.isPremium === true) {
      const hasSub = await Subscription.exists({ user: req.user._id, status: "active" });
      if (!hasSub) {
        res.locals.isPro        = true;
        res.locals.currentPlan  = req.user.subscription && req.user.subscription.plan || "pro";
        res.locals.daysLeft     = 999;
        res.locals.hoursLeft    = null;
        res.locals.isExpired    = false;
        res.locals.isExpiring   = false;
        res.locals.subscription = null;
        res.locals.autoRenew    = false;
        return next();
      }
      // Un vrai abonnement existe → on continue vers le flux normal ci-dessous
    }

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
        // Recréer le doc Subscription manquant pour les prochaines requêtes
        try {
          const expDate = new Date();
          expDate.setMonth(expDate.getMonth() + 1);
          await Subscription.create({
            user:     req.user._id,
            plan:     embeddedPlan,
            status:   "active",
            startDate: new Date(),
            endDate:   expDate,
            stripeCustomerId:    req.user.subscription?.stripeCustomerId    || null,
            stripeSubscriptionId: req.user.subscription?.stripeSubscriptionId || null,
            amount:   0,
            currency: "eur",
            autoRenew: true,
          });
          console.log(`[injectSubscription] Doc Subscription recréé pour user ${req.user._id} (plan: ${embeddedPlan})`);
        } catch (createErr) {
          // Ignore si déjà existant (unique index)
        }

        res.locals.isPro        = true;
        res.locals.currentPlan  = embeddedPlan;
        res.locals.subscription = null;
        res.locals.autoRenew    = true;
        res.locals.daysLeft     = 30;
        res.locals.hoursLeft    = null;
        res.locals.isExpired    = false;
        res.locals.isExpiring   = false;
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
