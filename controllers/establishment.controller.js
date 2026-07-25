const User = require("../db/models/user.model");
const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const CompanyGrade = require("../db/models/company/companyGrade.model");
const { getCollaboratorLimit, canCreateEstablishment, getCompanyPlan, billingUserFor } = require("../utils/planLimits");
const getServices = require("../utils/services");
const { logActivity } = require("../utils/activityLog");

// Grade par défaut assigné à un nouveau collaborateur (invitation ou demande
// acceptée) quand aucun grade n'est explicitement choisi — créé par la
// migration pour toute company existante ; pour une company toute neuve,
// créé à la volée ici si besoin (cf. ensureDefaultGrade).
async function ensureDefaultGrade(companyId) {
  const { DEFAULT_GRADE_TEMPLATES } = require("../utils/permissions");
  let grade = await CompanyGrade.findOne({ company: companyId, name: "Staff" });
  if (!grade) {
    grade = await CompanyGrade.create({
      company: companyId,
      name: "Staff",
      isBuiltIn: true,
      permissions: DEFAULT_GRADE_TEMPLATES.Staff,
    });
  }
  return grade;
}

// Crée les grades "Manager"/"Staff" pour une company qui n'en a encore
// aucun (établissement créé avant le système de grades, ou tout neuf) —
// cf. scripts/migrate-seed-grades.js pour l'équivalent en masse.
async function ensureBuiltInGrades(companyId) {
  const existingCount = await CompanyGrade.countDocuments({ company: companyId });
  if (existingCount > 0) return;
  const { DEFAULT_GRADE_TEMPLATES } = require("../utils/permissions");
  for (const name of Object.keys(DEFAULT_GRADE_TEMPLATES)) {
    await CompanyGrade.create({
      company: companyId,
      name,
      isBuiltIn: true,
      permissions: DEFAULT_GRADE_TEMPLATES[name],
    });
  }
}

// Réutilisés tels quels par l'API mobile (controllers/mobile/team.mobile.controller.js)
// pour garantir une seule source de vérité sur les grades par défaut.
exports.ensureDefaultGrade = ensureDefaultGrade;
exports.ensureBuiltInGrades = ensureBuiltInGrades;

// ── Helpers ──────────────────────────────────────────────────────────────────

// Owner-only strict — réservé aux actions qui ne doivent JAMAIS être
// déléguées même via un grade (cf. controllers/grade.controller.js).
async function loadOwnedCompanyOr403(req, res) {
  const company = await Company.findOne({
    _id: req.params.id,
    owner: req.user._id,
    isDeleted: { $ne: true },
  });
  if (!company) {
    res.status(404).json({ error: "Établissement introuvable." });
    return null;
  }
  return company;
}

// Owner OU collaborateur accepté+actif de cette company — la vraie
// autorisation fine (quelle permission précise est requise) est déjà
// vérifiée par `requirePermission()` au niveau de la route ; ce loader ne
// fait que confirmer que l'utilisateur a un lien quelconque avec cette
// company avant de la charger (cf. système de grades/permissions).
async function loadAccessibleCompanyOr403(req, res) {
  const company = await Company.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
  if (!company) {
    res.status(404).json({ error: "Établissement introuvable." });
    return null;
  }
  const isOwner = String(company.owner) === String(req.user._id);
  if (!isOwner) {
    const membership = await CompanyMembership.findOne({
      company: company._id,
      user: req.user._id,
      status: "accepted",
      isActive: { $ne: false },
    }).lean();
    if (!membership) {
      res.status(403).json({ error: "Accès refusé." });
      return null;
    }
  }
  return company;
}

// Compte PROPRIÉTAIRE de l'établissement — c'est lui qui porte la facturation
// et le repli d'identité, jamais `req.user` (qui peut n'être qu'un
// collaborateur ayant la permission d'agir sur cet établissement).
async function loadCompanyOwner(company, req) {
  if (String(company.owner) === String(req.user._id)) return req.user;
  return await User.findById(company.owner)
    .select("subscription isPremium manualPremium addons businessName fullName businessPicture")
    .lean();
}

function formatCompanyForList(company, owner) {
  return {
    id: String(company._id),
    // Repli sur le compte propriétaire pour les fiches historiques (Company
    // créée avant que name/photo ne vivent sur l'établissement).
    name: company.name || (owner && (owner.businessName || owner.fullName)) || "Établissement sans nom",
    businessType: company.businessType || (owner && owner.businessType) || "",
    photo: company.photo || (owner && owner.businessPicture) || "/images/no-user.webp",
    slug: company.slug || "",
    isPaused: !!company.isPaused,
    createdAt: company.createdAt,
  };
}

