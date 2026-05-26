const mongoose = require("mongoose");

const useSchema = new mongoose.Schema(
  {
    userId:  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    email:   { type: String, default: "" },
    ip:      { type: String, default: "" },
    usedAt:  { type: Date,   default: Date.now },
  },
  { _id: false }
);

const accessLinkSchema = new mongoose.Schema(
  {
    code: {
      type:     String,
      required: true,
      unique:   true,
      uppercase: true,
      trim:     true,
    },
    label: {
      type:    String,
      default: "",
      trim:    true,
    },
    plan: {
      type: String,
      enum: ["pro", "business"],
      required: true,
    },
    durationDays: {
      type:    Number,
      default: 30, // 30 = 1 mois
    },
    maxUses: {
      type:    Number,
      default: 1, // null = illimité
    },
    usedCount: {
      type:    Number,
      default: 0,
    },
    expiresAt: {
      type:    Date,
      default: null, // null = pas d'expiration du lien
    },
    isActive: {
      type:    Boolean,
      default: true,
    },
    uses: [useSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("AccessLink", accessLinkSchema);
