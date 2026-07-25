// ── API mobile : services & équipe ────────────────────────────────────────
//   GET /api/v1/services  → services actifs de l'établissement
//   GET /api/v1/team      → équipe bookable (patron + collaborateurs)
const Service = require("../../db/models/company/service.model");
const { getBookableTeam } = require("../../utils/bookableTeam");

// GET /api/v1/services
// Par défaut, seuls les services actifs (ce que voit un client). Avec
// `?includeInactive=1`, on renvoie aussi les services désactivés — nécessaire
// à l'écran de gestion, sans quoi un service désactivé deviendrait invisible
// et donc impossible à réactiver depuis l'app.
exports.services = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const includeInactive = req.query.includeInactive === "1" || req.query.includeInactive === "true";

    const filter = { company: companyId };
    if (!includeInactive) filter.active = true;

    const services = await Service.find(filter)
      .select("_id name description category duration durationMax price color type capacity employees order active")
      .sort({ order: 1, name: 1 })
      .lean();

    res.json({
      services: services.map((s) => ({
        id: String(s._id),
        name: s.name || "",
        description: s.description || "",
        category: s.category || "",
        duration: s.duration || 30,
        durationMax: s.durationMax || null,
        price: s.price ?? null,
        color: s.color || null,
        type: s.type || "individual",
        capacity: s.capacity ?? null,
        active: s.active !== false,
        employeeIds: (s.employees || []).map((id) => String(id)),
      })),
    });
  } catch (err) {
    console.error("[mobile services]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// GET /api/v1/team — équipe bookable normalisée (getBookableTeam).
exports.team = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const team = await getBookableTeam(companyId);
    res.json({
      team: team.map((m) => ({
        id: String(m.id),
        firstName: m.firstName || "",
        lastName: m.lastName || "",
        photo: m.profilePicture || m.photo || null,
        role: m.role || "",
        showRole: !!m.showRole,
      })),
    });
  } catch (err) {
    console.error("[mobile team]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
