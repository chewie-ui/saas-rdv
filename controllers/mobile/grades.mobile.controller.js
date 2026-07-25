// ── API mobile : grades & permissions ─────────────────────────────────────
//   GET    /grades/schema        référentiel des zones/clés + regroupement
//   GET    /grades               grades de l'établissement + leur matrice
//   POST   /grades               créer un grade
//   PATCH  /grades/:gradeId      renommer / réajuster les permissions
//   DELETE /grades/:gradeId      supprimer (réassignation exigée si utilisé)
//
// Réplique controllers/grade.controller.js (web) : mêmes validations (nom
// requis, 60 caractères max, unicité par établissement), même filtrage des
// permissions inconnues, même règle de suppression (un grade encore porté par
// des collaborateurs ne part qu'avec un grade de remplacement).
//
// Toutes les requêtes sont filtrées par l'établissement courant
// (req.companyCtx.currentCompany._id) — jamais par un id venu du client.
const CompanyMembership = require("../../db/models/company/companyMembership.model");
const CompanyGrade = require("../../db/models/company/companyGrade.model");
const { PERMISSION_SCHEMA, PERMISSION_GROUPS } = require("../../utils/permissions");
const { ensureBuiltInGrades } = require("../establishment.controller");
const { logActivity } = require("../../utils/activityLog");

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAX_NAME = 60;

// Ne garde que les clés connues du schéma — identique au web : évite
// d'enregistrer des permissions arbitraires envoyées par un client modifié.
function sanitizePermissions(raw) {
  const out = {};
  const input = raw && typeof raw === "object" ? raw : {};
  for (const zone of Object.keys(PERMISSION_SCHEMA)) {
    out[zone] = {};
    for (const key of Object.keys(PERMISSION_SCHEMA[zone].keys)) {
      out[zone][key] = !!(input[zone] && input[zone][key]);
    }
  }
  return out;
}

// Règle anti-élévation, pendant de celle de team.mobile.controller.js
// (« Vous ne pouvez pas modifier votre propre grade ») : sans elle, au lieu de
// s'attribuer un grade puissant, il suffirait de rendre tout-puissant celui
// qu'on porte déjà. Le patron n'a pas d'adhésion à son propre établissement :
// il n'est jamais concerné.
async function carriesGrade(req, gradeId) {
  if (req.companyCtx.isOwner) return false;
  const membership = await CompanyMembership.findOne({
    company: req.companyCtx.currentCompany._id,
    user: req.mobileUser._id,
    status: "accepted",
  }).select("grade").lean();
  return !!(membership && membership.grade && String(membership.grade) === String(gradeId));
}

// Reconstruit la matrice depuis le schéma : un grade créé avant l'ajout d'une
// zone renvoie quand même toutes les clés (à false), l'app n'a jamais de trou.
function serializeGrade(grade, memberCount) {
  return {
    id: String(grade._id),
    name: grade.name,
    isBuiltIn: !!grade.isBuiltIn,
    memberCount,
    permissions: sanitizePermissions(grade.permissions),
    createdAt: grade.createdAt,
  };
}

