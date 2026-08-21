const mongoose = require("mongoose");
const schema = mongoose.Schema;
const { dossierKey } = require("../../utils/dossierKey");

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
    // PLUS obligatoire : un pro peut noter un client au téléphone sans
    // connaître son adresse. Il l'ajoute ensuite depuis la fiche.
    email: { type: String, default: "", lowercase: true, trim: true },
    // Identité réelle du dossier — e-mail, sinon téléphone, sinon nom
    // (cf. utils/dossierKey). Calculée automatiquement avant chaque
    // enregistrement : aucun appelant n'a à la fournir.
    clientKey: { type: String, default: "", trim: true, index: true },
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
    // Ce client a eu au moins un rendez-vous. Posé au moment où l'on
    // SUPPRIME son dernier rendez-vous : sans ça il disparaissait purement
    // et simplement de la liste clients, qui se construit à partir des
    // rendez-vous. Supprimer un rendez-vous ne doit jamais faire perdre un
    // client — ni son historique, ni ses notes, ni ses coordonnées.
    hadBookings: { type: Boolean, default: false },
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

// Recalcule la clé à chaque écriture : un e-mail ajouté après coup doit
// faire basculer le dossier de « nom: » ou « tel: » vers « mail: », sinon
// une future réservation avec cette adresse créerait un second dossier.
clientDossierSchema.pre("save", function () {
  this.clientKey = dossierKey(this) || this.clientKey || String(this._id);
});

// `save` ne se déclenche PAS sur findOneAndUpdate, or c'est par là que
// passent la plupart des upserts de dossier. Sans ce second hook, un
// dossier créé par upsert naîtrait sans clé et tomberait en collision avec
// tous les autres dossiers sans clé du même établissement.
clientDossierSchema.pre("findOneAndUpdate", function () {
  const u = this.getUpdate() || {};
  const set = u.$set || u;
  const soc = u.$setOnInsert || {};
  // L'identité peut venir du $set (mise à jour) ou du $setOnInsert
  // (création), voire du filtre lui-même pour un upsert minimal.
  const filtre = this.getFilter() || {};
  const source = {
    email: set.email !== undefined ? set.email : (soc.email !== undefined ? soc.email : filtre.email),
    phone: set.phone !== undefined ? set.phone : soc.phone,
    fullName: set.fullName !== undefined ? set.fullName : soc.fullName,
    firstName: set.firstName !== undefined ? set.firstName : soc.firstName,
    lastName: set.lastName !== undefined ? set.lastName : soc.lastName,
  };
  const cle = dossierKey(source);
  if (cle) this.set({ clientKey: cle });
});

// L'unicité porte sur la CLÉ, plus sur l'e-mail : deux dossiers sans
// adresse auraient tous deux `email: ""` et se seraient rejetés l'un
// l'autre sur l'ancien index.
clientDossierSchema.index({ company: 1, clientKey: 1 }, { unique: true });

module.exports = mongoose.model("ClientDossier", clientDossierSchema);
