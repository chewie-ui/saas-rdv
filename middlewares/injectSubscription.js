const Subscription = require("../db/models/subscription.model");

module.exports = async (req, res, next) => {
  try {
    if (!req.user) {
      return next();
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

      res.locals.subscription = subscription;
      res.locals.autoRenew    = subscription.autoRenew;

      // Temps restant
      if (diffMs <= 0) {
        // ── Abonnement expiré ──
        res.locals.isPro      = false;   // plus d'accès premium
        res.locals.daysLeft   = 0;
        res.locals.hoursLeft  = 0;
        res.locals.isExpired  = true;
        res.locals.isExpiring = false;
        // Révoquer isPremium sur l'objet user injecté dans les templates
        if (req.user) req.user.isPremium = false;
      } else if (diffDays <= 1) {
        // ── Moins de 24h ──
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
      res.locals.isPro        = false;
      res.locals.subscription = null;
      res.locals.autoRenew    = false;
      res.locals.daysLeft     = 0;
      res.locals.hoursLeft    = null;
      res.locals.isExpired    = false;
      res.locals.isExpiring   = false;
    }

    next();
  } catch (error) {
    console.error("injectSubscription error:", error);
    next();
  }
};
