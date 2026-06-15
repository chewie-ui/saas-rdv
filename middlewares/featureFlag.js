const FeatureFlag = require("../db/models/featureFlag.model");

// Liste des pages/fonctionnalités pilotables depuis le superadmin.
// "key"   → identifiant stocké en base
// "label" → nom affiché dans l'interface superadmin
const FEATURES = [
  { key: "home",         label: "Page d'accueil (/)" },
  { key: "search",       label: "Recherche d'établissements (/search)" },
  { key: "register",     label: "Inscription (/register)" },
  { key: "login",        label: "Connexion (/login)" },
  { key: "booking_page", label: "Page de réservation (profil pro)" },
  { key: "admin_panel",  label: "Espace admin (tableau de bord)" },
  { key: "subscription", label: "Abonnement / Paiement" },
];

// Cache en mémoire pour éviter une requête DB sur chaque page vue.
let cache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 15 * 1000;

async function getFlagsMap() {
  const now = Date.now();
  if (cache && now < cacheExpiry) return cache;

  const docs = await FeatureFlag.find({}).lean();
  const map = {};
  docs.forEach((d) => { map[d.key] = d; });

  cache = map;
  cacheExpiry = now + CACHE_TTL_MS;
  return map;
}

function invalidateFeatureFlagCache() {
  cache = null;
  cacheExpiry = 0;
}

// Middleware : si la fonctionnalité "key" n'est pas "active", affiche la page
// de statut (maintenance / erreur / désactivé) au lieu du contenu normal.
function requireFeatureActive(key) {
  return async (req, res, next) => {
    try {
      const map = await getFlagsMap();
      const flag = map[key];

      if (flag && flag.status && flag.status !== "active") {
        return res.status(flag.status === "error" ? 503 : 200).render("client/feature-status", {
          title: "BranShee",
          status: flag.status,
          message: flag.message || "",
        });
      }
    } catch (_) {
      // En cas d'erreur DB, ne pas bloquer le site
    }
    next();
  };
}

// Toggle on/off générique (pour des fonctionnalités cachées, ex: SMS),
// désactivé par défaut tant qu'aucun document n'existe en base.
async function isFeatureEnabled(key) {
  try {
    const map = await getFlagsMap();
    return map[key]?.status === "active";
  } catch (_) {
    return false;
  }
}

// Fonctionnalités de l'espace admin que le superadmin peut activer/désactiver
// pour tester (cachées du sidebar et de leurs pages quand désactivées).
// Activées par défaut tant qu'aucun document "disabled" n'existe en base.
const ADMIN_FEATURES = [
  { key: "group_sessions", label: "Cours collectifs (rendez-vous de groupe)" },
  { key: "buffer_time",    label: "Temps tampon entre les réservations" },
];

async function isAdminFeatureEnabled(key) {
  try {
    const map = await getFlagsMap();
    return map[key]?.status !== "disabled";
  } catch (_) {
    return true;
  }
}

async function getAdminFeaturesFlags() {
  const map = await getFlagsMap();
  const flags = {};
  ADMIN_FEATURES.forEach((f) => {
    flags[f.key] = map[f.key]?.status !== "disabled";
  });
  return flags;
}

// Middleware : redirige vers /panel si la fonctionnalité admin "key" a été
// désactivée par le superadmin (ex: Cours collectifs).
function requireAdminFeature(key) {
  return async (req, res, next) => {
    const enabled = await isAdminFeatureEnabled(key);
    if (!enabled) return res.redirect("/panel");
    next();
  };
}

module.exports = {
  FEATURES,
  ADMIN_FEATURES,
  getFlagsMap,
  invalidateFeatureFlagCache,
  requireFeatureActive,
  isFeatureEnabled,
  isAdminFeatureEnabled,
  getAdminFeaturesFlags,
  requireAdminFeature,
};
