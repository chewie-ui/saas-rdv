const mongoose = require("mongoose");

// ── Message envoyé par le superadmin (fondateur) à un utilisateur pro ────────
// Deux modes :
//   • ciblé    → `recipient` = un User précis, `broadcast` = false
//   • diffusion → `recipient` = null,        `broadcast` = true (tous les pros)
//
// La lecture/fermeture est suivie via `dismissedBy` (liste d'IDs users qui ont
// marqué le message comme lu). Pour un message diffusé, chaque destinataire
// ferme le message indépendamment ; il disparaît de SON dashboard sans toucher
// celui des autres. Pas de document par destinataire pour un broadcast : un
// seul doc, filtré à la lecture par `dismissedBy`.
const adminMessageSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null, // null = diffusion à tous les pros
    },
    broadcast: {
      type: Boolean,
      default: false,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    // Tonalité visuelle de la bannière côté utilisateur.
    type: {
      type: String,
      enum: ["info", "warning", "security", "success", "tip"],
      default: "info",
    },
    // Bouton d'action optionnel (ex: "Sécuriser mon compte" → /account).
    ctaLabel: { type: String, default: "", trim: true, maxlength: 60 },
    ctaUrl: { type: String, default: "", trim: true, maxlength: 500 },
    // Users ayant fermé/lu le message (pour un broadcast : chacun le sien).
    dismissedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

// Recherche fréquente : messages non fermés pour un destinataire donné.
adminMessageSchema.index({ recipient: 1, createdAt: -1 });
adminMessageSchema.index({ broadcast: 1, createdAt: -1 });

module.exports = mongoose.model("AdminMessage", adminMessageSchema);
