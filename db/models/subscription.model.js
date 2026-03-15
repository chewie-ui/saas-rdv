const mongoose = require("mongoose");
const schema = mongoose.Schema;

const subscriptionSchema = new schema(
  {
    user: {
      type: schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    plan: {
      type: String,
      enum: ["basic", "premium"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "cancelled", "expired", "pending"],
      default: "pending",
    },

    startDate: {
      type: Date,
      default: Date.now,
    },

    stripeCustomerId: {
      type: String,
    },

    stripePriceId: String,

    endDate: {
      type: Date,
      required: true,
    },
    stripeSubscriptionId: {
      type: String,
      unique: true,
      sparse: true,
    },

    amount: Number,
    currency: String,

    autoRenew: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const Subscription = mongoose.model("Subscription", subscriptionSchema);

module.exports = Subscription;
