const fs = require("fs");
const path = require("path");
const pug = require("pug");
const cheerio = require("cheerio");

const SIDEBAR_PATH = path.join(__dirname, "../views/common/sidebar.pug");
const FR_LOCALE_PATH = path.join(__dirname, "../locales/fr.json");

// Identifiant stable dérivé d'un href, utilisé comme clé FeatureFlag
// (ex: "/customize-calendar" → "nav_customize_calendar").
function hrefToKey(href) {
  return "nav_" + href.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

let _cache = null;

// Rend la sidebar admin avec des données neutres (tout visible) et en extrait
// CHAQUE lien réellement présent dans le template — aucune liste à maintenir
// à la main : si un lien est ajouté dans sidebar.pug, il apparaît ici tout seul
// au prochain appel (cache invalidé au redémarrage du serveur).
function extractNavLinks() {
  if (_cache) return _cache;

  const t = JSON.parse(fs.readFileSync(FR_LOCALE_PATH, "utf-8"));
  const html = pug.renderFile(SIDEBAR_PATH, {
    t,
    pageName: null,
    user: { profilePicture: "/images/no-user.webp", fullName: "Aperçu" },
    currentCompany: { slug: "apercu", _id: "000000000000000000000000" },
    isPro: false,
    currentPlan: "basic",
    lang: "fr",
    grade: "owner",
    adminFeatures: {}, // tout visible pendant la détection
  });

  const $ = cheerio.load(html);
  const links = [];

  $(".sb-section").each((_, sectionEl) => {
    const sectionLabel = $(sectionEl).find(".sb-section__hd").first().text().trim() || "Autre";

    $(sectionEl).find("a.sb-link").each((__, linkEl) => {
      const $link = $(linkEl);
      const href = $link.attr("href");
      // On exclut les liens externes (cible _blank, ex: "voir ma page publique")
      // et la déconnexion : ce ne sont pas des "pages" à cacher pendant un dev.
      if (!href || href === "#" || href === "/logout" || $link.attr("target")) return;

      const label = $link.find("span").first().text().trim() || href;
      links.push({ key: hrefToKey(href), href, label, section: sectionLabel });
    });
  });

  _cache = links;
  return links;
}

module.exports = { extractNavLinks, hrefToKey };
