const mongoose = require("mongoose");

// Note de satisfaction laissée par un utilisateur après la fermeture d'une
// conversation de support — simple compteur, pas lié à un fil de discussion
// (qui est lui-même supprimé à la fermeture).
const supportRatingSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SupportRating", supportRatingSchema);
