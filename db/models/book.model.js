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

    adminNotes: {
      type: String,
      default: "",
    },

    googleEventId: {
      type: String,
      default: "",
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
      // status: paid = captured, refunded = full refund, partial = 50% kept, none = on_site/no payment
      status:   { type: String, enum: ["none", "paid", "refunded", "partial", "failed"], default: "none" },
      stripePaymentIntentId: { type: String, default: "" },
      amount:   { type: Number, default: 0 },  // in euros
      currency: { type: String, default: "eur" },
      paidAt:   { type: Date,   default: null },
    },
  },
  { timestamps: true },
);

// Unique per (company, date, startTime, employee) — so different employees CAN share a time slot,
// but the same employee cannot be double-booked. When employee is null (no specific employee),
// treat as the company itself (only one unassigned slot per time).
bookingSchema.index(
  { company: 1, date: 1, startTime: 1, employee: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "confirmed" },
  },
);

// Fix ref: employee is an Employee document, not a User


const Booking = mongoose.model("Booking", bookingSchema);

module.exports = Booking;
