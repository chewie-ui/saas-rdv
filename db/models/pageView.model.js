const mongoose = require("mongoose");

// Une ligne par page vue. "visitorId" est un identifiant anonyme stocké dans
// un cookie longue durée (1 an) — pas lié à un compte utilisateur — pour
// pouvoir distinguer les vues uniques (visiteurs distincts) des vues totales
// (chaque chargement de page), affichées dans le superadmin.
const pageViewSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true, index: true },
    path: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PageView", pageViewSchema);
