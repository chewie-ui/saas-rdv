const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: { type: String, enum: ["user", "admin"], required: true },
    text: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Un seul fil de discussion par utilisateur (pro) — le founder répond depuis
// le superadmin. Pas de notion de "ticket fermé" pour rester simple : c'est
// une conversation continue, comme un chat de support classique.
const supportChatSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    businessName: { type: String, default: "" },
    email: { type: String, default: "" },
    messages: { type: [messageSchema], default: [] },
    lastMessageAt: { type: Date, default: Date.now },
    unreadByAdmin: { type: Number, default: 0 }, // messages user non lus par le founder
    unreadByUser: { type: Number, default: 0 },  // réponses admin non lues par l'utilisateur
  },
  { timestamps: true }
);

module.exports = mongoose.model("SupportChat", supportChatSchema);
