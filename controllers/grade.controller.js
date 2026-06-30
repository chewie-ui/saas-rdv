// CRUD des grades (cf. db/models/company/companyGrade.model.js et
// utils/permissions.js). Authorization assurée par les middlewares
// requirePermissionForParamCompany("grades.view|manage") dans les routes.
const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const CompanyGrade = require("../db/models/company/companyGrade.model");
const { PERMISSION_SCHEMA, PERMISSION_GROUPS, DEFAULT_GRADE_TEMPLATES } = require("../utils/permissions");

async function loadCompanyOr404(req, res) {
  const company = await Company.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
  if (!company) {
    res.status(404).json({ error: "Établissement introuvable." });
    return null;
  }
  return company;
}

// Ne garde que les clés connues du schéma — évite d'enregistrer des
// permissions arbitraires envoyées par un client malveillant.
function sanitizePermissions(raw) {
  const out = {};
  const input = raw && typeof raw === "object" ? raw : {};
  for (const zone of Object.keys(PERMISSION_SCHEMA)) {
    out[zone] = {};
    for (const key of Object.keys(PERMISSION_SCHEMA[zone].keys)) {
      out[zone][key] = !!input[zone]?.[key];
    }
  }
  return out;
}

exports.listGrades = async (req, res) => {
  try {
    const company = await loadCompanyOr404(req, res);
    if (!company) return;
    const grades = await CompanyGrade.find({ company: company._id }).sort({ createdAt: 1 }).lean();
    return res.json({ success: true, grades });
  } catch (err) {
    console.error("listGrades error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.createGrade = async (req, res) => {
  try {
    const company = await loadCompanyOr404(req, res);
    if (!company) return;

    const name = String(req.body.name || "").trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: "Le nom du grade est requis." });

    const exists = await CompanyGrade.findOne({ company: company._id, name });
    if (exists) return res.status(400).json({ error: "Un grade avec ce nom existe déjà." });

    const grade = await CompanyGrade.create({
      company: company._id,
      name,
      isBuiltIn: false,
      permissions: sanitizePermissions(req.body.permissions),
    });

    return res.json({ success: true, grade });
  } catch (err) {
    console.error("createGrade error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.updateGrade = async (req, res) => {
  try {
    const company = await loadCompanyOr404(req, res);
    if (!company) return;

    const update = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: "Le nom du grade est requis." });
      const dupe = await CompanyGrade.findOne({ company: company._id, name, _id: { $ne: req.params.gradeId } });
      if (dupe) return res.status(400).json({ error: "Un grade avec ce nom existe déjà." });
      update.name = name;
    }
    if (req.body.permissions !== undefined) {
      update.permissions = sanitizePermissions(req.body.permissions);
    }

    const grade = await CompanyGrade.findOneAndUpdate(
      { _id: req.params.gradeId, company: company._id },
      update,
      { new: true }
    );
    if (!grade) return res.status(404).json({ error: "Grade introuvable." });

    return res.json({ success: true, grade });
  } catch (err) {
    console.error("updateGrade error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// Suppression bloquée tant que des collaborateurs utilisent encore ce grade
// — sauf si un `reassignToGradeId` est fourni, dans quel cas ils sont tous
// réassignés avant la suppression effective.
exports.deleteGrade = async (req, res) => {
  try {
    const company = await loadCompanyOr404(req, res);
    if (!company) return;

    const memberCount = await CompanyMembership.countDocuments({ company: company._id, grade: req.params.gradeId });

    if (memberCount > 0) {
      const reassignToGradeId = req.body.reassignToGradeId;
      if (!reassignToGradeId) {
        return res.status(400).json({
          error: "grade_in_use",
          message: `${memberCount} collaborateur(s) utilisent ce grade — choisissez un grade de remplacement pour le supprimer.`,
          memberCount,
        });
      }
      if (String(reassignToGradeId) === String(req.params.gradeId)) {
        return res.status(400).json({ error: "Choisissez un grade de remplacement différent." });
      }
      const replacement = await CompanyGrade.findOne({ _id: reassignToGradeId, company: company._id });
      if (!replacement) return res.status(400).json({ error: "Grade de remplacement introuvable." });

      await CompanyMembership.updateMany(
        { company: company._id, grade: req.params.gradeId },
        { grade: replacement._id }
      );
    }

    const deleted = await CompanyGrade.findOneAndDelete({ _id: req.params.gradeId, company: company._id });
    if (!deleted) return res.status(404).json({ error: "Grade introuvable." });

    return res.json({ success: true });
  } catch (err) {
    console.error("deleteGrade error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};