// GET /api/v1/grades/schema
// Le référentiel vit côté serveur (utils/permissions.js) : l'app construit sa
// matrice à partir d'ici plutôt que de dupliquer 13 zones en dur.
exports.schema = async (req, res) => {
  try {
    const zones = Object.keys(PERMISSION_SCHEMA).map((zone) => ({
      zone,
      label: PERMISSION_SCHEMA[zone].label,
      description: PERMISSION_SCHEMA[zone].description || "",
      icon: PERMISSION_SCHEMA[zone].icon || "",
      keys: Object.keys(PERMISSION_SCHEMA[zone].keys).map((key) => ({
        key,
        label: PERMISSION_SCHEMA[zone].keys[key],
      })),
    }));

    res.json({
      zones,
      groups: PERMISSION_GROUPS.map((g) => ({
        title: g.title,
        description: g.description,
        zones: g.zones.slice(),
      })),
    });
  } catch (err) {
    console.error("[mobile grades schema]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// GET /api/v1/grades
exports.list = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;

    // Comme sur le web : un établissement sans aucun grade n'existe pas côté
    // UI, on sème "Manager"/"Staff" à la première consultation.
    await ensureBuiltInGrades(companyId);

    const [grades, memberships] = await Promise.all([
      CompanyGrade.find({ company: companyId }).sort({ createdAt: 1 }).lean(),
      CompanyMembership.find({ company: companyId, status: "accepted" }).select("grade").lean(),
    ]);

    const counts = {};
    memberships.forEach((m) => {
      if (!m.grade) return;
      const k = String(m.grade);
      counts[k] = (counts[k] || 0) + 1;
    });

    const perms = req.companyCtx.permissions;

    res.json({
      grades: grades.map((g) => serializeGrade(g, counts[String(g._id)] || 0)),
      canManage: !!(perms && perms.grades && perms.grades.manage),
    });
  } catch (err) {
    console.error("[mobile grades list]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/grades  { name, permissions }
exports.create = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;

    const name = String(req.body.name || "").trim().slice(0, MAX_NAME);
    if (!name) {
      return res.status(400).json({ error: "invalid_input", message: "Donnez un nom à ce grade." });
    }

    const exists = await CompanyGrade.findOne({ company: companyId, name });
    if (exists) {
      return res.status(400).json({ error: "duplicate_name", message: "Un grade porte déjà ce nom." });
    }

    const grade = await CompanyGrade.create({
      company: companyId,
      name,
      isBuiltIn: false,
      permissions: sanitizePermissions(req.body.permissions),
    });

    logActivity({
      company: companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "grade.create",
      description: `a créé le grade "${grade.name}"`,
    });

    res.status(201).json({ ok: true, grade: serializeGrade(grade, 0) });
  } catch (err) {
    console.error("[mobile grades create]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PATCH /api/v1/grades/:gradeId  { name?, permissions? }
exports.update = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const { gradeId } = req.params;
    if (!OBJECT_ID.test(String(gradeId))) {
      return res.status(404).json({ error: "not_found", message: "Grade introuvable." });
    }
    if (await carriesGrade(req, gradeId)) {
      return res.status(403).json({
        error: "forbidden",
        message: "Vous ne pouvez pas modifier le grade que vous portez vous-même.",
      });
    }

    const update = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, MAX_NAME);
      if (!name) {
        return res.status(400).json({ error: "invalid_input", message: "Donnez un nom à ce grade." });
      }
      const dupe = await CompanyGrade.findOne({ company: companyId, name, _id: { $ne: gradeId } });
      if (dupe) {
        return res.status(400).json({ error: "duplicate_name", message: "Un grade porte déjà ce nom." });
      }
      update.name = name;
    }
    if (req.body.permissions !== undefined) {
      update.permissions = sanitizePermissions(req.body.permissions);
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ error: "invalid_input", message: "Aucune modification demandée." });
    }

    const grade = await CompanyGrade.findOneAndUpdate(
      { _id: gradeId, company: companyId },
      update,
      { new: true },
    );
    if (!grade) {
      return res.status(404).json({ error: "not_found", message: "Grade introuvable." });
    }

    const memberCount = await CompanyMembership.countDocuments({
      company: companyId,
      status: "accepted",
      grade: grade._id,
    });

    logActivity({
      company: companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "grade.update",
      description: `a modifié le grade "${grade.name}"`,
    });

    res.json({ ok: true, grade: serializeGrade(grade, memberCount) });
  } catch (err) {
    console.error("[mobile grades update]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// DELETE /api/v1/grades/:gradeId  { reassignToGradeId? }
//
// Un grade encore porté par des collaborateurs ne disparaît pas en silence :
// le serveur répond `grade_in_use` avec le nombre de personnes concernées, et
// l'app renvoie le grade de remplacement choisi (même règle que le web).
exports.remove = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const { gradeId } = req.params;
    if (!OBJECT_ID.test(String(gradeId))) {
      return res.status(404).json({ error: "not_found", message: "Grade introuvable." });
    }
    // Par cohérence avec `update` : supprimer son propre grade reviendrait à
    // se faire réassigner un grade choisi par soi-même.
    if (await carriesGrade(req, gradeId)) {
      return res.status(403).json({
        error: "forbidden",
        message: "Vous ne pouvez pas supprimer le grade que vous portez vous-même.",
      });
    }

    const memberCount = await CompanyMembership.countDocuments({ company: companyId, grade: gradeId });

    if (memberCount > 0) {
      const reassignToGradeId = req.body && req.body.reassignToGradeId;
      if (!reassignToGradeId) {
        return res.status(400).json({
          error: "grade_in_use",
          message: `${memberCount} collaborateur${memberCount > 1 ? "s utilisent" : " utilise"} ce grade — choisissez un grade de remplacement pour le supprimer.`,
          memberCount,
        });
      }
      if (String(reassignToGradeId) === String(gradeId)) {
        return res.status(400).json({
          error: "invalid_input",
          message: "Choisissez un grade de remplacement différent.",
        });
      }
      if (!OBJECT_ID.test(String(reassignToGradeId))) {
        return res.status(400).json({ error: "invalid_input", message: "Grade de remplacement introuvable." });
      }
      const replacement = await CompanyGrade.findOne({ _id: reassignToGradeId, company: companyId });
      if (!replacement) {
        return res.status(400).json({ error: "invalid_input", message: "Grade de remplacement introuvable." });
      }

      await CompanyMembership.updateMany(
        { company: companyId, grade: gradeId },
        { grade: replacement._id },
      );
    }

    const deleted = await CompanyGrade.findOneAndDelete({ _id: gradeId, company: companyId });
    if (!deleted) {
      return res.status(404).json({ error: "not_found", message: "Grade introuvable." });
    }

    logActivity({
      company: companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "grade.delete",
      description: `a supprimé le grade "${deleted.name}"${memberCount > 0 ? ` (${memberCount} collaborateur(s) réassigné(s))` : ""}`,
    });

    res.json({ ok: true, id: String(deleted._id), reassigned: memberCount });
  } catch (err) {
    console.error("[mobile grades delete]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
