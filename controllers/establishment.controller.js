const User = require("../db/models/user.model");
const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const { getPlan, getLimit } = require("../utils/planLimits");
const getServices = require("../utils/services");
const { logActivity } = require("../utils/activityLog");

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function formatCompanyForList(company, owner) {
  return {
    id: String(company._id),
    name: company.name || owner.businessName || "Établissement sans nom",
    businessType: company.businessType || owner.businessType || "",
    photo: company.photo || owner.businessPicture || "/images/no-user.webp",
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
    status: "accepted",
  })
    .populate({ path: "company", populate: { path: "owner", select: "businessName fullName" } })
    .lean();

  const companiesLimit = getLimit("companies", owner);
  const ownedFormatted = owned.map((c) => formatCompanyForList(c, owner));
  const memberOf = memberships
    .filter((m) => m.company && !m.company.isDeleted)
    .map((m) => ({
      id: String(m.company._id),
      name: m.company.name || (m.company.owner && (m.company.owner.businessName || m.company.owner.fullName)) || "Établissement sans nom",
      role: m.role,
      isActive: m.isActive !== false,
      acceptedAt: m.acceptedAt,
    }));

  return res.render("etablissement/mes-etablissements", {
    title: "Mes établissements — BranShee",
    pageName: "Mes établissements",
    establishments: ownedFormatted,
    memberOf,
    companiesLimit: companiesLimit === Infinity ? null : companiesLimit,
    companiesCount: owned.length,
    atCompanyLimit: owned.length >= companiesLimit,
    currentPlan: getPlan(owner),
    services: getServices(res.locals.lang),
  });
};

