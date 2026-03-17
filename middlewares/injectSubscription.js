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
      const diffTime = new Date(subscription.endDate) - now;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      res.locals.subscription = subscription;
      res.locals.isPro = subscription.status === "active";
      res.locals.daysLeft = diffDays > 0 ? diffDays : 0;
    } else {
      res.locals.isPro = false;
      res.locals.subscription = null;
    }

    res.locals.autoRenew = subscription.autoRenew;

    next();
  } catch (error) {
    console.error("error", error);
    next();
  }
};
