const mongoose = require("mongoose");
const schema = mongoose.Schema;

// Une entrée = une visite/séance notée par l'admin (constat, travail effectué,
// ce qu'il faut faire la prochaine fois...). Sous-document Mongoose : chaque
// entrée a son propre _id, utilisé pour l'éditer/la supprimer individuellement.
const dossierEntrySchema = new schema(
  {
    date: { type: Date, default: Date.now },
    note: { type: String, default: "", trim: true },
    todo: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

// Un dossier par (entreprise, client) — identifié par email plutôt que par un
// compte Client obligatoire, car beaucoup de réservations se font sans
// création de compte (juste nom + email + téléphone).
const clientDossierSchema = new schema(
  {
    company: { type: schema.Types.ObjectId, ref: "User", required: true },
    clientRef: { type: schema.Types.ObjectId, ref: "Client", default: null },
    email: { type: String, required: true, lowercase: true, trim: true },
    fullName: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    // Infos persistantes (antécédents, allergies, objectifs...) — contrairement
    // aux entrées, ce bloc ne change pas à chaque visite.
    generalInfo: { type: String, default: "" },
    entries: [dossierEntrySchema],
    // Empêche ce client de réserver à nouveau (ex: abus, non-présentations
    // répétées) — vérifié à chaque tentative de réservation publique.
    blocked: { type: Boolean, default: false },
    blockedAt: { type: Date, default: null },
    blockedReason: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

clientDossierSchema.index({ company: 1, email: 1 }, { unique: true });

module.exports = mongoose.model("ClientDossier", clientDossierSchema);
