const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const env = process.env;

module.exports = {
  stripeSecretKey:           env.STRIPE_SECRET_KEY_SERVER,
  stripePublishableKey:      env.STRIPE_PUBLISHABLE_KEY_SERVER,
  stripePricePremiumMonthly: env.STRIPE_PRICE_PREMIUM_MONTHLY_KEY_SERVER,
  stripePricePremiumYearly:  env.STRIPE_PRICE_PREMIUM_YEARLY_KEY_SERVER,
  stripePriceBusinessMonthly:env.STRIPE_PRICE_BUSINESS_MONTHLY_KEY_SERVER,
  stripePriceBusinessYearly: env.STRIPE_PRICE_BUSINESS_YEARLY_KEY_SERVER,
  stripeSuccessUrl:          env.STRIPE_SUCCESS_URL_SERVER,
  stripeCancelUrl:           env.STRIPE_CANCEL_URL_SERVER,
  dbUri:                     env.MONGO_URI_SERVER,
  port:                      8080,
};
