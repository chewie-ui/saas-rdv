const mongoose = require("mongoose");

/**
 * Campagne promotionnelle en cours — document UNIQUE (singleton `key: "main"`).
 *
 * À ne pas confondre avec `PromoCode` : un code promo se tape à la main dans le
 * tunnel de paiement, une campagne s'applique d'office à tous ceux qui y ont
 * droit et s'annonce sur les pages publiques avec un compte à rebours.
 *
 * L'offre remplace l'ancien « 1er mois offert » (trial_period_days Stripe) par
 * un premier mois à prix cassé. Elle reste due UNE SEULE FOIS par compte :
 * l'éligibilité est déduite par utils/freeTrial.js (aDejaEuUnAccesPayant), donc
 * rien de plus à stocker ici.
 */
const promoCampaignSchema = new mongoose.Schema(
  {
    key: { type: String, default: "main", unique: true },

    active: { type: Boolean, default: false },

    // Cible du compte à rebours affiché sur l'accueil et /tarifs. Passée cette
    // date, la campagne s'éteint d'elle-même : pas de promo « perpétuelle » qui
    // afficherait une urgence mensongère (et une date qui recule toute seule
    // serait une pratique commerciale trompeuse au sens du droit belge/UE).
    endsAt: { type: Date, default: null },

    // Prix de la première période, en CENTIMES (100 = 1 €). En centimes parce
    // que c'est l'unité de Stripe : tout arrondi intermédiaire en euros finit
    // par produire un écart d'un centime sur la facture.
    firstPeriodCents: { type: Number, default: 100, min: 0 },

    // Durée annoncée de l'offre, en jours. Purement rédactionnel (« 30 jours »)
    // — la durée réelle est celle du cycle de facturation Stripe.
    days: { type: Number, default: 30, min: 1 },

    // Périmètre. Volontairement étroit : « 1 € pour 30 jours » n'a de sens que
    // sur un cycle mensuel, la première facture d'un annuel couvrant 12 mois.
    plan: { type: String, enum: ["pro", "business"], default: "pro" },
    billing: { type: String, enum: ["monthly"], default: "monthly" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PromoCampaign", promoCampaignSchema);
