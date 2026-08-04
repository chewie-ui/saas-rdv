const mongoose = require("mongoose");
const schema = mongoose.Schema;

// Une entrée = une visite/séance notée par l'admin (constat, travail effectué,
// ce qu'il faut faire la prochaine fois...). Sous-document Mongoose : chaque
// entrée a son propre _id, utilisé pour l'éditer/la supprimer individuellement.
const dossierEntrySchema = new schema(
  {
    date: { type: Date, default: Date.now },
    title: { type: String, default: "", trim: true },
    note: { type: String, default: "", trim: true },
    todo: { type: String, default: "", trim: true },
    // Pièce jointe PDF (facultative). Stockée hors du dossier public (RGPD) —
    // `path` est relatif à private_uploads/, téléchargée via une route protégée.
    attachment: {
      path: { type: String, default: "" },
      filename: { type: String, default: "" },
      size: { type: Number, default: 0 },
    },
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
    // Prénom et nom séparés : renseignés pour un client créé à la main depuis
    // la page Clients, qui n'a aucun rendez-vous d'où les déduire. Pour les
    // autres, l'identité reste celle saisie par le client à la réservation.
    firstName: { type: String, default: "", trim: true },
    lastName: { type: String, default: "", trim: true },
    // Distingue une fiche créée exprès par le pro d'un dossier né tout seul
    // d'une note ou d'un blocage. Seules les premières apparaissent dans la
    // liste des clients quand elles n'ont aucun rendez-vous : sinon supprimer
    // un client ferait réapparaître son dossier résiduel, et les blocages
    // (qui créent un dossier) deviendraient des clients fantômes.
    createdManually: { type: Boolean, default: false },
    phone: { type: String, default: "", trim: true },
    // Contacts alternatifs ajoutés par l'admin (le client peut avoir 2 emails,
    // 2 numéros, ou être connu sous un autre nom/surnom). Le nom principal reste
    // celui défini par le client à la réservation — non modifiable ici.
    altName: { type: String, default: "", trim: true },
    altEmail: { type: String, default: "", trim: true },
    altPhone: { type: String, default: "", trim: true },
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
