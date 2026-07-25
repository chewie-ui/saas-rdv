const ActivityLog = require("../db/models/activityLog.model");

const ACTION_LABELS = {
  "service.create": "Service créé",
  "service.update": "Service modifié",
  "service.delete": "Service supprimé",
  "employee.create": "Employé ajouté",
  "employee.update": "Employé modifié",
  "employee.delete": "Employé supprimé",
  "booking.cancel": "RDV annulé",
  "booking.delete": "RDV supprimé",
  "booking.restore": "RDV restauré",
  "establishment.create": "Établissement créé",
  "establishment.update": "Établissement modifié",
  "establishment.pause": "Établissement mis en pause",
  "establishment.resume": "Établissement réactivé",
  "establishment.delete": "Établissement supprimé",
  "collaborator.invite": "Collaborateur ajouté",
  "collaborator.role": "Rôle modifié",
  "collaborator.activate": "Collaborateur réactivé",
  "collaborator.deactivate": "Collaborateur désactivé",
  "collaborator.remove": "Collaborateur retiré",
  "collaborator.reject": "Demande refusée",
};

// Réutilisé tel quel par l'API mobile (controllers/mobile/logs.mobile.controller.js)
// pour que les deux surfaces affichent exactement les mêmes libellés.
exports.ACTION_LABELS = ACTION_LABELS;

// ── Page "Logs" : historique des actions sur l'établissement ─────────────────
// Visible par le propriétaire et tout grade avec logs.view (cf. routes/admin.js
// — déjà gardé par requirePermission("logs.view"), pas de check ici).
exports.logsInit = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 25;
    const skip = (page - 1) * limit;

    const query = { company: res.locals.currentCompany._id };
    if (req.query.action && ACTION_LABELS[req.query.action]) {
      query.action = req.query.action;
    }

    const [logs, totalLogs] = await Promise.all([
      ActivityLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ActivityLog.countDocuments(query),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalLogs / limit));

    return res.render("admin/logs", {
      pageName: "Logs",
      title: "Logs — BranShee",
      logs: logs.map((l) => ({
        ...l,
        actionLabel: ACTION_LABELS[l.action] || l.action,
      })),
      actionOptions: Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label })),
      selectedAction: req.query.action || "all",
      currentPage: page,
      totalPages,
      totalLogs,
    });
  } catch (err) {
    console.error("logsInit error:", err.message);
    return res.status(500).send("Erreur serveur.");
  }
};
