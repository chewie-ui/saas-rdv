// ── Vérification du jeton « Se connecter avec Apple » ─────────────────────
// L'app reçoit d'Apple un `identityToken` : un JWT RS256 signé par Apple. On
// le vérifie ici, côté serveur — un jeton non vérifié serait une simple
// affirmation du client, donc n'importe qui pourrait revendiquer n'importe
// quel compte.
//
// Trois contrôles indissociables :
//   1. signature — avec la clé publique Apple correspondant au `kid` d'en-tête,
//      récupérée sur https://appleid.apple.com/auth/keys ;
//   2. audience  — le bundle identifier de NOTRE app (com.branshee.pro),
//      sinon un jeton émis pour une autre app Apple serait accepté ;
//   3. émetteur  — https://appleid.apple.com.
//
// Aucune dépendance ajoutée : `jsonwebtoken` est déjà là, et Node sait
// construire une clé publique directement depuis un JWK
// (crypto.createPublicKey({ format: "jwk" })).
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUER = "https://appleid.apple.com";

// Les clés d'Apple changent rarement mais tournent : on les garde en mémoire
// une journée, et on force un rafraîchissement si un `kid` inconnu apparaît
// (c'est exactement le signal d'une rotation).
const KEYS_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

// Audience acceptée : l'identifiant de bundle de l'app iOS. Surchargeable par
// variable d'environnement, mais avec une valeur par défaut correcte pour que
// rien ne casse si la variable n'est pas posée sur le serveur.
const APPLE_AUDIENCES = [
  process.env.APPLE_BUNDLE_ID || "com.branshee.pro",
  // Service ID (facultatif) : utilisé si un jour le bouton Apple est proposé
  // sur le web ou sur Android, où l'audience est le Service ID et non le bundle.
  process.env.APPLE_SERVICE_ID,
].filter(Boolean);

let cache = { keys: null, fetchedAt: 0 };
let inflight = null; // évite N appels réseau simultanés au premier accès

async function fetchKeys() {
  if (inflight) return inflight;
  inflight = (async () => {
    const res = await fetch(APPLE_KEYS_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`apple_keys_http_${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body?.keys) || !body.keys.length) throw new Error("apple_keys_empty");
    cache = { keys: body.keys, fetchedAt: Date.now() };
    return body.keys;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

// Retourne le JWK correspondant au `kid`, en rafraîchissant le cache si le
// `kid` est inconnu ou si le cache a expiré.
async function getKey(kid) {
  const fresh = cache.keys && Date.now() - cache.fetchedAt < KEYS_TTL_MS;
  let keys = fresh ? cache.keys : await fetchKeys();
  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk && fresh) {
    // Cache encore valide mais `kid` absent → rotation : on retente une fois.
    keys = await fetchKeys();
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new Error("apple_key_not_found");
  return jwk;
}

// Vérifie l'identityToken et renvoie sa charge utile.
// Lève une erreur si le jeton est invalide, expiré, ou destiné à une autre app.
async function verifyAppleIdentityToken(identityToken) {
  const decoded = jwt.decode(identityToken, { complete: true });
  const kid = decoded?.header?.kid;
  // `alg` est imposé explicitement : accepter l'algorithme annoncé par le
  // jeton lui-même est la faille classique des vérifications JWT.
  if (!kid || decoded.header.alg !== "RS256") throw new Error("apple_token_malformed");

  const jwk = await getKey(kid);
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });

  return jwt.verify(identityToken, publicKey, {
    algorithms: ["RS256"],
    audience: APPLE_AUDIENCES,
    issuer: APPLE_ISSUER,
  });
}

module.exports = { verifyAppleIdentityToken, APPLE_AUDIENCES };
