const mongoose = require("mongoose");

// Une ligne par page vue. "visitorId" est un identifiant anonyme stocké dans
// un cookie longue durée (1 an) — pas lié à un compte utilisateur — pour
// pouvoir distinguer les vues uniques (visiteurs distincts) des vues totales
// (chaque chargement de page), affichées dans le superadmin.
const pageViewSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true, index: true },
    path: { type: String, default: "" },
    // Source de CETTE visite : "google-ads" (clic payant, détecté via gclid ou
    // utm_source), un domaine de referrer ("google.com", "instagram.com"), ou
    // "direct" si rien n'est déterminable. Cf. utils/attribution.js.
    source: { type: String, default: "direct" },
    // Détail de campagne, renseigné seulement pour du trafic tagué (utm_* /
    // Google Ads). Permet de comparer les campagnes entre elles, pas seulement
    // les canaux.
    medium:   { type: String, default: "" }, // cpc, email, referral...
    campaign: { type: String, default: "" }, // utm_campaign
    gclid:    { type: String, default: "" }, // signature d'un clic Google Ads
  },
  { timestamps: true }
);

module.exports = mongoose.model("PageView", pageViewSchema);
