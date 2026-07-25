// ── API mobile : collaborateurs (l'équipe de l'établissement) ─────────────
//   GET    /collaborators                       équipe + invitations + demandes
//   POST   /collaborators                       inviter par email (avec un grade)
//   PATCH  /collaborators/:membershipId         changer le grade / (dés)activer
//   DELETE /collaborators/:membershipId         retirer de l'établissement
//   PATCH  /collaborators/requests/:membershipId accepter / refuser une demande
//
// Réplique controllers/establishment.controller.js (page « Collaborateurs » +
// inviteCollaborator / updateCollaboratorGrade / toggleCollaboratorActive /
// removeCollaborator / respondJoinRequestForCompany). Toutes les requêtes sont
// filtrées par l'établissement courant (req.companyCtx.currentCompany._id).
const User = require("../../db/models/user.model");
const CompanyMembership = require("../../db/models/company/companyMembership.model");
const CompanyGrade = require("../../db/models/company/companyGrade.model");
const { getCollaboratorLimit } = require("../../utils/planLimits");
const { logActivity } = require("../../utils/activityLog");
const {
  ensureDefaultGrade,
  ensureBuiltInGrades,
} = require("../establishment.controller");

const OBJECT_ID = /^[a-f0-9]{24}$/i;

function serializeMember(m) {
  return {
    id: String(m._id),
    userId: String(m.user._id),
    fullName: m.user.fullName || "",
    email: m.user.email || "",
    profilePicture: m.user.profilePicture || "",
    gradeId: m.grade ? String(m.grade._id) : "",
    gradeName: (m.grade && m.grade.name) || "(aucun grade)",
    isActive: m.isActive !== false,
    isEmployee: !!m.isEmployee,
    status: m.status,
    since: m.acceptedAt || m.createdAt,
  };
}

