const mongoose = require("mongoose");

// Une ligne par connexion réussie (mot de passe, 2FA ou Google) — affichée
// dans le flux d'activité superadmin pour voir qui s'est connecté et quand.
const loginEventSchema = new mongoose.Schema(
  {
    user:   { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    method: { type: String, enum: ["local", "2fa", "google"], default: "local" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LoginEvent", loginEventSchema);
