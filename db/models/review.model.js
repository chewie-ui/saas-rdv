const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      default: null,
    },
    clientName:    { type: String, required: true, trim: true },
    clientPicture: { type: String, default: "/images/no-user.webp" },
    rating:        { type: Number, required: true, min: 1, max: 5 },
    comment:       { type: String, default: "", trim: true, maxlength: 800 },
  },
  { timestamps: true }
);

// Un seul avis par client connecté par établissement
reviewSchema.index({ company: 1, client: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model("Review", reviewSchema);
