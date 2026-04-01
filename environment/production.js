const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const env = process.env;

console.log(env);

module.exports = {
  stripeWebhookKey: env.STRIPE_WEBHOOK_KEY_SERVER,
  stripeSecretKey: env.STRIPE_SECRET_KEY_SERVER,
  stripePricePlanPro: env.STRIPE_PRICE_KEY_SERVER,
  dbUri: env.MONGO_URI_SERVER,
  port: 8080,
};
