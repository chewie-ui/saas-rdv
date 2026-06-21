const router = require("express").Router();
const https  = require("https");
const http   = require("http");
const User   = require("../db/models/user.model");
const PageView = require("../db/models/pageView.model");
const { isBotUserAgent } = require("../utils/botDetection");

// Domaine du referrer ("google.com", "instagram.com"...), ou "direct" si la
// visite arrive sans referrer (lien direct, app, favoris, navigation interne).
function getViewSource(referrerUrl, ownHostname) {
  if (!referrerUrl) return "direct";
  try {
    const host = new URL(referrerUrl).hostname.replace(/^www\./, "");
    if (host === (ownHostname || "").replace(/^www\./, "")) return "direct";
    return host;
  } catch (_) {
    return "direct";
  }
}

// Compteur de vues "réelles" : appelé par un petit script JS depuis le
// navigateur (public/js/pageview-beacon.js) une fois la page chargée. Un
// script/scanner qui ne charge jamais le JS d'une page ne déclenchera donc
// jamais cet endpoint, contrairement à un comptage fait à chaque requête HTTP
// côté serveur (facilement pollué par des bots qui imitent un vrai navigateur).
router.post("/track-view", (req, res) => {
  res.json({ ok: true }); // on répond tout de suite, le tracking est best-effort
  try {
    const ua = req.headers["user-agent"] || "";
    if (isBotUserAgent(ua)) return;
    const visitorId = req.cookies && req.cookies.bs_vid;
    if (!visitorId) return;
    const path = (req.body && req.body.path) || "";
    if (!path) return;
    const source = getViewSource(req.body && req.body.referrer, req.hostname);
    PageView.create({ visitorId, path, source }).catch(() => {});
  } catch (_) {
    // Le tracking ne doit jamais casser une requête.
  }
});

// ── Résoudre un lien Google Maps court et extraire les coordonnées ────────────
function parseGmapCoords(url) {
  // @lat,lon,zoom
  let m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) return { lat: m[1], lon: m[2] };
  // ?q=lat,lon
  m = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (m) return { lat: m[1], lon: m[2] };
  // !3dLAT!4dLON
  m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) return { lat: m[1], lon: m[2] };
  return null;
}

function followRedirects(url, maxRedirects = 8) {
  return new Promise((resolve, reject) => {
    const go = (currentUrl, hops) => {
      if (hops <= 0) return resolve(currentUrl);
      const lib = currentUrl.startsWith("https") ? https : http;
      const req = lib.request(currentUrl, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BranSheeBot/1.0)" },
        timeout: 6000,
      }, (res) => {
        const location = res.headers["location"];
        if (location && res.statusCode >= 300 && res.statusCode < 400) {
          const next = location.startsWith("http") ? location : new URL(location, currentUrl).href;
          go(next, hops - 1);
        } else {
          resolve(currentUrl);
        }
      });
      req.on("error", () => resolve(currentUrl));
      req.on("timeout", () => { req.destroy(); resolve(currentUrl); });
      req.end();
    };
    go(url, maxRedirects);
  });
}

router.get("/resolve-gmap", async (req, res) => {
  const url = (req.query.url || "").trim();
  if (!url) return res.status(400).json({ error: "URL manquante" });

  // 1. Essayer d'extraire les coordonnées directement
  const direct = parseGmapCoords(url);
  if (direct) return res.json({ ok: true, ...direct, source: "direct" });

  // 2. C'est probablement un lien court → suivre les redirections
  try {
    const finalUrl = await followRedirects(url);
    const coords   = parseGmapCoords(finalUrl);
    if (coords) return res.json({ ok: true, ...coords, finalUrl, source: "redirect" });

    // 3. Pas de coordonnées dans l'URL finale → chercher le nom du lieu
    const placeMatch = finalUrl.match(/maps\/place\/([^/@]+)/);
    const placeName  = placeMatch ? decodeURIComponent(placeMatch[1].replace(/\+/g, " ")) : null;
    if (placeName) return res.json({ ok: true, placeName, finalUrl, source: "name" });

    return res.json({ ok: false, finalUrl });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/test", (req, res) => {
  res.send("test");
});

// Vérifier un code de parrainage (utilisé sur la page d'inscription)
router.get("/check-ref", async (req, res) => {
  const code = (req.query.code || "").trim().toUpperCase();
  if (!code) return res.json({ valid: false });
  try {
    const user = await User.findOne({ referralCode: code }).select("fullName").lean();
    if (!user) return res.json({ valid: false });
    // Retourner le prénom seulement (pas le nom complet pour la confidentialité)
    const firstName = (user.fullName || "").split(" ")[0];
    return res.json({ valid: true, name: firstName });
  } catch (_) {
    return res.json({ valid: false });
  }
});

module.exports = router;
