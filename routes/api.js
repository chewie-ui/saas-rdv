const router = require("express").Router();
const https  = require("https");
const http   = require("http");
const User   = require("../db/models/user.model");
const PageView = require("../db/models/pageView.model");
const { isBotUserAgent } = require("../utils/botDetection");

const { parseAttribution } = require("../utils/attribution");

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

    // Attribution de CETTE visite : les `utm_*` / `gclid` de la page courante
    // priment sur le referrer (un clic Google Ads arrive très souvent sans
    // referrer et tombait donc en "direct"). Le cookie first-touch n'est
    // délibérément PAS utilisé ici : il vaut 90 jours et attribuerait toutes
    // les visites suivantes à la pub, ce qui gonflerait artificiellement.
    let query = {};
    try {
      query = Object.fromEntries(
        new URLSearchParams(String((req.body && req.body.query) || "")),
      );
    } catch (_) {
      query = {};
    }
    const attr = parseAttribution(query, req.body && req.body.referrer, req.hostname);

    PageView.create({
      visitorId,
      path,
      source:   attr.source,
      medium:   attr.medium,
      campaign: attr.campaign,
      gclid:    attr.gclid,
    }).catch(() => {});
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

// ── Anti-SSRF ─────────────────────────────────────────────────────────────
// Cet endpoint fait des requêtes HTTP côté serveur en suivant les redirections
// d'une URL fournie par le client. Sans garde-fou, c'est une SSRF : on pourrait
// forcer le serveur à taper des services internes ou les métadonnées cloud
// (169.254.169.254). On restreint aux seuls domaines Google Maps — à l'URL de
// départ ET à CHAQUE redirection, pour qu'un 302 ne puisse pas rediriger vers
// un hôte interne.
function isAllowedGmapUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    // google.<tld>, *.google.<tld>, goo.gl, *.goo.gl, g.co, *.g.co
    return /(^|\.)(google\.[a-z.]{2,}|goo\.gl|g\.co)$/.test(h);
  } catch (_) {
    return false;
  }
}

function followRedirects(url, maxRedirects = 8) {
  return new Promise((resolve, reject) => {
    const go = (currentUrl, hops) => {
      if (hops <= 0) return resolve(currentUrl);
      if (!isAllowedGmapUrl(currentUrl)) {
        return reject(new Error("Hôte non autorisé"));
      }
      const lib = currentUrl.startsWith("https") ? https : http;
      const req = lib.request(currentUrl, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BranSheeBot/1.0)" },
        timeout: 6000,
      }, (res) => {
        const location = res.headers["location"];
        if (location && res.statusCode >= 300 && res.statusCode < 400) {
          const next = location.startsWith("http") ? location : new URL(location, currentUrl).href;
          // Une redirection ne peut PAS sortir de la liste blanche Google.
          if (!isAllowedGmapUrl(next)) return resolve(currentUrl);
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

// ── Recherche d'établissements à rejoindre (inscription + Paramètres) ─────────
// Uniquement les établissements dont le propriétaire est en plan Business —
// c'est le seul plan pensé pour héberger plusieurs comptes (cf. plan
// d'unification des comptes). Pas d'auth requise : utilisé pendant
// l'inscription, avant même que le compte du demandeur existe.
router.get("/joinable-companies", async (req, res) => {
  const q = (req.query.q || "").trim();
  // Sans recherche : on propose quelques établissements par défaut (au lieu
  // d'une liste vide) pour montrer à l'utilisateur ce qu'il peut rejoindre ;
  // dès qu'il tape, la liste se filtre sur son texte.
  const limit = q.length >= 2 ? 8 : 3;
  try {
    const Company = require("../db/models/company/company.model");
    const { getCompanyPlan } = require("../utils/planLimits");

    // On part des ÉTABLISSEMENTS (et non des comptes) : le forfait leur
    // appartient, et un patron avec 2 établissements doit apparaître 2 fois
    // avec DEUX noms distincts — pas deux fois le même libellé (règle 6/8).
    const companyFilter = { isDeleted: { $ne: true }, isPaused: { $ne: true } };
    if (q.length >= 2) {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      // Le nom cherché peut vivre sur l'établissement (cas normal) ou, pour
      // les fiches historiques sans `name`, sur le compte propriétaire.
      const owners = await User.find({ isDisabled: { $ne: true }, $or: [{ businessName: regex }, { fullName: regex }] })
        .select("_id")
        .limit(30)
        .lean();
      companyFilter.$or = [
        { name: regex },
        { businessType: regex },
        ...(owners.length ? [{ owner: { $in: owners.map((u) => u._id) } }] : []),
      ];
    }

    // Borne explicite : le filtrage « Business » se fait en mémoire, il ne
    // faut donc jamais charger toute la collection.
    const companies = await Company.find(companyFilter)
      .select("_id owner name businessType plan planStatus")
      .populate("owner", "_id businessName fullName businessType subscription isPremium manualPremium isDisabled")
      .sort({ createdAt: -1 })
      .limit(60)
      .lean();

    const results = companies
      .filter((c) => c.owner && !c.owner.isDisabled && getCompanyPlan(c, c.owner) === "business")
      .map((c) => ({
        id: String(c._id),
        name: c.name || c.owner.businessName || c.owner.fullName || "Établissement",
        businessType: c.businessType || c.owner.businessType || "",
      }))
      .slice(0, limit);

    return res.json({ companies: results });
  } catch (err) {
    console.error("joinable-companies error:", err.message);
    return res.json({ companies: [] });
  }
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
