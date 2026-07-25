// ── API mobile : enregistrement des appareils pour le push ────────────────
//   POST   /push/register    { token, platform }  → associe l'appareil au compte
//   DELETE /push/register    { token }            → retire l'appareil
//   POST   /push/test                             → s'envoie une notification
const PushToken = require("../../db/models/pushToken.model");
const { isValidExpoToken, sendPushToUser } = require("../../utils/push");

// POST /api/v1/push/register
exports.register = async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const platform = ["ios", "android", "web"].includes(req.body.platform) ? req.body.platform : "unknown";

    if (!isValidExpoToken(token)) {
      return res.status(400).json({ error: "invalid_token", message: "Jeton de notification invalide." });
    }

    // Le même appareil peut changer de compte (déconnexion/reconnexion) :
    // on réaffecte le jeton plutôt que d'en créer un doublon. Le changement de
    // propriétaire est journalisé : c'est aussi le geste d'un attaquant qui
    // détournerait les notifications d'un pro vers son propre compte.
    const previous = await PushToken.findOne({ token }).select("user").lean();
    if (previous && String(previous.user) !== String(req.mobileUser._id)) {
      console.warn(
        `[push] jeton réaffecté : ${String(previous.user)} → ${String(req.mobileUser._id)}`,
      );
    }

    await PushToken.findOneAndUpdate(
      { token },
      { user: req.mobileUser._id, token, platform, lastSeenAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("[mobile push register]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// DELETE /api/v1/push/register — à la déconnexion, pour ne plus recevoir les
// notifications d'un compte auquel on n'est plus connecté.
exports.unregister = async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    if (!token) return res.status(400).json({ error: "missing_token", message: "Jeton requis." });

    await PushToken.deleteOne({ token, user: req.mobileUser._id });
    res.json({ ok: true });
  } catch (err) {
    console.error("[mobile push unregister]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/push/test — envoie une notification de test à ses propres
// appareils. Pratique pour vérifier l'installation sans attendre une vraie
// réservation.
exports.test = async (req, res) => {
  try {
    const result = await sendPushToUser(req.mobileUser._id, {
      title: "Branshee Pro",
      body: "Les notifications fonctionnent 🎉",
      data: { type: "test" },
    });
    res.json(result);
  } catch (err) {
    console.error("[mobile push test]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
