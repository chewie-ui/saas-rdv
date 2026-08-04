const mongoose = require("mongoose");
const schema = mongoose.Schema;
const crypto = require("crypto");

const bookingSchema = new schema(
  {
    user: {
      type: schema.Types.ObjectId,
      ref: "User",
      required: false,
    },

    surname: String,
    name: String,
    email: String,
    phone: String,
    message: String,

    company: {
      type: schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    date: {
      type: Date,
      required: true,
    },
    startTime: {
      type: String,
      required: true,
    },

    endTime: {
      type: String,
      required: true,
    },

    slotTime: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["canceled", "confirmed"],
      required: true,
    },

    cancelToken: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(32).toString("hex"),
    },

    reminderSent: {
      type: Boolean,
      default: false,
    },

    manualReminderSent: {
      type: Boolean,
      default: false,
    },

    adminNotes: {
      type: String,
      default: "",
    },

    // ── Absence (no-show) ───────────────────────────────────────────────────
    noShow: {
      type: Boolean,
      default: false,
    },
    // valid   = raison valable (urgence, hôpital...) → aucun frais
    // invalid = oubli / sans raison → frais d'absence prélevés
    noShowReason: {
      type: String,
      enum: ["", "valid", "invalid"],
      default: "",
    },

    googleEventId: {
      type: String,
      default: "",
    },

    // Réservation pour un service "collectif" (plusieurs clients sur le même
    // créneau, jusqu'à la capacité définie sur le service).
    isGroup: {
      type: Boolean,
      default: false,
    },

    // Bloc d'indisponibilité posé par l'admin (ex: "Absent — dentiste") —
    // occupe le créneau exactement comme un RDV (mêmes vérifications de
    // chevauchement) mais n'a pas de client : pas d'email de confirmation,
    // n'apparaît pas dans les dossiers clients/patients. Le motif (ex:
    // "dentiste", "pause") est stocké dans `message`.
    isBlock: {
      type: Boolean,
      default: false,
    },

    formAnswers: [
      {
        question: { type: String },
        answer: { type: String },
      },
    ],

    clientRef: {
      type: schema.Types.ObjectId,
      ref: "Client",
      required: false,
      default: null,
    },

    service: {
      type: schema.Types.ObjectId,
      ref: "Service",
      default: null,
    },
    serviceName: {
      type: String,
      default: "",
    },
    // Couleur du service au moment de la réservation — figée ici plutôt que
    // recalculée à chaque affichage : si le service est supprimé ou
    // désactivé plus tard, les RDV déjà pris gardent leur couleur d'origine
    // au lieu de tous retomber sur une couleur par défaut (confusion visuelle
    // dans le calendrier admin sinon, ex: "TESTER TER" hérite du bleu de
    // "NEW kine" une fois le service supprimé).
    serviceColor: {
      type: String,
      default: "",
    },
    // Référence un User (l'identité bookable, patron ou collaborateur — cf.
    // utils/bookableTeam.js et la fusion Employé/Collaborateur), plus jamais
    // un Employee séparé.
    employee: {
      type: schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    employeeName: {
      type: String,
      default: "",
    },

    // ── Paiement ──────────────────────────────────────────────────────────────
    payment: {
      method:   { type: String, enum: ["online", "on_site", "bank_transfer", "paypal", "cash", "none"], default: "none" },
      // status:
      //   none       = pas de paiement en ligne
      //   authorized = carte enregistrée, 0€ prélevé (nouveau flux pré-autorisation)
      //   paid       = montant total déjà capturé (ancien flux)
      //   refunded   = remboursement complet
      //   partial    = remboursement/conservation partielle (50%)
      //   penalty    = frais d'annulation prélevés sur la carte enregistrée
      //   failed     = échec de prélèvement
      status:   { type: String, enum: ["none", "authorized", "paid", "refunded", "partial", "penalty", "failed"], default: "none" },
      stripePaymentIntentId: { type: String, default: "" },
      stripeSetupIntentId:   { type: String, default: "" },
      stripeCustomerId:      { type: String, default: "" },
      stripePaymentMethodId: { type: String, default: "" },
      amount:   { type: Number, default: 0 },  // in euros — montant total de la prestation
      // Montant réellement prélevé en pénalité (annulation tardive ou no-show),
      // peut être inférieur à `amount` (ex: 50% pour une politique "half_24h").
      penaltyAmount: { type: Number, default: 0 },
      currency: { type: String, default: "eur" },
      paidAt:   { type: Date,   default: null },
      // Revue par l'admin des frais d'annulation prélevés automatiquement :
      //   ""        = pas encore traité
      //   refunded  = raison valable, frais remboursés au client
      //   kept      = raison non valable, l'établissement garde les frais
      cancellationReviewDecision: { type: String, enum: ["", "refunded", "kept"], default: "" },
      cancellationReviewedAt:     { type: Date, default: null },
      // Montant conservé par l'établissement (pénalité retenue) — alimenté
      // lors d'un remboursement partiel (status "partial") ou d'une pénalité
      // 100% sur booking "paid". BranShee reverse ce montant à l'admin.
      keptAmount:  { type: Number, default: 0 },
      cardLast4: { type: String, default: "" },
      cardBrand: { type: String, default: "" },
    },
  },
  { timestamps: true },
);

// Unique per (company, date, startTime, employee) — so different employees CAN share a time slot,
// but the same employee cannot be double-booked. When employee is null (no specific employee),
// treat as the company itself (only one unassigned slot per time).
// Group bookings (isGroup: true) are excluded — many clients can share the same
// (company, date, startTime, employee) slot, up to the service's capacity.
// Les absences (isBlock: true) le sont aussi : une absence se pose PAR-DESSUS
// les rendez-vous déjà réservés sans les annuler — c'est son usage même. Tant
// qu'elles étaient dans l'index, poser une absence commençant à la minute
// exacte d'un rendez-vous non assigné était rejeté (E11000) et le pro voyait
// « Une erreur est survenue ». Le chevauchement reste géré par
// checkBookingConflict, qui empêche toute NOUVELLE réservation sur le créneau.
// Changer cet index demande de supprimer l'ancien : scripts/migrate-block-index.js.
bookingSchema.index(
  { company: 1, date: 1, startTime: 1, employee: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "confirmed", isGroup: false, isBlock: false },
  },
);

// Fix ref: employee is an Employee document, not a User


const Booking = mongoose.model("Booking", bookingSchema);

module.exports = Booking;