// ── Page : liste de mes établissements ────────────────────────────────────────
exports.listMyEstablishments = async (req, res) => {
  const owner = req.user;
  const owned = await Company.find({ owner: owner._id, isDeleted: { $ne: true } })
    .sort({ createdAt: 1 })
    .lean();

  const memberships = await CompanyMembership.find({
    user: owner._id,
    status: { $in: ["accepted", "pending", "rejected"] },
  })
    .populate({ path: "company", populate: { path: "owner", select: "businessName fullName" } })
    .populate("grade", "name")
    .lean();

  // Règle de création portée par l'établissement (cf. canCreateEstablishment) :
  // 1 gratuit inclus, + 1 gratuit par Business, sinon tous les établissements
  // doivent être payants (Pro min.) pour en créer un de plus.
  const createInfo = canCreateEstablishment(owned, owner);
  // Le forfait appartient à l'établissement : chaque ligne porte le sien
  // (getCompanyPlan retombe sur le compte tant que company.plan est vide).
  const ownedFormatted = owned.map((c) => ({
    ...formatCompanyForList(c, owner),
    plan: getCompanyPlan(c, owner),
  }));

  function companyLabel(m) {
    return (m.company && (m.company.name || (m.company.owner && (m.company.owner.businessName || m.company.owner.fullName)))) || "Établissement sans nom";
  }

  const live = memberships.filter((m) => m.company && !m.company.isDeleted);
  const memberOf = live
    .filter((m) => m.status === "accepted")
    .map((m) => ({
      id: String(m.company._id),
      name: companyLabel(m),
      role: m.grade?.name || "",
      isActive: m.isActive !== false,
      acceptedAt: m.acceptedAt,
    }));
  // Demandes envoyées par le collaborateur, en attente d'approbation du patron
  const pendingRequests = live
    .filter((m) => m.status === "pending" && !m.invitedByOwner)
    .map((m) => ({ id: String(m._id), name: companyLabel(m), requestedAt: m.createdAt }));
  // Invitations reçues du patron, en attente d'acceptation par le collaborateur
  const pendingInvitations = live
    .filter((m) => m.status === "pending" && m.invitedByOwner)
    .map((m) => ({ id: String(m._id), name: companyLabel(m), invitedAt: m.createdAt }));
  const rejectedRequests = live
    .filter((m) => m.status === "rejected")
    .map((m) => ({ id: String(m._id), name: companyLabel(m), requestedAt: m.createdAt }));

  return res.render("etablissement/mes-etablissements", {
    title: "Mes établissements — BranShee",
    pageName: "Mes établissements",
    establishments: ownedFormatted,
    memberOf,
    pendingRequests,
    pendingInvitations,
    rejectedRequests,
    companiesCount: owned.length,
    canCreateEstab: createInfo.canCreate,
    // `currentPlan` n'est PAS repassé ici : celui d'injectCompany (plan de
    // l'établissement actif) doit rester en place pour la sidebar. Le plan
    // propre à chaque ligne est porté par `establishments[].plan`.
    services: getServices(res.locals.lang),
  });
};

