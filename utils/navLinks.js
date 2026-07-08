const fs = require("fs");
const path = require("path");
const pug = require("pug");
const cheerio = require("cheerio");

const SIDEBAR_PATH = path.join(__dirname, "../views/common/sidebar.pug");
const FR_LOCALE_PATH = path.join(__dirname, "../locales/fr.json");

// Identifiant stable dérivé d'un href, utilisé comme clé FeatureFlag
// (ex: "/customize-calendar" → "nav_customize_calendar").
// Les segments ObjectId (24 hex) sont normalisés en "id" pour que les liens
// dynamiques (ex: "/etablissement/<id>/collaborateurs") produisent la MÊME clé
// à la détection (superadmin) et à l'exécution (navVisibility) — sans quoi le
// masquage ne fonctionnait jamais pour ces liens et la clé exposait un ObjectId.
function hrefToKey(href) {
  return "nav_" + href
    .replace(/^\//, "")
    .replace(/[0-9a-f]{24}/gi, "id")
    .replace(/[^a-z0-9]+/gi, "_")
    .toLowerCase();
}

let _cache = null;

// Rend la sidebar admin avec des données neutres (tout visible) et en extrait
// CHAQUE lien réellement présent dans le template — aucune liste à maintenir
// à la main : si un lien est ajouté dans sidebar.pug, il apparaît ici tout seul
// au prochain appel (cache invalidé au redémarrage du serveur).
function extractNavLinks() {
  if (_cache) return _cache;

  const t = JSON.parse(fs.readFileSync(FR_LOCALE_PATH, "utf-8"));
  // Toutes les permissions accordées → TOUS les liens gated de sidebar.pug sont
  // rendus, donc détectés. Sans ça, les pages protégées (services, cours
  // collectifs, disponibilités, personnalisation, formulaires, collaborateurs,
  // grades, logs…) étaient invisibles pendant la détection = liste incomplète.
  const allPerms = {
    services:      { view: true, manage: true },
    groupSessions: { view: true, manage: true },
    customization: { manage: true },
    forms:         { manage: true },
    availability:  { manageShared: true, manageOwnSchedule: true, manageOthersSchedule: true, manageOwnTimeOff: true, manageOthersTimeOff: true },
    collaborators: { view: true },
    logs:          { view: true },
    grades:        { view: true, manage: true },
    billing:       { manage: true },
  };
  const html = pug.renderFile(SIDEBAR_PATH, {
    t,
    pageName: null,
    user: { profilePicture: "/images/no-user.webp", fullName: "Aperçu", businessName: "Aperçu", email: "" },
    currentCompany: { slug: "apercu", _id: "000000000000000000000000", name: "Aperçu" },
    myCompanies: [],
    permissions: allPerms,
    isPro: true,
    currentPlan: "business",
    lang: "fr",
    grade: "owner",
    adminFeatures: {}, // tout visible pendant la détection
  });

  const $ = cheerio.load(html);
  const links = [];
  const seen = new Set(); // déduplication par clé

  $(".sb-section").each((_, sectionEl) => {
    const sectionLabel = $(sectionEl).find(".sb-section__hd").first().text().trim() || "Autre";

    $(sectionEl).find("a.sb-link").each((__, linkEl) => {
      const $link = $(linkEl);
      const href = $link.attr("href");
      // On exclut les liens externes (cible _blank, ex: "voir ma page publique"),
      // la déconnexion et les liens désactivés (href="#") : pas des "pages".
      if (!href || href === "#" || href === "/logout" || $link.attr("target")) return;
      if ($link.hasClass("sb-link--disabled")) return;

      const key = hrefToKey(href);
      if (seen.has(key)) return; // jamais deux fois la même page
      seen.add(key);

      // href d'affichage : on masque l'ObjectId factice de détection
      // (ex: "/etablissement/000…000/collaborateurs" → "/etablissement/:id/collaborateurs").
      const displayHref = href.replace(/[0-9a-f]{24}/gi, ":id");
      const label = $link.find("span").first().text().trim() || href;
      links.push({ key, href: displayHref, label, section: sectionLabel });
    });
  });

  _cache = links;
  return links;
}

module.exports = { extractNavLinks, hrefToKey };
