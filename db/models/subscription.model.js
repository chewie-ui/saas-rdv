const mongoose = require("mongoose");
const schema = mongoose.Schema;

const subscriptionSchema = new schema(
  {
    user: {
      type: schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    plan: {
      type: String,
      enum: ["basic", "essentiel", "pro", "business", "premium"],
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "cancelled", "expired", "pending", "superseded", "inactive"],
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

    // Item Stripe pour les sièges collaborateurs supplémentaires (10€/mois/siège)
    collaboratorSeatsItemId: String,

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
