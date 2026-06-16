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
    employee: {
      type: schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    employeeName: {
      type: String,
      default: "",
    },

    // ── Paiement ──────────────────────────────────────────────────────────────
    payment: {
      method:   { type: String, enum: ["online", "on_site", "bank_transfer", "paypal", "none"], default: "none" },
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
    },
  },
  { timestamps: true },
);

// Unique per (company, date, startTime, employee) — so different employees CAN share a time slot,
// but the same employee cannot be double-booked. When employee is null (no specific employee),
// treat as the company itself (only one unassigned slot per time).
// Group bookings (isGroup: true) are excluded — many clients can share the same
// (company, date, startTime, employee) slot, up to the service's capacity.
bookingSchema.index(
  { company: 1, date: 1, startTime: 1, employee: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "confirmed", isGroup: false },
  },
);

// Fix ref: employee is an Employee document, not a User


const Booking = mongoose.model("Booking", bookingSchema);

module.exports = Booking;
