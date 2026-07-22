const mongoose = require("mongoose");

/**
 * Signalement d'un avis.
 *
 * Deux origines :
 *  • « visitor » / « user » — n'importe qui peut signaler un avis depuis la page
 *    publique (insultes, propos haineux, faux avis…).
 *  • « owner » — le professionnel demande la suppression d'un avis sur SON
 *    établissement. Il ne peut pas supprimer lui-même : c'est le superadmin qui
 *    tranche, sinon n'importe qui effacerait ses mauvaises notes.
 *
 * On garde une COPIE de l'avis (`snapshot`) : si l'avis est supprimé — par son
 * auteur ou par la décision du superadmin — le signalement reste consultable et
 * justifiable, ce qui compte en cas de contestation.
 */
const reviewReportSchema = new mongoose.Schema(
  {
    review: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Review",
      required: true,
      index: true,
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    // ── Qui signale ────────────────────────────────────────────────────────
    reporterKind: {
      type: String,
      enum: ["visitor", "user", "owner"],
      default: "visitor",
      index: true,
    },
    reporterId:   { type: mongoose.Schema.Types.ObjectId, default: null },
    reporterName: { type: String, default: "Visiteur" },
    // Empreinte pour limiter le spam d'un même visiteur non connecté.
    reporterFingerprint: { type: String, default: "", index: true },

    // ── Motif ──────────────────────────────────────────────────────────────
    reason: {
      type: String,
      enum: [
        "insulting",     // propos insultants ou haineux
        "false",         // faux avis / client jamais venu
        "spam",          // publicité, hors-sujet
        "personal",      // données personnelles divulguées
        "other",
      ],
      required: true,
    },
    message: { type: String, default: "", trim: true, maxlength: 1000 },

    // ── Copie de l'avis au moment du signalement ───────────────────────────
    snapshot: {
      clientName: String,
      rating:     Number,
      comment:    String,
      createdAt:  Date,
    },

    // ── Traitement par le superadmin ───────────────────────────────────────
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
      index: true,
    },
    decidedAt:   { type: Date, default: null },
    decisionNote: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { timestamps: true },
);

// Un même signaleur ne peut pas signaler deux fois le même avis.
reviewReportSchema.index(
  { review: 1, reporterFingerprint: 1 },
  { unique: true, partialFilterExpression: { reporterFingerprint: { $type: "string", $ne: "" } } },
);

module.exports = mongoose.model("ReviewReport", reviewReportSchema);
