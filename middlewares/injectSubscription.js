const Subscription = require("../db/models/subscription.model");
const User = require("../db/models/user.model");

/**
 * Révoque isPremium en DB + en mémoire si nécessaire.
 * Appelé quand l'abonnement est expiré ou inexistant.
 */
async function revokePremium(req) {
  if (req.user && req.user.isPremium) {
    req.user.isPremium = false; // en mémoire → templates
    await User.findByIdAndUpdate(req.user._id, { isPremium: false }); // en DB → requêtes futures
  }
}

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

      if (diffMs <= 0) {
        // ── Abonnement expiré ──
        res.locals.isPro      = false;
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
      // ── Pas d'abonnement actif ──
      res.locals.isPro        = false;
      res.locals.subscription = null;
      res.locals.autoRenew    = false;
      res.locals.daysLeft     = 0;
      res.locals.hoursLeft    = null;
      res.locals.isExpired    = false;
      res.locals.isExpiring   = false;
      await revokePremium(req); // DB + mémoire si isPremium était true en DB
    }

    next();
  } catch (error) {
    console.error("injectSubscription error:", error);
    next();
  }
};
