// ── API mobile : journal d'activité ───────────────────────────────────────
//   GET /logs?page=&action=   historique paginé de l'établissement
//
// Réplique controllers/logs.controller.js (web) : même modèle, même tri
// (le plus récent d'abord), même pagination de 25 lignes, même filtre par type
// d'action et mêmes libellés français — ACTION_LABELS est importé du
// contrôleur web, jamais recopié, pour que les deux surfaces ne divergent pas.
//
// La requête est toujours filtrée par l'établissement courant
// (req.companyCtx.currentCompany._id) : jamais un identifiant venu du client.
const ActivityLog = require("../../db/models/activityLog.model");
const { ACTION_LABELS } = require("../logs.controller");

// Actions journalisées ailleurs dans l'app mais absentes de la liste du web
// (le filtre de la page web ne les propose pas encore). On les ajoute ici
// seulement pour l'app : la page web reste strictement inchangée.
const EXTRA_ACTION_LABELS = {
  // Ajouté avec la journalisation de PATCH /bookings/:id (correctif de
  // permission d'annulation) : sans libellé, la ligne s'affichait « booking.update ».
  "booking.update": "RDV modifié",
  "form.update": "Formulaire modifié",
  "grade.create": "Grade créé",
  "grade.update": "Grade modifié",
  "grade.delete": "Grade supprimé",
  "client.dossier.entry.add": "Entrée de dossier ajoutée",
  "client.dossier.entry.update": "Entrée de dossier modifiée",
  "client.dossier.entry.delete": "Entrée de dossier supprimée",
  "settings.sms": "Réglages SMS/WhatsApp modifiés",
  "groupSession.add": "Séance de cours ajoutée",
  "groupSession.remove": "Séance de cours supprimée",
  "groupSession.recurring": "Rythme d'un cours modifié",
};

const LABELS = { ...ACTION_LABELS, ...EXTRA_ACTION_LABELS };

const PAGE_SIZE = 25;

// Rôle figé au moment de l'action (snapshot) : il peut ne plus exister.
const ROLE_LABELS = { owner: "Gérant", manager: "Manager", staff: "Employé" };

// GET /api/v1/logs
exports.list = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const skip = (page - 1) * PAGE_SIZE;

    const query = { company: req.companyCtx.currentCompany._id };
    // Un filtre inconnu est ignoré (comme sur le web) plutôt que rejeté :
    // l'app garde alors l'historique complet au lieu d'une liste vide.
    if (req.query.action && LABELS[req.query.action]) {
      query.action = req.query.action;
    }

    const [logs, total] = await Promise.all([
      ActivityLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(PAGE_SIZE).lean(),
      ActivityLog.countDocuments(query),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    res.json({
      logs: logs.map((l) => ({
        id: String(l._id),
        date: l.createdAt,
        userName: l.userName || "Compte supprimé",
        role: l.role || "",
        roleLabel: ROLE_LABELS[l.role] || "",
        action: l.action,
        actionLabel: LABELS[l.action] || l.action,
        description: l.description || "",
      })),
      // Types proposés dans le filtre, dans l'ordre du référentiel.
      actions: Object.entries(LABELS).map(([value, label]) => ({ value, label })),
      selectedAction: (req.query.action && LABELS[req.query.action]) ? req.query.action : "all",
      page,
      totalPages,
      total,
      hasMore: page < totalPages,
    });
  } catch (err) {
    console.error("[mobile logs list]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
