const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const env = process.env;

module.exports = {
  stripeWebhookKey:        env.STRIPE_WEBHOOK_KEY_LOCAL,
  stripeSecretKey:         env.STRIPE_SECRET_KEY_LOCAL,
  stripePricePlanPro:      env.STRIPE_PRICE_KEY_LOCAL,
  stripePricePlanBusiness: env.STRIPE_PRICE_KEY_BUSINESS_LOCAL,
  dbUri: env.MONGO_URI_LOCAL,
  port: 3000,
};