// ── Créer un nouvel établissement (le 1er, ou un supplémentaire) ─────────────
exports.createEstablishment = async (req, res) => {
  try {
    const owner = req.user;
    const ownedCount = await Company.countDocuments({ owner: owner._id, isDeleted: { $ne: true } });
    const limit = getLimit("companies", owner);
    if (ownedCount >= limit) {
      return res.status(403).json({
        error: limit <= 1
          ? "Votre forfait ne permet de gérer qu'un seul établissement. Passez à un forfait supérieur pour en créer plusieurs."
          : `Votre forfait ne permet de gérer que ${limit} établissements maximum.`,
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
    const company = await loadOwnedCompanyOr403(req, res);
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
    const company = await loadOwnedCompanyOr403(req, res);
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
    const company = await loadOwnedCompanyOr403(req, res);
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
    const company = await loadOwnedCompanyOr403(req, res);
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

// ── Page : créer un établissement (réutilise le formulaire "register-style") ─
exports.renderCreatePage = async (req, res) => {
  const owner = req.user;
  const ownedCount = await Company.countDocuments({ owner: owner._id, isDeleted: { $ne: true } });
  const limit = getLimit("companies", owner);
  if (ownedCount >= limit) {
    return res.redirect("/etablissement/mes-etablissements");
  }
  return res.render("etablissement/creer", {
    title: "Créer votre établissement — BranShee",
    services: getServices(res.locals.lang),
    isAdditional: ownedCount > 0,
  });
};

// ── Middleware : ouvrir la page collaborateurs d'un établissement le bascule
// automatiquement en établissement "actif" pour le reste du dashboard admin
// (cohérent avec le bouton "Gérer" de la liste — cf. switchActiveCompany) ────
exports.setActiveCompanyForCollabPage = async (req, res, next) => {
  try {
    const company = await Company.findOne({
      _id: req.params.id,
      owner: req.user._id,
      isDeleted: { $ne: true },
    }).lean();
    if (!company) return res.redirect("/etablissement/mes-etablissements");

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

  const owner = req.user;
  const memberships = await CompanyMembership.find({ company: company._id })
    .populate("user", "fullName email profilePicture")
    .sort({ createdAt: 1 })
    .lean();

  const accepted = memberships
    .filter((m) => m.status === "accepted" && m.user)
    .map((m) => ({
      id: String(m._id),
      fullName: m.user.fullName,
      email: m.user.email,
      profilePicture: m.user.profilePicture || "/images/no-user.webp",
      role: m.role || "staff",
      isActive: m.isActive !== false,
      acceptedAt: m.acceptedAt || m.createdAt,
    }));

  const pendingRequests = memberships
    .filter((m) => m.status === "pending" && m.user)
    .map((m) => ({
      id: String(m._id),
      fullName: m.user.fullName,
      email: m.user.email,
      profilePicture: m.user.profilePicture || "/images/no-user.webp",
      requestedAt: m.createdAt,
    }));

  const collaboratorsLimit = getLimit("collaborators", owner);

  return res.render("etablissement/collaborateurs", {
    title: "Collaborateurs — BranShee",
    pageName: "Collaborateurs",
    company: formatCompanyForList(company, owner),
    collaborators: accepted,
    pendingRequests,
    collaboratorsLimit: collaboratorsLimit === Infinity ? null : collaboratorsLimit,
    atCollaboratorsLimit: accepted.length >= collaboratorsLimit,
    currentPlan: getPlan(owner),
  });
};

// ── Inviter un collaborateur par email ───────────────────────────────────────
exports.inviteCollaborator = async (req, res) => {
  try {
    const company = await loadOwnedCompanyOr403(req, res);
    if (!company) return;

    const owner = req.user;
    const limit = getLimit("collaborators", owner);
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
    if (String(target._id) === String(owner._id)) {
      return res.status(400).json({ error: "Vous êtes déjà le propriétaire de cet établissement." });
    }

    const role = req.body.role === "manager" ? "manager" : "staff";

    const existing = await CompanyMembership.findOne({ company: company._id, user: target._id });
    if (existing && existing.status === "accepted" && existing.isActive !== false) {
      return res.status(400).json({ error: "Cette personne est déjà collaboratrice de cet établissement." });
    }

    await CompanyMembership.findOneAndUpdate(
      { company: company._id, user: target._id },
      { status: "accepted", role, isActive: true, acceptedAt: new Date() },
      { upsert: true }
    );

    logActivity({
      company: company._id,
      user: owner,
      role: "owner",
      action: "collaborator.invite",
      description: `a ajouté "${target.fullName}" comme collaborateur (${role === "manager" ? "manager" : "staff"})`,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("inviteCollaborator error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Changer le rôle d'un collaborateur ───────────────────────────────────────
exports.updateCollaboratorRole = async (req, res) => {
  try {
    const company = await loadOwnedCompanyOr403(req, res);
    if (!company) return;

    const role = req.body.role === "manager" ? "manager" : "staff";
    const membership = await CompanyMembership.findOneAndUpdate(
      { _id: req.params.membershipId, company: company._id, status: "accepted" },
      { role },
      { new: true }
    ).populate("user", "fullName");
    if (!membership) return res.status(404).json({ error: "Collaborateur introuvable." });

    logActivity({
      company: company._id,
      user: req.user,
      role: "owner",
      action: "collaborator.role",
      description: `a changé le rôle de "${membership.user?.fullName || "un collaborateur"}" en ${role === "manager" ? "manager" : "staff"}`,
    });

    return res.json({ success: true, role: membership.role });
  } catch (err) {
    console.error("updateCollaboratorRole error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Activer / désactiver l'accès d'un collaborateur ──────────────────────────
exports.toggleCollaboratorActive = async (req, res) => {
  try {
    const company = await loadOwnedCompanyOr403(req, res);
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
    const company = await loadOwnedCompanyOr403(req, res);
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
    const company = await loadOwnedCompanyOr403(req, res);
    if (!company) return;

    const decision = req.body.decision === "accepted" ? "accepted" : "rejected";
    const membership = await CompanyMembership.findOne({
      _id: req.params.membershipId,
      company: company._id,
      status: "pending",
    }).populate("user", "fullName");
    if (!membership) return res.status(404).json({ error: "Demande introuvable." });

    membership.status = decision;
    if (decision === "accepted") {
      membership.acceptedAt = new Date();
      if (!membership.role) membership.role = "staff";
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

module.exports.loadOwnedCompanyOr403 = loadOwnedCompanyOr403;
