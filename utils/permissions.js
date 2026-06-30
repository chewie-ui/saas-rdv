// Moteur de permissions du système de grades (cf. db/models/company/companyGrade.model.js).
//
// Le patron (Company.owner) n'a jamais de CompanyMembership pour sa propre
// Company — son accès est toujours total (OWNER_PERMISSIONS), jamais filtré
// par un grade. Tout collaborateur accepté+actif a un grade qui détermine
// son accès via `resolvePermissions()`. `res.locals.permissions` est injecté
// une fois par requête par middlewares/injectCompany.js et consulté soit
// directement, soit via le middleware `requirePermission()` ci-dessous.

// ── Zones & sous-permissions (doit matcher companyGrade.model.js) ──────────
const PERMISSION_SCHEMA = {
  appointments:  { label: "Rendez-vous",      icon: "appointments", description: "Le calendrier et l'historique des réservations.", keys: { view: "Voir", manage: "Créer / modifier", cancelDelete: "Annuler / supprimer" } },
  clients:       { label: "Clients",          icon: "clients", description: "Les dossiers et coordonnées de vos clients/patients.", keys: { view: "Voir", manage: "Modifier les dossiers" } },
  services:      { label: "Services",         icon: "services", description: "Les prestations proposées, leurs prix et durées.", keys: { view: "Voir", manage: "Créer / modifier / supprimer" } },
  groupSessions: { label: "Cours collectifs", icon: "groupSessions", description: "Les ateliers et séances à plusieurs participants.", keys: { view: "Voir", manage: "Créer / modifier / supprimer" } },
  availability: {
    label: "Disponibilités",
    icon: "availability",
    description: "Horaires de travail, congés et créneaux proposés aux clients.",
    keys: {
      manageShared:         "Modifier l'horaire commun",
      manageOwnSchedule:     "Modifier son propre horaire",
      manageOthersSchedule:  "Modifier l'horaire des autres employés",
      manageOwnTimeOff:      "Poser ses propres congés",
      manageOthersTimeOff:   "Gérer les congés des autres employés",
    },
  },
  forms:         { label: "Formulaires",          icon: "forms", description: "Le questionnaire affiché avant la réservation.", keys: { manage: "Modifier" } },
  customization: { label: "Personnalisation",     icon: "customization", description: "Logo, couleurs, galerie et mise en page de la page publique.", keys: { manage: "Modifier (branding, galerie, calendrier)" } },
  settings:      { label: "Paramètres",           icon: "settings", description: "Notifications, rappels, politique d'annulation.", keys: { manage: "Modifier (notifications, rappels, annulation...)" } },
  collaborators: { label: "Collaborateurs",       icon: "collaborators", description: "L'équipe : invitations, accès à la page et gestion.", keys: { view: "Voir", manage: "Inviter / retirer / assigner un grade" } },
  grades:        { label: "Grades & permissions", icon: "grades", description: "La configuration des grades et de leurs niveaux d'accès.", keys: { view: "Voir les grades", manage: "Créer / modifier / supprimer" } },
  logs:          { label: "Logs",                 icon: "logs", description: "L'historique des actions effectuées sur l'établissement.", keys: { view: "Voir" } },
  billing:       { label: "Facturation",          icon: "billing", description: "Abonnement, Stripe Connect et moyens de paiement.", keys: { manage: "Abonnement, Stripe Connect, moyens de paiement" } },
  establishment: { label: "Établissement",        icon: "establishment", description: "Les informations générales et l'existence même de l'établissement.", keys: { manage: "Modifier les infos", delete: "Supprimer l'établissement" } },
};

