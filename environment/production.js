const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const env = process.env;

module.exports = {
  stripeSecretKey:    env.STRIPE_SECRET_KEY_SERVER,
  stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY_SERVER,

  // Prix — nouveaux noms en priorité, anciens en fallback (rétrocompatibilité)
  stripePricePremiumMonthly:  env.STRIPE_PRICE_PREMIUM_MONTHLY_KEY_SERVER  || env.STRIPE_PRICE_KEY_SERVER,
  stripePricePremiumYearly:   env.STRIPE_PRICE_PREMIUM_YEARLY_KEY_SERVER   || env.STRIPE_PRICE_KEY_SERVER,
  stripePriceBusinessMonthly: env.STRIPE_PRICE_BUSINESS_MONTHLY_KEY_SERVER || env.STRIPE_PRICE_KEY_BUSINESS_SERVER,
  stripePriceBusinessYearly:  env.STRIPE_PRICE_BUSINESS_YEARLY_KEY_SERVER  || env.STRIPE_PRICE_KEY_BUSINESS_SERVER,

  // Add-on : URL personnalisée (+5€/mois)
  stripePriceAddonCustomUrl:  env.STRIPE_PRICE_ADDON_CUSTOM_URL_SERVER || "",

  // URLs — défaut branshee.com si non renseignées
  stripeSuccessUrl: env.STRIPE_SUCCESS_URL_SERVER || "https://www.branshee.com/subscription/success?session_id={CHECKOUT_SESSION_ID}",
  stripeCancelUrl:  env.STRIPE_CANCEL_URL_SERVER  || "https://www.branshee.com/subscription",

  // Webhook — supporte les deux noms de variable
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET_SERVER || env.STRIPE_WEBHOOK_KEY_SERVER,

  // Stripe Connect — platform client ID
  stripeConnectClientId: env.STRIPE_CONNECT_CLIENT_ID_SERVER || env.STRIPE_CONNECT_CLIENT_ID || "",
  appBaseUrl:            env.APP_BASE_URL || "https://www.branshee.com",

  dbUri: env.MONGO_URI_SERVER,
  port:  Number(env.PORT) || 8080,
};
