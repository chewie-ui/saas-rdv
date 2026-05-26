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

    bufferTime: {
      type: Number,
      default: 0,
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
  },
  { timestamps: true },
);

const Company = mongoose.model("Company", companySchema);

module.exports = Company;