// ── Regroupement à l'écran (édition d'un grade) — calqué sur les sections du
// sidebar (cf. views/common/sidebar.pug) pour que la mécanique de permissions
// "ressemble" à la navigation que le collaborateur verra une fois le grade
// assigné : plus facile à se représenter que 12 zones listées à plat.
const PERMISSION_GROUPS = [
  {
    title: "Au quotidien",
    description: "Ce que l'équipe consulte et modifie tous les jours.",
    zones: ["appointments", "clients"],
  },
  {
    title: "Mon activité",
    description: "Ce que l'établissement propose et comment il se présente.",
    zones: ["services", "groupSessions", "availability", "customization", "forms"],
  },
  {
    title: "Équipe & administration",
    description: "Accès sensibles : l'équipe, l'historique, l'argent et l'établissement lui-même.",
    zones: ["collaborators", "grades", "logs", "billing", "establishment", "settings"],
  },
];

function buildPermissionsObject(value) {
  const out = {};
  for (const zone of Object.keys(PERMISSION_SCHEMA)) {
    out[zone] = {};
    for (const key of Object.keys(PERMISSION_SCHEMA[zone].keys)) {
      out[zone][key] = value;
    }
  }
  return out;
}

// Le patron a toujours tout — jamais bloqué par un grade.
const OWNER_PERMISSIONS = buildPermissionsObject(true);

// Aucun accès (compte pending/rejected/suspendu, ou pas de grade assigné).
const EMPTY_PERMISSIONS = buildPermissionsObject(false);

// ── Grades pré-remplis créés à la migration / à la première invitation ────
// Calqués sur le comportement actuel codé en dur (cf. exploration menée
// avant ce plan) : Manager = accès large sauf facturation/suppression
// d'établissement ; Staff = accès quotidien restreint, pas de Logs/
// Collaborateurs/Disponibilités/annulation de RDV.
const DEFAULT_GRADE_TEMPLATES = {
  Manager: {
    appointments:  { view: true, manage: true, cancelDelete: true },
    clients:       { view: true, manage: true },
    services:      { view: true, manage: true },
    groupSessions: { view: true, manage: true },
    availability:  { manageShared: true, manageOwnSchedule: true, manageOthersSchedule: true, manageOwnTimeOff: true, manageOthersTimeOff: true },
    forms:         { manage: true },
    customization: { manage: true },
    settings:      { manage: true },
    collaborators: { view: true, manage: false },
    grades:        { view: true, manage: false },
    logs:          { view: true },
    billing:       { manage: false },
    establishment: { manage: false, delete: false },
  },
  Staff: {
    appointments:  { view: true, manage: true, cancelDelete: false },
    clients:       { view: true, manage: true },
    services:      { view: true, manage: false },
    groupSessions: { view: true, manage: false },
    availability:  { manageShared: false, manageOwnSchedule: false, manageOthersSchedule: false, manageOwnTimeOff: true, manageOthersTimeOff: false },
    forms:         { manage: false },
    customization: { manage: false },
    settings:      { manage: false },
    collaborators: { view: false, manage: false },
    grades:        { view: false, manage: false },
    logs:          { view: false },
    billing:       { manage: false },
    establishment: { manage: false, delete: false },
  },
};

// ── Résolution ──────────────────────────────────────────────────────────────

/**
 * @param {boolean} isOwner
 * @param {{permissions: object}|null} grade - CompanyGrade document (ou null)
 */
function resolvePermissions({ isOwner, grade }) {
  if (isOwner) return OWNER_PERMISSIONS;
  if (!grade || !grade.permissions) return EMPTY_PERMISSIONS;
  // Reconstruire depuis le schéma pour garantir que toutes les zones/clés
  // existent même si le grade a été créé avant l'ajout d'une nouvelle zone.
  const out = {};
  for (const zone of Object.keys(PERMISSION_SCHEMA)) {
    out[zone] = {};
    for (const key of Object.keys(PERMISSION_SCHEMA[zone].keys)) {
      out[zone][key] = !!grade.permissions[zone]?.[key];
    }
  }
  return out;
}

/**
 * `canManageOwnTimeOff` a 3 états possibles sur CompanyMembership :
 * true/false = override explicite du patron sur CETTE personne précise,
 * null = hérite de son grade (availability.manageOwnTimeOff).
 */
