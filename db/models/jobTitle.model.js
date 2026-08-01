const mongoose = require("mongoose");

/**
 * Métier soumis par un pro, et la décision du superadmin.
 *
 * La liste officielle vit en dur dans `utils/services.js`. Tout métier saisi
 * hors de cette liste s'affichait en orange (« pas encore reconnu ») et la
 * demande d'ajout ne partait qu'en EMAIL : rien n'était stocké, donc rien
 * n'était modérable. Ce modèle rend ces demandes persistantes et décidables.
 *
 * - `pending`  : soumis ou simplement constaté en usage, pas encore tranché
 * - `approved` : rejoint la liste officielle (cf. utils/services.js)
 * - `blocked`  : refusé — reste affiché en orange, ne sera jamais indexé
 */
const jobTitleSchema = new mongoose.Schema(
  {
    // Libellé exact tel que saisi par le pro.
    name: { type: String, required: true, trim: true },

    // Clé de rapprochement : minuscules sans accents ni espaces superflus.
    // C'est ELLE qui est unique, pas `name` : sinon « Réflexologue » et
    // « reflexologue » créeraient deux entrées à modérer séparément.
    key: { type: String, required: true, unique: true, index: true },

    status: {
      type: String,
      enum: ["pending", "approved", "blocked"],
      default: "pending",
      index: true,
    },

    // Origine : demande explicite du pro, ou simple constat d'usage.
    source: { type: String, enum: ["request", "usage"], default: "request" },

    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    requestedByEmail: { type: String, default: "" },

    decidedAt: { type: Date, default: null },
    decidedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

// Normalisation partagée : le contrôleur et les scripts doivent produire
// exactement la même clé, sinon les doublons reviennent par la fenêtre.
jobTitleSchema.statics.toKey = function (name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
};

module.exports = mongoose.model("JobTitle", jobTitleSchema);