// GET /api/v1/collaborators
exports.list = async (req, res) => {
  try {
    const company = req.companyCtx.currentCompany;

    // Comme sur le web : un établissement sans grade n'existe pas côté UI, on
    // sème "Manager"/"Staff" à la première consultation.
    await ensureBuiltInGrades(company._id);

    const [memberships, grades] = await Promise.all([
      CompanyMembership.find({ company: company._id })
        .populate("user", "fullName email profilePicture")
        .populate("grade")
        .sort({ createdAt: 1 })
        .lean(),
      CompanyGrade.find({ company: company._id }).sort({ createdAt: 1 }).lean(),
    ]);

    const withUser = memberships.filter((m) => m.user);

    const collaborators = withUser
      .filter((m) => m.status === "accepted")
      .map(serializeMember);

    // Invitations envoyées par l'établissement, en attente de réponse.
    const invitations = withUser
      .filter((m) => m.status === "pending" && m.invitedByOwner)
      .map((m) => ({
        id: String(m._id),
        fullName: m.user.fullName || "",
        email: m.user.email || "",
        profilePicture: m.user.profilePicture || "",
        gradeName: (m.grade && m.grade.name) || "",
        invitedAt: m.createdAt,
      }));

    // Demandes reçues : quelqu'un veut rejoindre, à accepter ou refuser.
    const requests = withUser
      .filter((m) => m.status === "pending" && !m.invitedByOwner)
      .map((m) => ({
        id: String(m._id),
        fullName: m.user.fullName || "",
        email: m.user.email || "",
        profilePicture: m.user.profilePicture || "",
        requestedAt: m.createdAt,
      }));

    const activeCount = collaborators.filter((c) => c.isActive).length;
    const limit = getCollaboratorLimit(req.companyCtx.billingUser);
    const perms = req.companyCtx.permissions;

    res.json({
      collaborators,
      invitations,
      requests,
      grades: grades.map((g) => ({
        id: String(g._id),
        name: g.name,
        isBuiltIn: !!g.isBuiltIn,
        memberCount: collaborators.filter((c) => c.gradeId === String(g._id)).length,
      })),
      limit: Number.isFinite(limit) ? limit : null, // null = illimité
      used: activeCount,
      atLimit: activeCount >= limit,
      canManage: !!(perms && perms.collaborators && perms.collaborators.manage),
      // Assigner un grade = distribuer des permissions : exige aussi grades.manage.
      canAssignGrade: !!(
        perms &&
        perms.collaborators &&
        perms.collaborators.manage &&
        perms.grades &&
        perms.grades.manage
      ),
    });
  } catch (err) {
    console.error("[mobile team list]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/collaborators  { email, gradeId? }
exports.invite = async (req, res) => {
  try {
    const company = req.companyCtx.currentCompany;

    // Limites du forfait de L'ÉTABLISSEMENT (billingUser), comme le web.
    const limit = getCollaboratorLimit(req.companyCtx.billingUser);
    if (limit <= 0) {
      return res.status(403).json({
        error: "plan_limit",
        message: "Votre forfait ne permet pas d'inviter de collaborateurs. Passez au forfait Pro ou Business.",
      });
    }

    const activeCount = await CompanyMembership.countDocuments({
      company: company._id,
      status: "accepted",
      isActive: { $ne: false },
    });
    if (activeCount >= limit) {
      return res.status(403).json({
        error: "plan_limit",
        message: `Votre forfait permet ${limit} collaborateur${limit > 1 ? "s" : ""} au maximum. Passez à un forfait supérieur pour en ajouter davantage.`,
      });
    }

    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "invalid_input", message: "Indiquez l'email du collaborateur." });
    }

    const target = await User.findOne({ email });
    if (!target) {
      return res.status(404).json({
        error: "user_not_found",
        message: "Aucun compte Branshee trouvé avec cet email. La personne doit d'abord créer un compte.",
      });
    }
    if (String(target._id) === String(company.owner)) {
      return res.status(400).json({
        error: "invalid_input",
        message: "Cette personne est déjà propriétaire de cet établissement.",
      });
    }

    // Choisir le grade d'un invité, c'est distribuer des permissions : même
    // exigence que le changement de grade (`update`), sinon quelqu'un qui ne
    // peut pas promouvoir un collègue existant pourrait quand même inviter un
    // complice directement avec le grade le plus permissif.
    let grade = null;
    const canAssignGrade = !!req.companyCtx.permissions?.grades?.manage;
    if (canAssignGrade && req.body.gradeId && OBJECT_ID.test(String(req.body.gradeId))) {
      grade = await CompanyGrade.findOne({ _id: req.body.gradeId, company: company._id });
    }
    if (!grade) grade = await ensureDefaultGrade(company._id);

    const existing = await CompanyMembership.findOne({ company: company._id, user: target._id });
    if (existing && existing.status === "accepted" && existing.isActive !== false) {
      return res.status(400).json({
        error: "already_member",
        message: "Cette personne fait déjà partie de l'équipe.",
      });
    }
    if (existing && existing.status === "pending" && existing.invitedByOwner) {
      return res.status(400).json({
        error: "already_invited",
        message: "Une invitation est déjà en attente pour cette personne.",
      });
    }

    await CompanyMembership.findOneAndUpdate(
      { company: company._id, user: target._id },
      { status: "pending", grade: grade._id, invitedByOwner: true },
      { upsert: true },
    );

    logActivity({
      company: company._id,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "collaborator.invite",
      description: `a invité "${target.fullName}" comme collaborateur (${grade.name}) — en attente d'acceptation`,
    });

    res.json({
      ok: true,
      invitation: {
        fullName: target.fullName || "",
        email: target.email || "",
        gradeName: grade.name,
      },
    });
  } catch (err) {
    console.error("[mobile team invite]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PATCH /api/v1/collaborators/:membershipId  { gradeId?, isActive? }
//
// Deux actions distinctes en une route : changer le grade et activer/désactiver
// l'accès. Le changement de grade est le plus sensible — il exige en plus
// `grades.manage` et interdit d'agir sur son propre grade (règle anti-élévation
// du web : sinon un collaborateur autorisé à gérer l'équipe s'octroierait un
// grade tout-puissant).
exports.update = async (req, res) => {
  try {
    const company = req.companyCtx.currentCompany;
    const { membershipId } = req.params;
    if (!OBJECT_ID.test(String(membershipId))) {
      return res.status(404).json({ error: "not_found", message: "Collaborateur introuvable." });
    }

    const membership = await CompanyMembership.findOne({
      _id: membershipId,
      company: company._id,
      status: "accepted",
    }).populate("user", "fullName");
    if (!membership) {
      return res.status(404).json({ error: "not_found", message: "Collaborateur introuvable." });
    }

    const perms = req.companyCtx.permissions;
    const isOwner = !!req.companyCtx.isOwner;
    const changes = [];

    // ── Changement de grade ────────────────────────────────────────────────
    if (req.body.gradeId !== undefined) {
      if (!perms?.grades?.manage) {
        return res.status(403).json({
          error: "forbidden",
          message: "Attribuer un grade demande aussi le droit de gérer les grades.",
        });
      }
      if (!isOwner && String(membership.user._id) === String(req.mobileUser._id)) {
        return res.status(403).json({
          error: "forbidden",
          message: "Vous ne pouvez pas modifier votre propre grade.",
        });
      }

      const grade = await CompanyGrade.findOne({ _id: req.body.gradeId, company: company._id });
      if (!grade) {
        return res.status(400).json({ error: "invalid_input", message: "Grade introuvable." });
      }

      membership.grade = grade._id;
      changes.push({
        action: "collaborator.role",
        description: `a changé le grade de "${membership.user?.fullName || "un collaborateur"}" en ${grade.name}`,
      });
    }

    // ── Activation / suspension de l'accès ─────────────────────────────────
    if (req.body.isActive !== undefined) {
      const isActive = !!req.body.isActive;
      membership.isActive = isActive;
      changes.push({
        action: isActive ? "collaborator.activate" : "collaborator.deactivate",
        description: isActive
          ? `a réactivé l'accès de "${membership.user?.fullName || "un collaborateur"}"`
          : `a désactivé l'accès de "${membership.user?.fullName || "un collaborateur"}"`,
      });
    }

    if (!changes.length) {
      return res.status(400).json({ error: "invalid_input", message: "Aucune modification demandée." });
    }

    await membership.save();
    changes.forEach((c) => {
      logActivity({
        company: company._id,
        user: req.mobileUser,
        role: req.companyCtx.role,
        action: c.action,
        description: c.description,
      });
    });

    const fresh = await CompanyMembership.findById(membership._id)
      .populate("user", "fullName email profilePicture")
      .populate("grade")
      .lean();

    res.json({ ok: true, collaborator: serializeMember(fresh) });
  } catch (err) {
    console.error("[mobile team update]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// DELETE /api/v1/collaborators/:membershipId
exports.remove = async (req, res) => {
  try {
    const company = req.companyCtx.currentCompany;
    const { membershipId } = req.params;
    if (!OBJECT_ID.test(String(membershipId))) {
      return res.status(404).json({ error: "not_found", message: "Collaborateur introuvable." });
    }

    const removed = await CompanyMembership.findOneAndDelete({
      _id: membershipId,
      company: company._id,
    }).populate("user", "fullName");
    if (!removed) {
      return res.status(404).json({ error: "not_found", message: "Collaborateur introuvable." });
    }

    logActivity({
      company: company._id,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "collaborator.remove",
      description: `a retiré "${removed.user?.fullName || "un collaborateur"}" de l'établissement`,
    });

    res.json({ ok: true, id: String(removed._id) });
  } catch (err) {
    console.error("[mobile team remove]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PATCH /api/v1/collaborators/requests/:membershipId  { decision }
exports.respondRequest = async (req, res) => {
  try {
    const company = req.companyCtx.currentCompany;
    const { membershipId } = req.params;
    if (!OBJECT_ID.test(String(membershipId))) {
      return res.status(404).json({ error: "not_found", message: "Demande introuvable." });
    }

    const decision = req.body.decision === "accepted" ? "accepted" : "rejected";

    const membership = await CompanyMembership.findOne({
      _id: membershipId,
      company: company._id,
      status: "pending",
    }).populate("user", "fullName email profilePicture");
    if (!membership) {
      return res.status(404).json({ error: "not_found", message: "Demande introuvable." });
    }

    // Accepter fait entrer une personne de plus dans l'équipe : on revérifie la
    // limite du forfait, comme à l'invitation.
    if (decision === "accepted") {
      const limit = getCollaboratorLimit(req.companyCtx.billingUser);
      const activeCount = await CompanyMembership.countDocuments({
        company: company._id,
        status: "accepted",
        isActive: { $ne: false },
      });
      if (activeCount >= limit) {
        return res.status(403).json({
          error: "plan_limit",
          message: `Votre forfait permet ${limit} collaborateur${limit > 1 ? "s" : ""} au maximum. Passez à un forfait supérieur pour accepter cette demande.`,
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
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: decision === "accepted" ? "collaborator.invite" : "collaborator.reject",
      description:
        decision === "accepted"
          ? `a accepté la demande de "${membership.user?.fullName || "un utilisateur"}" pour rejoindre l'établissement`
          : `a refusé la demande de "${membership.user?.fullName || "un utilisateur"}" pour rejoindre l'établissement`,
    });

    let collaborator = null;
    if (decision === "accepted") {
      const fresh = await CompanyMembership.findById(membership._id)
        .populate("user", "fullName email profilePicture")
        .populate("grade")
        .lean();
      collaborator = serializeMember(fresh);
    }

    res.json({ ok: true, id: String(membership._id), decision, collaborator });
  } catch (err) {
    console.error("[mobile team respondRequest]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
