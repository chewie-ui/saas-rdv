const mongoose = require("mongoose");

// Une ligne par page vue. "visitorId" est un identifiant anonyme stocké dans
// un cookie longue durée (1 an) — pas lié à un compte utilisateur — pour
// pouvoir distinguer les vues uniques (visiteurs distincts) des vues totales
// (chaque chargement de page), affichées dans le superadmin.
const pageViewSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true, index: true },
    path: { type: String, default: "" },
    // Domaine du referrer (ex: "google.com", "instagram.com"), ou "direct"
    // si la visite arrive sans referrer (lien direct, app, favoris...).
    source: { type: String, default: "direct" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PageView", pageViewSchema);
