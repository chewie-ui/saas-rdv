const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const env = process.env;

module.exports = {
  stripeSecretKey:           env.STRIPE_SECRET_KEY_LOCAL,
  stripePublishableKey:      env.STRIPE_PUBLISHABLE_KEY_LOCAL,
  stripePricePremiumMonthly: env.STRIPE_PRICE_PREMIUM_MONTHLY_KEY_LOCAL,
  stripePricePremiumYearly:  env.STRIPE_PRICE_PREMIUM_YEARLY_KEY_LOCAL,
  stripePriceBusinessMonthly:env.STRIPE_PRICE_BUSINESS_MONTHLY_KEY_LOCAL,
  stripePriceBusinessYearly: env.STRIPE_PRICE_BUSINESS_YEARLY_KEY_LOCAL,
  stripeSuccessUrl:          env.STRIPE_SUCCESS_URL_LOCAL,
  stripeCancelUrl:           env.STRIPE_CANCEL_URL_LOCAL,
  dbUri:                     env.MONGO_URI_LOCAL,
  port:                      3000,
};
