const crypto = require("crypto");
const { parseAttribution, rememberFirstTouch } = require("../utils/attribution");

const STATIC_EXT_RE = /\.(css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm|json|txt|xml|pdf)$/i;
const EXCLUDED_PREFIXES = ["/superadmin", "/socket.io", "/api", "/css", "/js", "/images", "/fonts"];

// Garantit juste l'existence du cookie visiteur (bs_vid) sur les pages
// publiques. Le comptage réel des vues se fait côté navigateur via
// public/js/pageview-beacon.js + POST /api/track-view : un script ou un
// scanner qui ne charge jamais le JS de la page ne sera donc jamais compté,
// contrairement à une détection par user-agent qui peut être contournée.
module.exports = function trackPageView(req, res, next) {
  try {
    if (req.method !== "GET") return next();
    const p = req.path || "";
    if (STATIC_EXT_RE.test(p)) return next();
    if (EXCLUDED_PREFIXES.some((prefix) => p.startsWith(prefix))) return next();

    if (!req.cookies || !req.cookies.bs_vid) {
      res.cookie("bs_vid", crypto.randomUUID(), {
        maxAge: 1000 * 60 * 60 * 24 * 365,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }

    // Attribution « premier contact », capturée ICI (côté serveur) et pas dans
    // le beacon : la requête d'atterrissage est la seule à porter les `utm_*`
    // et le `gclid` de Google Ads. Un visiteur qui clique une pub puis navigue
    // ailleurs perd ces paramètres dès la 2ᵉ page — s'il s'inscrit plus tard,
    // seul ce cookie permet encore de rattacher son compte à la campagne.
    rememberFirstTouch(
      req,
      res,
      parseAttribution(req.query, req.get("referer"), req.hostname),
    );
  } catch (_) {
    // Le tracking ne doit jamais casser une requête.
  }
  next();
};