function resolveCanManageOwnTimeOff({ isOwner, grade, membershipOverride }) {
  if (isOwner) return true;
  if (membershipOverride === true || membershipOverride === false) return membershipOverride;
  return !!grade?.permissions?.availability?.manageOwnTimeOff;
}

/**
 * Lit `res.locals.permissions` en dot-notation, ex: hasPermission(res, "services.manage").
 */
function hasPermission(res, path) {
  const permissions = res?.locals?.permissions;
  if (!permissions) return false;
  const [zone, key] = path.split(".");
  return !!permissions[zone]?.[key];
}

/**
 * Middleware factory — 403 JSON pour les routes API (préfixe /api ou méthode
 * non-GET), redirige vers /appointment pour les pages classiques.
 */
function requirePermission(path) {
  return (req, res, next) => {
    if (hasPermission(res, path)) return next();
    const isApiLike = req.method !== "GET" || req.originalUrl.startsWith("/api");
    if (isApiLike) {
      return res.status(403).json({ error: "forbidden", message: "Vous n'avez pas la permission d'effectuer cette action." });
    }
    return res.redirect("/appointment");
  };
}

/**
 * Variante de requirePermission() pour les routes qui agissent sur un
 * établissement précisé dans l'URL (`req.params[paramName]`), PAS forcément
 * l'établissement "actif" en session — ex. gérer les collaborateurs d'un
 * établissement B alors que l'établissement A est l'actif du moment. On ne
 * peut pas se fier à `res.locals.permissions` (résolu par injectCompany pour
 * l'établissement actif) : on recharge nous-mêmes le bon contexte ici.
 */
/**
 * Recharge le bon contexte de permissions pour UN établissement précis +
 * UN user précis, indépendamment de l'établissement "actif" en session
 * (cf. requirePermissionForParamCompany ci-dessous, qui s'appuie dessus).
 * Renvoie `null` si l'établissement n'existe pas OU si l'utilisateur n'en
 * fait pas partie (ni owner, ni membership accepté+actif) — à charge de
 * l'appelant de distinguer 404 vs 403 si besoin.
 */
async function getPermissionsForCompanyAndUser(companyId, userId) {
  const Company = require("../db/models/company/company.model");
  const CompanyMembership = require("../db/models/company/companyMembership.model");

  const company = await Company.findOne({ _id: companyId, isDeleted: { $ne: true } }).lean();
  if (!company) return null;

  const isOwner = String(company.owner) === String(userId);
  let grade = null;
  if (!isOwner) {
    const membership = await CompanyMembership.findOne({
      company: company._id,
      user: userId,
      status: "accepted",
      isActive: { $ne: false },
    }).populate("grade").lean();
    if (!membership) return null;
    grade = membership.grade || null;
  }

  return resolvePermissions({ isOwner, grade });
}

function requirePermissionForParamCompany(path, paramName) {
  const param = paramName || "id";
  return async (req, res, next) => {
    try {
      const Company = require("../db/models/company/company.model");

      const company = await Company.findOne({ _id: req.params[param], isDeleted: { $ne: true } }).lean();
      if (!company) return res.status(404).json({ error: "Établissement introuvable." });

      const permissions = await getPermissionsForCompanyAndUser(company._id, req.user._id);
      if (!permissions) return res.status(403).json({ error: "Accès refusé." });

      const [zone, key] = path.split(".");
      if (!permissions[zone]?.[key]) {
        return res.status(403).json({ error: "forbidden", message: "Vous n'avez pas la permission d'effectuer cette action." });
      }
      next();
    } catch (err) {
      console.error("requirePermissionForParamCompany error:", err.message);
      return res.status(500).json({ error: "Erreur serveur." });
    }
  };
}

module.exports = {
  PERMISSION_SCHEMA,
  PERMISSION_GROUPS,
  OWNER_PERMISSIONS,
  EMPTY_PERMISSIONS,
  DEFAULT_GRADE_TEMPLATES,
  resolvePermissions,
  resolveCanManageOwnTimeOff,
  hasPermission,
  requirePermission,
  requirePermissionForParamCompany,
  getPermissionsForCompanyAndUser,
};
