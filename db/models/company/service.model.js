const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    price: {
      type: Number,
      default: null, // null = prix non défini
    },
    duration: {
      type: Number,
      default: 30, // en minutes
    },
    active: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    category: {
      type: String,
      default: '',
    },
    // "individual" = un client par créneau (comportement par défaut)
    // "group"      = plusieurs clients peuvent réserver le même créneau,
    //                jusqu'à `capacity` places.
    type: {
      type: String,
      enum: ["individual", "group"],
      default: "individual",
    },
    // Nombre de places disponibles par créneau (uniquement pour type === "group")
    capacity: {
      type: Number,
      default: null,
    },
    employees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Service", serviceSchema);
