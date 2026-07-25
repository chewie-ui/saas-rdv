const mongoose = require("mongoose");

// Un appareil enregistré pour recevoir les notifications push de l'app pro.
// Un même utilisateur peut en avoir plusieurs (téléphone + tablette) ; un même
// appareil peut changer de main, d'où l'unicité portée par le token et non
// par l'utilisateur.
const pushTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Jeton Expo, de la forme ExponentPushToken[xxxxxxxx]
    token: { type: String, required: true, unique: true },
    platform: { type: String, enum: ["ios", "android", "web", "unknown"], default: "unknown" },
    // Dernière fois que l'app a confirmé ce jeton — sert à purger les appareils
    // qui ne se manifestent plus.
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PushToken", pushTokenSchema);
