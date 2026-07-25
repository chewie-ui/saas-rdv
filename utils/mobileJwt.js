// ── JWT pour l'API mobile (app pro Branshee) ──────────────────────────────
// L'app web reste sur session/cookies Passport. L'app mobile, elle, est
// stateless : elle s'authentifie avec un token JWT porté dans l'en-tête
// Authorization. On sépare volontairement deux tokens :
//   - access  : courte durée (15 min), envoyé à chaque requête API.
//   - refresh : longue durée (60 j), sert uniquement à obtenir un nouvel
//               access sans redemander le mot de passe.
// Le secret est distinct de SESSION_SECRET pour cloisonner les deux mondes.
const jwt = require("jsonwebtoken");

// ⚠️ AUCUNE valeur de repli littérale : une chaîne présente dans le dépôt
// permettrait à quiconque de forger un token d'accès pour n'importe quel
// compte (et aussi les jetons de réinitialisation de mot de passe, qui
// utilisent le même secret). Un déploiement sans secret doit échouer au
// démarrage plutôt que de démarrer « normalement » avec un secret public.
const SECRET = process.env.MOBILE_JWT_SECRET || process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error(
    "MOBILE_JWT_SECRET (ou à défaut SESSION_SECRET) est manquant : l'API mobile ne peut pas signer ses jetons.",
  );
}
if (!process.env.MOBILE_JWT_SECRET) {
  console.warn(
    "[mobileJwt] MOBILE_JWT_SECRET absent : repli sur SESSION_SECRET. Définissez un secret dédié à l'API mobile.",
  );
}

const ACCESS_TTL = "15m";
const REFRESH_TTL = "60d";

// `epoch` = User.tokenEpoch au moment de l'émission. Il est comparé à chaque
// requête : incrémenter tokenEpoch (changement/réinitialisation de mot de
// passe) invalide instantanément TOUS les jetons déjà en circulation, ce qui
// serait impossible autrement (le refresh vit 60 jours et n'est stocké nulle
// part côté serveur).
function signAccessToken(userId, epoch = 0) {
  return jwt.sign({ sub: String(userId), typ: "access", epoch: Number(epoch) || 0 }, SECRET, {
    expiresIn: ACCESS_TTL,
  });
}

function signRefreshToken(userId, epoch = 0) {
  return jwt.sign({ sub: String(userId), typ: "refresh", epoch: Number(epoch) || 0 }, SECRET, {
    expiresIn: REFRESH_TTL,
  });
}

// Retourne le payload décodé, ou lève une erreur (expiré / invalide).
function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

// Émet la paire access+refresh d'un coup (login / refresh réussi).
function issueTokens(userId, epoch = 0) {
  return {
    accessToken: signAccessToken(userId, epoch),
    refreshToken: signRefreshToken(userId, epoch),
    tokenType: "Bearer",
    expiresIn: 15 * 60,
  };
}

// Un jeton émis avant l'ajout de `tokenEpoch` n'a pas la claim : on le traite
// comme epoch 0, valeur par défaut du champ — les sessions existantes ne sont
// donc pas cassées par la mise en place du mécanisme.
function epochMatches(payload, user) {
  return (Number(payload && payload.epoch) || 0) === (Number(user && user.tokenEpoch) || 0);
}

module.exports = {
  SECRET,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  issueTokens,
  epochMatches,
};
