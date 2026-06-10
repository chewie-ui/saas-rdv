const mongoose = require("mongoose");

const featureFlagSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
    },
    label: {
      type: String,
      default: "",
    },
    // active      → la page fonctionne normalement
    // maintenance → page "En cours de construction"
    // error       → page "Erreur temporaire"
    // disabled    → page désactivée (message générique)
    status: {
      type: String,
      enum: ["active", "maintenance", "error", "disabled"],
      default: "active",
    },
    message: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FeatureFlag", featureFlagSchema);