// ── Créer un nouvel établissement (le 1er, ou un supplémentaire) ─────────────
exports.createEstablishment = async (req, res) => {
  try {
    const owner = req.user;
    const owned = await Company.find({ owner: owner._id, isDeleted: { $ne: true } }).lean();
    if (!canCreateEstablishment(owned, owner).canCreate) {
      return res.status(403).json({
        error: "Pour créer un nouvel établissement, vos établissements existants doivent être sur un forfait payant (Pro minimum). Passez au Pro, ou supprimez un établissement gratuit.",
      });
    }

    const name = (req.body.name || "").trim();
    const businessType = (req.body.businessType || "").trim();
    if (!name) {
      return res.status(400).json({ error: "Indiquez un nom pour votre établissement." });
    }
    // Toujours renseigné explicitement à la création (photo uploadée, sinon
    // une image neutre par défaut) — pour ne JAMAIS retomber sur la photo du
    // compte owner au runtime (cf. formatCompanyForList) : avec plusieurs
    // établissements, ce repli affichait la même photo partout, donnant
    // l'impression erronée que la nouvelle établissement avait "copié" l'ancienne.
    const photo = (req.body.photo || "").trim() || "/images/no-user.webp";

    const company = await Company.create({
      owner: owner._id,
      name,
      businessType,
      photo,
      schedule: [
        { weekdayIndex: 1, workingHours: [{ start: "09:00", end: "18:00" }] },
        { weekdayIndex: 2, workingHours: [{ start: "09:00", end: "18:00" }] },
        { weekdayIndex: 3, workingHours: [{ start: "09:00", end: "18:00" }] },
        { weekdayIndex: 4, workingHours: [{ start: "09:00", end: "18:00" }] },
        { weekdayIndex: 5, workingHours: [{ start: "09:00", end: "18:00" }] },
        { weekdayIndex: 6, dayOff: true },
        { weekdayIndex: 0, dayOff: true },
      ],
    });

    // Le User garde une trace qu'il possède au moins un établissement (utilisé
    // par injectClientUser.js pour "hasEstablishment" dans la sidebar) sans
    // jamais être réassigné à null par la suite.
    await User.findByIdAndUpdate(owner._id, { company: company._id, accountIntent: "pro" });

    logActivity({
      company: company._id,
      user: owner,
      role: "owner",
      action: "establishment.create",
      description: `a créé l'établissement "${name}"`,
    });

    return res.json({ success: true, redirect: "/etablissement/mes-etablissements" });
  } catch (err) {
    console.error("createEstablishment error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Modifier nom / type d'activité ───────────────────────────────────────────
exports.updateEstablishment = async (req, res) => {
  try {
    const company = await loadAccessibleCompanyOr403(req, res);
    if (!company) return;

    const update = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: "Le nom ne peut pas être vide." });
      update.name = name;
    }
    if (req.body.businessType !== undefined) update.businessType = String(req.body.businessType).trim();

    await Company.findByIdAndUpdate(company._id, update);
    logActivity({
      company: company._id,
      user: req.user,
      role: "owner",
      action: "establishment.update",
      description: `a modifié les informations de l'établissement "${update.name || company.name}"`,
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("updateEstablishment error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Photo de l'établissement ──────────────────────────────────────────────────
exports.updateEstablishmentPhoto = async (req, res) => {
  try {
    const company = await loadAccessibleCompanyOr403(req, res);
    if (!company) return;
    if (!req.file) return res.status(400).json({ error: "Aucune image reçue." });

    const imagePath = `/uploads/profiles/${req.file.filename}`;
    await Company.findByIdAndUpdate(company._id, { photo: imagePath });
    return res.json({ success: true, path: imagePath });
  } catch (err) {
    console.error("updateEstablishmentPhoto error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Mettre en pause / réactiver ──────────────────────────────────────────────
exports.togglePauseEstablishment = async (req, res) => {
  try {
    const company = await loadAccessibleCompanyOr403(req, res);
    if (!company) return;

    const isPaused = !!req.body.isPaused;
    await Company.findByIdAndUpdate(company._id, { isPaused });
    logActivity({
      company: company._id,
      user: req.user,
      role: "owner",
      action: isPaused ? "establishment.pause" : "establishment.resume",
      description: isPaused
        ? `a mis en pause l'établissement "${company.name}"`
        : `a réactivé l'établissement "${company.name}"`,
    });
    return res.json({ success: true, isPaused });
  } catch (err) {
    console.error("togglePauseEstablishment error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Supprimer (suppression douce) ────────────────────────────────────────────
exports.deleteEstablishment = async (req, res) => {
  try {
    const company = await loadAccessibleCompanyOr403(req, res);
    if (!company) return;

    await Company.findByIdAndUpdate(company._id, { isDeleted: true, deletedAt: new Date(), isPaused: true });
    logActivity({
      company: company._id,
      user: req.user,
      role: "owner",
      action: "establishment.delete",
      description: `a supprimé l'établissement "${company.name}"`,
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("deleteEstablishment error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Middleware : ouvrir la page collaborateurs d'un établissement le bascule
// automatiquement en établissement "actif" pour le reste du dashboard admin
// (cohérent avec le bouton "Gérer" de la liste — cf. switchActiveCompany) ────
exports.setActiveCompanyForCollabPage = async (req, res, next) => {
  try {
    const company = await Company.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
    if (!company) return res.redirect("/etablissement/mes-etablissements");

    const isOwner = String(company.owner) === String(req.user._id);
    if (!isOwner) {
      const membership = await CompanyMembership.findOne({
        company: company._id,
        user: req.user._id,
        status: "accepted",
        isActive: { $ne: false },
      }).lean();
      if (!membership) return res.redirect("/etablissement/mes-etablissements");
    }

    req.session.activeCompanyId = String(company._id);
    next();
  } catch (err) {
    console.error("setActiveCompanyForCollabPage error:", err.message);
    return res.redirect("/etablissement/mes-etablissements");
  }
};

// ── Page : collaborateurs d'un établissement ─────────────────────────────────
exports.renderCollaboratorsPage = async (req, res) => {
  const company = res.locals.currentCompany;
  if (!company) return res.redirect("/etablissement/mes-etablissements");

  await ensureBuiltInGrades(company._id);

  // Le "patron" affiché sur cette page est toujours le OWNER de l'établissement
  // (carte "Patron", limites de plan) — JAMAIS req.user, qui n'est que la
  // personne connectée : un collaborateur consultant cette page ne doit pas
  // voir sa propre identité/plan affichés comme si c'était lui le patron.
  const owner = String(company.owner) === String(req.user._id)
    ? req.user
    : await User.findById(company.owner).lean();
  const { resolveCanManageOwnTimeOff } = require("../utils/permissions");
  const [memberships, grades] = await Promise.all([
    CompanyMembership.find({ company: company._id })
      .populate("user", "fullName email profilePicture")
      .populate("grade")
      .sort({ createdAt: 1 })
      .lean(),
    CompanyGrade.find({ company: company._id }).sort({ createdAt: 1 }).lean(),
  ]);

  const accepted = memberships
    .filter((m) => m.status === "accepted" && m.user)
    .map((m) => ({
      id: String(m._id),
      userId: String(m.user._id),
      fullName: m.user.fullName,
      email: m.user.email,
      profilePicture: m.user.profilePicture || "/images/no-user.webp",
      gradeId: m.grade ? String(m.grade._id) : "",
      gradeName: m.grade?.name || "(aucun grade)",
      canManageOwnTimeOff: m.canManageOwnTimeOff, // null = hérite du grade
      canManageOwnTimeOffEffective: resolveCanManageOwnTimeOff({ isOwner: false, grade: m.grade, membershipOverride: m.canManageOwnTimeOff }),
      isActive: m.isActive !== false,
      acceptedAt: m.acceptedAt || m.createdAt,
      isEmployee: !!m.isEmployee,
      displayName: m.displayName || "",
      displayPhoto: m.displayPhoto || "",
      description: m.description || "",
      showRole: !!m.showRole,
      customInfo: m.customInfo || [],
    }));

  const gradesFormatted = grades.map((g) => ({
    id: String(g._id),
    name: g.name,
    isBuiltIn: !!g.isBuiltIn,
    permissions: g.permissions,
    memberCount: accepted.filter((m) => m.gradeId === String(g._id)).length,
  }));

  // Demandes reçues : collaborateur a demandé à rejoindre, le patron approuve
  const pendingRequests = memberships
    .filter((m) => m.status === "pending" && m.user && !m.invitedByOwner)
    .map((m) => ({
      id: String(m._id),
      fullName: m.user.fullName,
      email: m.user.email,
      profilePicture: m.user.profilePicture || "/images/no-user.webp",
      requestedAt: m.createdAt,
    }));

  // Invitations envoyées : patron a invité, en attente d'acceptation du collaborateur
  const pendingInvitations = memberships
    .filter((m) => m.status === "pending" && m.user && m.invitedByOwner)
    .map((m) => ({
      id: String(m._id),
      fullName: m.user.fullName,
      email: m.user.email,
      profilePicture: m.user.profilePicture || "/images/no-user.webp",
      gradeName: m.grade?.name || "",
      invitedAt: m.createdAt,
    }));

  // Limites lues sur le forfait de L'ÉTABLISSEMENT (pas du compte owner) :
  // avec plusieurs établissements, un seul chiffre pour tous était faux.
  const billing = billingUserFor(company, owner);
  const collaboratorsLimit = getCollaboratorLimit(billing);

  const ownerProfile = company.ownerEmployeeProfile || {};
  const { PERMISSION_SCHEMA, PERMISSION_GROUPS } = require("../utils/permissions");

  return res.render("etablissement/collaborateurs", {
    title: "Collaborateurs — BranShee",
    pageName: "Collaborateurs",
    company: formatCompanyForList(company, owner),
    ownerUser: owner,
    collaborators: accepted,
    grades: gradesFormatted,
    permissionSchema: PERMISSION_SCHEMA,
    permissionGroups: PERMISSION_GROUPS,
    pendingRequests,
    pendingInvitations,
    collaboratorsLimit: collaboratorsLimit === Infinity ? null : collaboratorsLimit,
    atCollaboratorsLimit: accepted.length >= collaboratorsLimit,
    currentPlan: getCompanyPlan(company, owner),
    extraCollaboratorSeats: billing.addons.extraCollaboratorSeats || 0,
    ownerProfile: {
      isEmployee: ownerProfile.isEmployee !== false,
      displayName: ownerProfile.displayName || "",
      displayPhoto: ownerProfile.displayPhoto || "",
      description: ownerProfile.description || "",
      showRole: !!ownerProfile.showRole,
      customInfo: ownerProfile.customInfo || [],
    },
  });
};

// ── Page dédiée : gestion des grades ────────────────────────────────────────
exports.renderGradesPage = async (req, res) => {
  const company = res.locals.currentCompany;
  if (!company) return res.redirect("/etablissement/mes-etablissements");

  await ensureBuiltInGrades(company._id);

  const owner = String(company.owner) === String(req.user._id)
    ? req.user
    : await User.findById(company.owner).lean();

  const [memberships, grades] = await Promise.all([
    require("../db/models/company/companyMembership.model")
      .find({ company: company._id, status: "accepted" }).lean(),
    CompanyGrade.find({ company: company._id }).sort({ createdAt: 1 }).lean(),
  ]);

  const gradesFormatted = grades.map((g) => ({
    id: String(g._id),
    name: g.name,
    isBuiltIn: !!g.isBuiltIn,
    permissions: g.permissions,
    memberCount: memberships.filter((m) => String(m.grade) === String(g._id)).length,
  }));

  const { PERMISSION_SCHEMA, PERMISSION_GROUPS } = require("../utils/permissions");

  return res.render("etablissement/grades", {
    title: "Grades — BranShee",
    pageName: "Grades",
    company: { id: String(company._id), name: company.name || "Établissement" },
    grades: gradesFormatted,
    permissionSchema: PERMISSION_SCHEMA,
    permissionGroups: PERMISSION_GROUPS,
  });
};

// ── Profil employé public — collaborateur ou patron (cf. fusion Employé/
// Collaborateur) : displayName/displayPhoto sont des surcharges optionnelles,
// customInfo une liste libre label/valeur (ex. "Expérience : 10 ans"). ──────
const MAX_CUSTOM_INFO = 10;
const MAX_FIELD_LENGTH = 200;

function sanitizeEmployeeProfileBody(body) {
  const update = {};
  if (body.isEmployee !== undefined) update.isEmployee = !!body.isEmployee;
  if (body.displayName !== undefined) update.displayName = String(body.displayName).trim().slice(0, MAX_FIELD_LENGTH);
  if (body.displayPhoto !== undefined) update.displayPhoto = String(body.displayPhoto).trim().slice(0, 500);
  if (body.description !== undefined) update.description = String(body.description).trim().slice(0, 1000);
  if (body.showRole !== undefined) update.showRole = !!body.showRole;
  if (body.customInfo !== undefined) {
    const raw = Array.isArray(body.customInfo) ? body.customInfo : [];
    update.customInfo = raw
      .filter((i) => i && (i.label || i.value))
      .slice(0, MAX_CUSTOM_INFO)
      .map((i) => ({
        label: String(i.label || "").trim().slice(0, 60),
        value: String(i.value || "").trim().slice(0, MAX_FIELD_LENGTH),
      }));
  }
  return update;
}

// ── Mettre à jour le profil employé public d'un collaborateur ────────────────
// Droit d'office (peu importe le grade) : un collaborateur peut toujours
// modifier SON PROPRE profil d'affichage (nom, photo, description, infos) —
// cf. demande "le collab X doit pouvoir juste modifier son profil". Modifier
// le profil d'un AUTRE collaborateur, ou se rendre soi-même visible/masqué
// (isEmployee, qui affecte la page de réservation publique), reste réservé
// à collaborators.manage.
exports.updateCollaboratorEmployeeProfile = async (req, res) => {
  try {
    const company = await loadAccessibleCompanyOr403(req, res);
    if (!company) return;

    const membership = await CompanyMembership.findOne({ _id: req.params.membershipId, company: company._id, status: "accepted" });
    if (!membership) return res.status(404).json({ error: "Collaborateur introuvable." });

    const { getPermissionsForCompanyAndUser } = require("../utils/permissions");
    const isOwnProfile = String(membership.user) === String(req.user._id);
    const permissions = await getPermissionsForCompanyAndUser(company._id, req.user._id);
    const canManageCollaborators = !!permissions?.collaborators.manage;

    if (!isOwnProfile && !canManageCollaborators) {
      return res.status(403).json({ error: "forbidden", message: "Vous n'avez pas la permission d'effectuer cette action." });
    }

    const update = sanitizeEmployeeProfileBody(req.body || {});
    if (!canManageCollaborators) delete update.isEmployee;

    Object.assign(membership, update);
    await membership.save();
    await membership.populate("user", "fullName");

    return res.json({
      success: true,
      profile: {
        isEmployee: !!membership.isEmployee,
        displayName: membership.displayName || "",
        displayPhoto: membership.displayPhoto || "",
        description: membership.description || "",
        showRole: !!membership.showRole,
        customInfo: membership.customInfo || [],
      },
    });
  } catch (err) {
    console.error("updateCollaboratorEmployeeProfile error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Mettre à jour le profil employé public du patron (= owner, qui n'a pas
// de CompanyMembership pour son propre établissement) ───────────────────────
exports.updateOwnerEmployeeProfile = async (req, res) => {
  try {
    const company = await loadAccessibleCompanyOr403(req, res);
    if (!company) return;

    const update = sanitizeEmployeeProfileBody(req.body || {});
    const setOps = {};
    Object.keys(update).forEach((k) => { setOps[`ownerEmployeeProfile.${k}`] = update[k]; });

    const updated = await Company.findByIdAndUpdate(company._id, { $set: setOps }, { new: true }).lean();
    const profile = updated.ownerEmployeeProfile || {};

    return res.json({
      success: true,
      profile: {
        isEmployee: profile.isEmployee !== false,
        displayName: profile.displayName || "",
        displayPhoto: profile.displayPhoto || "",
        description: profile.description || "",
        showRole: !!profile.showRole,
        customInfo: profile.customInfo || [],
      },
    });
  } catch (err) {
    console.error("updateOwnerEmployeeProfile error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Inviter un collaborateur par email ───────────────────────────────────────
exports.inviteCollaborator = async (req, res) => {
  try {
    const company = await loadAccessibleCompanyOr403(req, res);
    if (!company) return;

    // La limite de sièges est celle de L'ÉTABLISSEMENT (donc de son owner) :
    // `loadAccessibleCompanyOr403` laisse passer un collaborateur, dont le
    // forfait personnel n'a rien à voir avec celui de l'établissement.
    const ownerUser = await loadCompanyOwner(company, req);
    const limit = getCollaboratorLimit(billingUserFor(company, ownerUser));
    if (limit <= 0) {
      return res.status(403).json({ error: "Votre forfait ne permet pas d'inviter de collaborateurs. Passez au forfait Pro ou Business." });
    }

    const activeCount = await CompanyMembership.countDocuments({
      company: company._id,
      status: "accepted",
      isActive: { $ne: false },
    });
    if (activeCount >= limit) {
      return res.status(403).json({ error: `Votre forfait ne permet que ${limit} collaborateur(s) maximum. Passez à un forfait supérieur pour en ajouter davantage.` });
    }

    const email = (req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Indiquez l'email du collaborateur." });

    const target = await User.findOne({ email });
    if (!target) {
      return res.status(404).json({ error: "Aucun compte BranShee trouvé avec cet email. La personne doit d'abord créer un compte." });
    }
    // On compare au PATRON de l'établissement, pas à l'inviteur : sinon un
    // collaborateur pouvait « inviter » le patron dans son propre établissement.
    if (String(target._id) === String(company.owner)) {
      return res.status(400).json({ error: "Cette personne est déjà le propriétaire de cet établissement." });
    }

    // Choisir le grade d'un invité = distribuer des permissions : cela exige
    // AUSSI `grades.manage`, comme le changement de grade d'un collaborateur
    // déjà en place (cf. routes/user/account.js). Sinon `collaborators.manage`
    // seul permettait d'inviter quelqu'un directement avec le grade le plus
    // permissif. Sans cette permission, on retombe sur le grade par défaut.
    const { getPermissionsForCompanyAndUser } = require("../utils/permissions");
    const inviterPerms = await getPermissionsForCompanyAndUser(company._id, req.user._id);
    const canAssignGrade = !!inviterPerms?.grades?.manage;

    let grade = null;
    if (canAssignGrade && req.body.gradeId) {
      grade = await CompanyGrade.findOne({ _id: req.body.gradeId, company: company._id });
    }
    if (!grade) grade = await ensureDefaultGrade(company._id);

    const existing = await CompanyMembership.findOne({ company: company._id, user: target._id });
    if (existing && existing.status === "accepted" && existing.isActive !== false) {
      return res.status(400).json({ error: "Cette personne est déjà collaboratrice de cet établissement." });
    }
    if (existing && existing.status === "pending" && existing.invitedByOwner) {
      return res.status(400).json({ error: "Une invitation est déjà en attente pour cette personne." });
    }

    await CompanyMembership.findOneAndUpdate(
      { company: company._id, user: target._id },
      { status: "pending", grade: grade._id, invitedByOwner: true },
      { upsert: true }
    );

    logActivity({
      company: company._id,
      user: req.user, // identité de l'auteur de l'action, pas du patron
      role: "owner",
      action: "collaborator.invite",
      description: `a invité "${target.fullName}" comme collaborateur (${grade.name}) — en attente d'acceptation`,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("inviteCollaborator error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Changer le grade d'un collaborateur (assigne un grade EXISTANT — la
// création/édition des grades eux-mêmes reste owner-only via
// controllers/grade.controller.js, jamais déléguée) ──────────────────────────
exports.updateCollaboratorGrade = async (req, res) => {
  try {
    const company = await loadAccessibleCompanyOr403(req, res);
    if (!company) return;

    const grade = await CompanyGrade.findOne({ _id: req.body.gradeId, company: company._id });
    if (!grade) return res.status(400).json({ error: "Grade introuvable." });

    // Anti auto-escalade : on ne peut pas modifier son propre grade (sinon on
    // s'octroie soi-même un grade plus puissant). Seul le patron reste libre.
    const target = await CompanyMembership.findOne({ _id: req.params.membershipId, company: company._id }).select("user").lean();
    const isOwner = String(company.owner) === String(req.user._id);
    if (target && !isOwner && String(target.user) === String(req.user._id)) {
      return res.status(403).json({ error: "Vous ne pouvez pas modifier votre propre grade." });
    }

    const membership = await CompanyMembership.findOneAndUpdate(
      { _id: req.params.membershipId, company: company._id, status: "accepted" },
      { grade: grade._id },
      { new: true }
    ).populate("user", "fullName");
    if (!membership) return res.status(404).json({ error: "Collaborateur introuvable." });

    logActivity({
      company: company._id,
      user: req.user,
      role: "owner",
      action: "collaborator.role",
      description: `a changé le grade de "${membership.user?.fullName || "un collaborateur"}" en ${grade.name}`,
    });

    return res.json({ success: true, gradeId: String(grade._id), gradeName: grade.name });
  } catch (err) {
    console.error("updateCollaboratorGrade error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Override individuel : autoriser/interdire à CE collaborateur de poser
// ses propres congés, indépendamment de son grade ────────────────────────────
exports.updateCollaboratorTimeOffPermission = async (req, res) => {
  try {
    const company = await loadAccessibleCompanyOr403(req, res);
    if (!company) return;

    // null = retour à l'héritage du grade ; true/false = override explicite.
    const raw = req.body.canManageOwnTimeOff;
    const value = raw === null || raw === undefined ? null : !!raw;

    const membership = await CompanyMembership.findOneAndUpdate(
      { _id: req.params.membershipId, company: company._id, status: "accepted" },
      { canManageOwnTimeOff: value },
      { new: true }
    );
    if (!membership) return res.status(404).json({ error: "Collaborateur introuvable." });

    return res.json({ success: true, canManageOwnTimeOff: membership.canManageOwnTimeOff });
  } catch (err) {
    console.error("updateCollaboratorTimeOffPermission error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Activer / désactiver l'accès d'un collaborateur ──────────────────────────
exports.toggleCollaboratorActive = async (req, res) => {
  try {
    const company = await loadAccessibleCompanyOr403(req, res);
    if (!company) return;

    const isActive = !!req.body.isActive;
    const membership = await CompanyMembership.findOneAndUpdate(
      { _id: req.params.membershipId, company: company._id, status: "accepted" },
      { isActive },
      { new: true }
    ).populate("user", "fullName");
    if (!membership) return res.status(404).json({ error: "Collaborateur introuvable." });

    logActivity({
      company: company._id,
      user: req.user,
      role: "owner",
      action: isActive ? "collaborator.activate" : "collaborator.deactivate",
      description: isActive
        ? `a réactivé l'accès de "${membership.user?.fullName || "un collaborateur"}"`
        : `a désactivé l'accès de "${membership.user?.fullName || "un collaborateur"}"`,
    });

    return res.json({ success: true, isActive: membership.isActive });
  } catch (err) {
    console.error("toggleCollaboratorActive error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Retirer un collaborateur (virer) ─────────────────────────────────────────
exports.removeCollaborator = async (req, res) => {
  try {
    const company = await loadAccessibleCompanyOr403(req, res);
    if (!company) return;

    const removed = await CompanyMembership.findOneAndDelete({ _id: req.params.membershipId, company: company._id })
      .populate("user", "fullName");
    if (!removed) return res.status(404).json({ error: "Collaborateur introuvable." });

    logActivity({
      company: company._id,
      user: req.user,
      role: "owner",
      action: "collaborator.remove",
      description: `a retiré "${removed.user?.fullName || "un collaborateur"}" de l'établissement`,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("removeCollaborator error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Répondre à une demande pour rejoindre (scoping multi-établissements) ─────
exports.respondJoinRequestForCompany = async (req, res) => {
  try {
    const company = await loadAccessibleCompanyOr403(req, res);
    if (!company) return;

    const decision = req.body.decision === "accepted" ? "accepted" : "rejected";
    const membership = await CompanyMembership.findOne({
      _id: req.params.membershipId,
      company: company._id,
      status: "pending",
    }).populate("user", "fullName");
    if (!membership) return res.status(404).json({ error: "Demande introuvable." });

    // La limite de sièges doit être revérifiée à l'ACCEPTATION : une demande
    // reçue quand il restait de la place peut être approuvée des mois plus
    // tard, l'établissement étant entre-temps plein ou retombé en gratuit.
    if (decision === "accepted") {
      const ownerUser = await loadCompanyOwner(company, req);
      const limit = getCollaboratorLimit(billingUserFor(company, ownerUser));
      const activeCount = await CompanyMembership.countDocuments({
        company: company._id,
        status: "accepted",
        isActive: { $ne: false },
      });
      if (activeCount >= limit) {
        return res.status(403).json({
          error: "plan_limit",
          message: limit <= 0
            ? "Votre forfait ne permet pas d'ajouter de collaborateurs. Passez au forfait Pro ou Business."
            : `Votre forfait permet ${limit} collaborateur(s) au maximum. Passez à un forfait supérieur pour en ajouter davantage.`,
        });
      }
    }

    membership.status = decision;
    if (decision === "accepted") {
      membership.acceptedAt = new Date();
      if (!membership.grade) membership.grade = (await ensureDefaultGrade(company._id))._id;
    }
    await membership.save();

    logActivity({
      company: company._id,
      user: req.user,
      role: "owner",
      action: decision === "accepted" ? "collaborator.invite" : "collaborator.reject",
      description: decision === "accepted"
        ? `a accepté la demande de "${membership.user?.fullName || "un utilisateur"}" pour rejoindre l'établissement`
        : `a refusé la demande de "${membership.user?.fullName || "un utilisateur"}" pour rejoindre l'établissement`,
    });

    return res.json({ success: true, decision });
  } catch (err) {
    console.error("respondJoinRequestForCompany error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Choisir l'établissement actif pour cette session ─────────────────────────
exports.switchActiveCompany = async (req, res) => {
  try {
    const target = await Company.findOne({
      _id: req.params.id,
      owner: req.user._id,
      isDeleted: { $ne: true },
    }).lean();

    let allowed = !!target;
    if (!allowed) {
      const membership = await CompanyMembership.findOne({
        company: req.params.id,
        user: req.user._id,
        status: "accepted",
        isActive: { $ne: false },
      }).lean();
      allowed = !!membership;
    }
    if (!allowed) return res.status(403).json({ error: "Accès refusé." });

    req.session.activeCompanyId = req.params.id;
    return res.json({ success: true, redirect: "/appointment" });
  } catch (err) {
    console.error("switchActiveCompany error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Démarrage express (« 3 clics ») ─────────────────────────────────────────
// Parcours ultra-court pour convertir un compte « espace client » (sans
// établissement) en pro : nom + logo + métier → dispos → lien partageable.
// Réutilise la même création que createEstablishment mais en une seule passe,
// avec upload de logo et horaires choisis, puis renvoie le lien de réservation.

// Libellés courts des jours pour l'écran de dispos (index Date.getDay()).
const QS_DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

exports.quickStartPage = async (req, res) => {
  if (!req.user) return res.redirect("/login");
  try {
    // Le wizard est AUSSI le flux « Créer un nouvel établissement » (multi-
    // établissements) : on ne redirige que si l'utilisateur a atteint la limite
    // de son forfait — pas dès qu'il en a déjà un.
    const owned = await Company.find({ owner: req.user._id, isDeleted: { $ne: true } }).lean();
    if (owned.length && !canCreateEstablishment(owned, req.user).canCreate) {
      return res.redirect("/etablissement/mes-etablissements");
    }
  } catch (_) { /* on laisse passer, le POST re-vérifie de toute façon */ }

  return res.render("client/quick-start", {
    title: "Créer mon établissement en 1 minute — BranShee",
    prefillName: (req.user.businessName || "").trim(),
    prefillType: (req.user.businessType || "").trim(),
    dayLabels: QS_DAY_LABELS,
    services: getServices(res.locals.lang),
  });
};

exports.quickStartCreate = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Vous devez être connecté." });
    const owner = req.user;

    // Un compte gratuit ne peut avoir qu'un établissement — garde-fou (le
    // parcours n'est proposé qu'aux comptes sans établissement, mais on
    // revérifie côté serveur pour ne jamais créer de doublon).
    const owned = await Company.find({ owner: owner._id, isDeleted: { $ne: true } }).lean();
    if (!canCreateEstablishment(owned, owner).canCreate) {
      return res.status(403).json({ error: "Pour créer un nouvel établissement, vos établissements existants doivent être sur un forfait payant (Pro minimum).", redirect: "/etablissement/mes-etablissements" });
    }

    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "Indiquez le nom de votre établissement." });
    const businessType = (req.body.businessType || "").trim();

    // Logo (optionnel) — déjà converti/écrit sur disque par processSingleImage.
    let photoPath = "";
    if (req.file && req.file.filename) {
      photoPath = `/uploads/profiles/${req.file.filename}`;
    }

    // ── Disponibilités : jours ouverts + plage horaire commune ──────────────
    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    const start = timeRe.test(req.body.start || "") ? req.body.start : "09:00";
    const end   = timeRe.test(req.body.end || "")   ? req.body.end   : "18:00";
    const daysRaw = String(req.body.days || "1,2,3,4,5")
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    const openDays = new Set(daysRaw.length ? daysRaw : [1, 2, 3, 4, 5]);
    // Sécurité : si l'heure de fin ≤ heure de début, on retombe sur 09-18.
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const validRange = eh * 60 + em > sh * 60 + sm;
    const S = validRange ? start : "09:00";
    const E = validRange ? end : "18:00";
    const schedule = [0, 1, 2, 3, 4, 5, 6].map((idx) =>
      openDays.has(idx)
        ? { weekdayIndex: idx, workingHours: [{ start: S, end: E }] }
        : { weekdayIndex: idx, dayOff: true },
    );

    const company = await Company.create({
      owner: owner._id,
      name,
      businessType,
      photo: photoPath || "/images/no-user.webp",
      schedule,
    });

    // Le compte devient pro : businessName/Type/Picture alimentent la page
    // publique, la recherche et la checklist d'onboarding du dashboard.
    const userUpdate = { company: company._id, accountIntent: "pro" };
    // Lien réputé « partagé » dès l'express : l'écran final le met en avant.
    userUpdate["onboarding.linkShared"] = true;
    // Le profil « principal » (businessName/Type/Picture du compte) n'est
    // renseigné qu'à la PREMIÈRE création — pour ne pas l'écraser quand on crée
    // un établissement supplémentaire (multi-établissements). Le nom/type/photo
    // propres à chaque établissement vivent de toute façon sur la Company.
    if (!owner.businessName) userUpdate.businessName = name;
    if (!owner.businessType && businessType) userUpdate.businessType = businessType;
    if (photoPath && !owner.businessPicture) userUpdate.businessPicture = photoPath;
    await User.findByIdAndUpdate(owner._id, userUpdate);

    // Le nouvel établissement devient l'établissement actif → /panel l'affiche.
    if (req.session) req.session.activeCompanyId = String(company._id);

    logActivity({
      company: company._id,
      user: owner,
      role: "owner",
      action: "establishment.create",
      description: `a créé l'établissement "${name}" (démarrage express)`,
    });

    const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
    const bookingPath = "/" + (company.slug || company._id);
    return res.json({
      success: true,
      bookingUrlDisplay: "branshee.com" + bookingPath,
      bookingUrlFull: (env.appBaseUrl || "https://www.branshee.com") + bookingPath,
      servicesUrl: "/services",
      dashboardUrl: "/panel",
    });
  } catch (err) {
    console.error("quickStartCreate error:", err.message);
    return res.status(500).json({ error: "Une erreur est survenue. Réessayez." });
  }
};

// ── Demande d'indexation d'un métier ────────────────────────────────────────
// Un utilisateur qui saisit un métier absent de notre liste peut demander son
// ajout : on prévient l'admin par email (le métier reste accepté entre-temps).
exports.requestMetierIndex = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Vous devez être connecté." });
    const metier = (req.body.metier || "").toString().trim().slice(0, 80);
    if (!metier) return res.status(400).json({ error: "Indiquez un métier." });

    const { sendEmail } = require("../utils/mailer");
    const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const html = `
        <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;">
          <h2 style="margin:0 0 12px;">Demande d'indexation de métier</h2>
          <p style="margin:0 0 8px;">Métier demandé : <b style="color:#15803d;">${esc(metier)}</b></p>
          <p style="margin:0 0 4px;color:#555;">Par : ${esc(req.user.fullName || "")} — ${esc(req.user.email || "")}</p>
          <p style="margin:12px 0 0;color:#777;font-size:13px;">Ajoutez-le à <code>utils/services.js</code> s'il est pertinent.</p>
        </div>`;
      sendEmail(adminEmail, `[BranShee] Demande d'indexation métier : ${metier}`, html).catch(() => {});
    }
    console.log(`[metier-request] "${metier}" demandé par ${req.user.email}`);
    return res.json({ success: true });
  } catch (err) {
    console.error("requestMetierIndex error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

module.exports.loadOwnedCompanyOr403 = loadOwnedCompanyOr403;
