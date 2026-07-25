// ── Middleware d'authentification de l'API mobile ─────────────────────────
// Lit l'en-tête `Authorization: Bearer <accessToken>`, vérifie le JWT, puis
// charge le User correspondant sur req.mobileUser (sans les champs sensibles,
// comme deserializeUser côté session). Aucune session n'est touchée : l'API
// mobile est stateless.
const User = require("../db/models/user.model");
const { verifyToken, epochMatches } = require("../utils/mobileJwt");

// Renvoie toujours du JSON (jamais de redirect HTML — c'est une API).
module.exports = async function mobileAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ error: "missing_token", message: "Token d'accès manquant." });
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch (err) {
      const expired = err && err.name === "TokenExpiredError";
      return res.status(401).json({
        error: expired ? "token_expired" : "invalid_token",
        message: expired ? "Session expirée." : "Token invalide.",
      });
    }

    if (payload.typ !== "access") {
      return res.status(401).json({ error: "invalid_token", message: "Type de token invalide." });
    }

    const user = await User.findById(payload.sub).select(
      "-password -twoFA.secret -twoFA.tempSecret -googleCalendar.refreshToken -googleCalendar.accessToken",
    );
    if (!user) {
      return res.status(401).json({ error: "user_not_found", message: "Compte introuvable." });
    }
    if (user.isDisabled) {
      return res.status(403).json({ error: "account_disabled", message: "Ce compte a été désactivé." });
    }
    // Jeton émis avant le dernier changement de mot de passe → révoqué.
    // Sans ce contrôle, un refresh volé resterait valable 60 jours même après
    // que la victime a changé son mot de passe depuis le site.
    if (!epochMatches(payload, user)) {
      return res.status(401).json({ error: "token_revoked", message: "Session expirée, reconnectez-vous." });
    }

    req.mobileUser = user;
    next();
  } catch (err) {
    console.error("[mobileAuth]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
