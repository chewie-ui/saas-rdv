const mongoose = require("mongoose");
const schema = mongoose.Schema;

const companySchema = schema(
  {
    owner: {
      type: schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    slug: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },

    slotTime: {
      type: Number,
      default: 30,
    },

    // Temps tampon (en minutes) à respecter avant ET après chaque RDV.
    // Conservé pour compatibilité — remplacé par bufferBefore/bufferAfter.
    bufferTime: {
      type: Number,
      default: 0,
    },

    // Temps tampon (en minutes) à respecter avant chaque RDV.
    bufferBefore: {
      type: Number,
      default: null,
    },

    // Temps tampon (en minutes) à respecter après chaque RDV.
    bufferAfter: {
      type: Number,
      default: null,
    },

    // "fixed"    = créneaux générés sur la durée du service/slot (ex: 9h00, 9h30, 10h00...)
    // "interval" = créneaux proposés toutes les `slotInterval` minutes,
    //              indépendamment de la durée de la prestation (ex: 9h00, 9h10, 9h20...)
    slotMode: {
      type: String,
      enum: ["fixed", "interval"],
      default: "fixed",
    },

    slotInterval: {
      type: Number,
      default: 30,
    },

    schedule: [
      {
        weekdayIndex: {
          type: Number,
          required: true,
          min: 0,
          max: 6,
        },
        dayOff: {
          type: Boolean,
          default: false,
        },
        workingHours: {
          type: [{ start: String, end: String }],
          default: [{ start: "08:00", end: "16:00" }],
        },
      },
    ],

    // ── Pré-paiement ─────────────────────────────────────────────────────────
    prepayment: {
      enabled:  { type: Boolean, default: false },
      required: { type: Boolean, default: false }, // false = client peut choisir
    },

    // ── Politique d'annulation ────────────────────────────────────────────────
    // "free"     = annulation toujours gratuite
    // "half_24h" = 50% si annulation < 24h avant
    // "full_12h" = 100% si < 12h, 50% si entre 12h et 24h
    cancellationPolicy: {
      rule: { type: String, enum: ["free", "half_24h", "full_12h"], default: "free" },
    },

    // ── Stripe Connect (paiement en ligne) ────────────────────────────────────
    stripeConnect: {
      accountId:    { type: String, default: "" },
      status:       { type: String, enum: ["not_connected", "pending", "active"], default: "not_connected" },
      accountEmail: { type: String, default: "" },
    },

    // ── Modes de paiement acceptés (affichés + proposés au client) ────────────
    acceptedPayments: {
      cash:       { type: Boolean, default: false },   // espèces sur place
      cardOnSite: { type: Boolean, default: false },   // CB/TPE sur place
      bankTransfer: {
        enabled:  { type: Boolean, default: false },
        iban:     { type: String,  default: "" },
        bic:      { type: String,  default: "" },
        bankName: { type: String,  default: "" },
        note:     { type: String,  default: "" },      // instructions libres
      },
      paypal: {
        enabled:  { type: Boolean, default: false },
        paypalMe: { type: String,  default: "" },      // ex: "username" ou "https://paypal.me/username"
      },
    },

    // ── Mise en avant (boost) ─────────────────────────────────────────────────
    // 0 = pas mis en avant, 1 = premier, 2 = deuxième, etc.
    boostPosition: { type: Number, default: 0 },

    // ── Notification "limite mensuelle de RDV atteinte" ───────────────────────
    // Stocke le mois ("YYYY-MM") où l'email d'alerte a déjà été envoyé à
    // l'admin, pour éviter de le renvoyer à chaque nouvelle réservation bloquée.
    limitReachedNotifiedMonth: { type: String, default: "" },
  },
  { timestamps: true },
);

const Company = mongoose.model("Company", companySchema);

module.exports = Company;
