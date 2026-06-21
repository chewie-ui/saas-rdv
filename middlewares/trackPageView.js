const crypto = require("crypto");
const PageView = require("../db/models/pageView.model");

const STATIC_EXT_RE = /\.(css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm|json|txt|xml|pdf)$/i;
const EXCLUDED_PREFIXES = ["/superadmin", "/socket.io", "/api", "/css", "/js", "/images", "/fonts"];
// Crawlers/scrapers connus : pas de réelle "visite", ne pas compter en vue.
const BOT_UA_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|ahrefs|semrush|mj12bot|dotbot|petalbot|yandex|baiduspider|curl|wget|python-requests|headlesschrome|phantomjs|scrapy/i;

// Domaine du referrer ("google.com", "instagram.com"...), ou "direct" si la
// visite arrive sans referrer (lien direct, app, favoris, navigation interne).
function getSource(req) {
  const ref = req.headers["referer"] || req.headers["referrer"] || "";
  if (!ref) return "direct";
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    if (host === (req.hostname || "").replace(/^www\./, "")) return "direct";
    return host;
  } catch (_) {
    return "direct";
  }
}

// Compte les vues du site pour le superadmin (vues totales + visiteurs
// uniques). Volontairement très simple : un document par vue, "fire and
// forget" (n'attend jamais l'écriture, ne bloque jamais la requête).
// Exclut : assets statiques, requêtes non-GET, /superadmin (pour ne pas
// compter les visites de l'admin lui-même), /api et /socket.io.
module.exports = function trackPageView(req, res, next) {
  try {
    if (req.method !== "GET") return next();
    const p = req.path || "";
    if (STATIC_EXT_RE.test(p)) return next();
    if (EXCLUDED_PREFIXES.some((prefix) => p.startsWith(prefix))) return next();
    if (BOT_UA_RE.test(req.headers["user-agent"] || "")) return next();

    let visitorId = req.cookies && req.cookies.bs_vid;
    if (!visitorId) {
      visitorId = crypto.randomUUID();
      res.cookie("bs_vid", visitorId, {
        maxAge: 1000 * 60 * 60 * 24 * 365,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }

    PageView.create({ visitorId, path: p, source: getSource(req) }).catch(() => {});
  } catch (_) {
    // Le tracking ne doit jamais casser une requête.
  }
  next();
};
