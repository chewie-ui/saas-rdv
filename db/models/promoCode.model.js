const mongoose = require("mongoose");

const promoCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    discountType: {
      type: String,
      enum: ["percent", "fixed"],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },
    maxUses: {
      type: Number,
      default: null, // null = illimité
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    // Liste des user IDs ayant déjà utilisé ce code (max 1 fois par user)
    usedByUsers: {
      type: [{ type: require("mongoose").Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    expiresAt: {
      type: Date,
      default: null, // null = pas d'expiration
    },
    active: {
      type: Boolean,
      default: true,
    },
    applicablePlan: {
      type: String,
      enum: ["all", "premium_monthly", "premium_yearly", "business_monthly", "business_yearly"],
      default: "all",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PromoCode", promoCodeSchema);
