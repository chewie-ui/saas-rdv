const ActivityLog = require("../db/models/activityLog.model");

/**
 * Enregistre une action dans l'historique de l'établissement (page "Logs").
 * Best-effort : ne doit jamais faire échouer l'action principale si l'écriture
 * du log plante (ex: DB momentanément indisponible).
 */
async function logActivity({ company, user, role, action, description }) {
  try {
    if (!company || !action || !description) return;
    await ActivityLog.create({
      company,
      user: (user && user._id) || user || null,
      userName: (user && (user.fullName || user.businessName)) || "",
      role: role || "",
      action,
      description,
    });
  } catch (err) {
    console.error("logActivity error:", err.message);
  }
}

module.exports = { logActivity };
