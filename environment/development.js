const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const env = process.env;

module.exports = {
  stripeSecretKey:           env.STRIPE_SECRET_KEY_LOCAL,
  stripePublishableKey:      env.STRIPE_PUBLISHABLE_KEY_LOCAL,
  stripePriceEssentielMonthly: env.STRIPE_PRICE_ESSENTIEL_MONTHLY_LOCAL || env.STRIPE_PRICE_ESSENTIEL_MONTHLY_SERVER || "",
  // Annuel Essentiel (7 €/mois, soit 84 €/an). Tant que ce prix n'est pas créé
  // dans Stripe, la variable reste vide : l'offre annuelle est alors masquée et
  // l'Essentiel reste mensuel — jamais d'affichage d'une remise non facturable.
  stripePriceEssentielYearly: env.STRIPE_PRICE_ESSENTIEL_YEARLY_LOCAL || env.STRIPE_PRICE_ESSENTIEL_YEARLY_SERVER || "",
  stripePricePremiumMonthly: env.STRIPE_PRICE_PREMIUM_MONTHLY_KEY_LOCAL,
  stripePricePremiumYearly:  env.STRIPE_PRICE_PREMIUM_YEARLY_KEY_LOCAL,
  stripePriceBusinessMonthly:env.STRIPE_PRICE_BUSINESS_MONTHLY_KEY_LOCAL,
  stripePriceBusinessYearly: env.STRIPE_PRICE_BUSINESS_YEARLY_KEY_LOCAL,
  stripeSuccessUrl:          env.STRIPE_SUCCESS_URL_LOCAL,
  stripeCancelUrl:           env.STRIPE_CANCEL_URL_LOCAL,
  stripeWebhookSecret:       env.STRIPE_WEBHOOK_SECRET,
  stripeConnectClientId:     env.STRIPE_CONNECT_CLIENT_ID_LOCAL || env.STRIPE_CONNECT_CLIENT_ID || "",
  stripeConnectTestAccount:  env.STRIPE_CONNECT_TEST_ACCOUNT_LOCAL || "",
  stripePriceAddonCustomUrl: env.STRIPE_PRICE_ADDON_CUSTOM_URL_LOCAL || env.STRIPE_PRICE_ADDON_CUSTOM_URL_SERVER || "",
  stripePriceExtraCollaborator: env.STRIPE_PRICE_EXTRA_COLLABORATOR_LOCAL || env.STRIPE_PRICE_EXTRA_COLLABORATOR_SERVER || "",
  appBaseUrl:                env.APP_BASE_URL_LOCAL || "http://localhost:3000",
  dbUri:                     env.MONGO_URI_LOCAL,
  port:                      3000,

  sessionSecret: env.SESSION_SECRET,
};
