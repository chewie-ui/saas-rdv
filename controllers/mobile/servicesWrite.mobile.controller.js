// ── API mobile : gestion des services ─────────────────────────────────────
//   POST   /services            créer
//   PATCH  /services/:id        modifier
//   PATCH  /services/:id/toggle activer / désactiver
//   DELETE /services/:id        supprimer
//
// Applique les mêmes règles que le web (controllers/services.controller.js) :
// limite du forfait, nom obligatoire, couleur hexadécimale unique, capacité
// bornée pour les cours collectifs.
const Service = require("../../db/models/company/service.model");
const { getLimit } = require("../../utils/planLimits");
const { getBookableTeam } = require("../../utils/bookableTeam");
const { logActivity } = require("../../utils/activityLog");

const HEX = /^#[0-9a-f]{6}$/i;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

// Palette par défaut, reprise du web : on attribue la première couleur libre.
const PALETTE = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

function nextAvailableColor(used) {
  const taken = new Set(used.filter(Boolean).map((c) => c.toLowerCase()));
  return PALETTE.find((c) => !taken.has(c.toLowerCase())) || PALETTE[0];
}

// Champs éditables communs à la création et à la modification.
async function buildPayload(body, companyId, { forCreate }) {
  const out = {};

  if (body.name !== undefined || forCreate) {
    const name = String(body.name || "").trim();
    if (!name) return { error: "Le nom du service est requis." };
    out.name = name;
  }
  if (body.description !== undefined) out.description = String(body.description).trim();
  if (body.category !== undefined) out.category = String(body.category).trim();
  if (body.location !== undefined) out.location = String(body.location).trim();

  if (body.price !== undefined) {
    const p = body.price === null || body.price === "" ? null : Number(body.price);
    if (p !== null && (Number.isNaN(p) || p < 0)) return { error: "Prix invalide." };
    out.price = p;
  }

  if (body.duration !== undefined || forCreate) {
    const d = Number(body.duration) || 30;
    if (d < 5 || d > 1440) return { error: "La durée doit être comprise entre 5 et 1440 minutes." };
    out.duration = d;
  }
  if (body.durationMax !== undefined) {
    const dm = body.durationMax === null || body.durationMax === "" ? null : Number(body.durationMax);
    if (dm !== null && (Number.isNaN(dm) || dm < (out.duration || 5))) {
      return { error: "La durée maximale doit être supérieure à la durée." };
    }
    out.durationMax = dm;
  }

  if (body.type !== undefined || forCreate) {
    const type = body.type === "group" ? "group" : "individual";
    out.type = type;
    // La capacité n'a de sens que pour un cours collectif.
    out.capacity = type === "group"
      ? Math.max(1, Math.min(500, Number(body.capacity) || 1))
      : null;
  } else if (body.capacity !== undefined) {
    out.capacity = Math.max(1, Math.min(500, Number(body.capacity) || 1));
  }

  if (body.active !== undefined) out.active = Boolean(body.active);

  // Praticiens autorisés : validés contre l'équipe bookable.
  if (body.employeeIds !== undefined) {
    const team = await getBookableTeam(companyId);
    const valid = new Set(team.map((m) => String(m.id)));
    out.employees = (Array.isArray(body.employeeIds) ? body.employeeIds : [])
      .map(String)
      .filter((id) => valid.has(id));
  }

  return { data: out };
}

// Résout la couleur : celle demandée (hex, non déjà prise) ou la première libre.
async function resolveColor(companyId, requested, excludeId) {
  const query = { company: companyId };
  if (excludeId) query._id = { $ne: excludeId };
  const used = (await Service.find(query).select("color").lean()).map((s) => s.color);

  if (requested) {
    if (!HEX.test(requested)) return { error: "Couleur invalide (format attendu : #rrggbb)." };
    if (used.some((c) => (c || "").toLowerCase() === requested.toLowerCase())) {
      return { error: "Cette couleur est déjà utilisée par un autre service." };
    }
    return { color: requested };
  }
  return { color: nextAvailableColor(used) };
}

// POST /api/v1/services
exports.create = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const maxServices = getLimit("services", req.companyCtx.billingUser);

    if (maxServices === 0) {
      return res.status(403).json({
        error: "plan_limit",
        message: "Votre forfait ne permet pas de créer des services.",
      });
    }
    const count = await Service.countDocuments({ company: companyId });
    if (count >= maxServices) {
      return res.status(403).json({
        error: "plan_limit",
        message: `Limite de ${maxServices} services atteinte. Passez à un forfait supérieur pour en ajouter.`,
      });
    }

    const built = await buildPayload(req.body, companyId, { forCreate: true });
    if (built.error) return res.status(400).json({ error: "invalid_input", message: built.error });

    const col = await resolveColor(companyId, req.body.color);
    if (col.error) return res.status(400).json({ error: "invalid_color", message: col.error });

    const service = await Service.create({
      ...built.data,
      company: companyId,
      color: col.color,
      active: built.data.active !== undefined ? built.data.active : true,
      order: count,
    });

    logActivity({
      company: companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "service.create",
      description: `a créé le service « ${service.name} »`,
    });

    res.status(201).json({ service: serialize(service.toObject()) });
  } catch (err) {
    console.error("[mobile service create]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PATCH /api/v1/services/:id
exports.update = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    if (!OBJECT_ID.test(req.params.id)) {
      return res.status(400).json({ error: "invalid_id", message: "Identifiant invalide." });
    }

    const existing = await Service.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!existing) return res.status(404).json({ error: "not_found", message: "Service introuvable." });

    const built = await buildPayload(req.body, companyId, { forCreate: false });
    if (built.error) return res.status(400).json({ error: "invalid_input", message: built.error });

    const updates = built.data;
    if (req.body.color !== undefined) {
      const col = await resolveColor(companyId, req.body.color, existing._id);
      if (col.error) return res.status(400).json({ error: "invalid_color", message: col.error });
      updates.color = col.color;
    }

    const service = await Service.findOneAndUpdate(
      { _id: req.params.id, company: companyId },
      updates,
      { new: true },
    ).lean();

    logActivity({
      company: companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "service.update",
      description: `a modifié le service « ${service.name} »`,
    });

    res.json({ service: serialize(service) });
  } catch (err) {
    console.error("[mobile service update]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PATCH /api/v1/services/:id/toggle
exports.toggle = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    if (!OBJECT_ID.test(String(req.params.id))) {
      return res.status(400).json({ error: "invalid_id", message: "Identifiant invalide." });
    }
    const existing = await Service.findOne({ _id: req.params.id, company: companyId }).select("active").lean();
    if (!existing) return res.status(404).json({ error: "not_found", message: "Service introuvable." });

    const service = await Service.findOneAndUpdate(
      { _id: req.params.id, company: companyId },
      { active: !existing.active },
      { new: true },
    ).lean();

    res.json({ service: serialize(service) });
  } catch (err) {
    console.error("[mobile service toggle]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// DELETE /api/v1/services/:id
// Les rendez-vous déjà pris conservent leur nom et leur couleur (figés à la
// réservation) : supprimer un service ne réécrit pas l'historique.
exports.remove = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    if (!OBJECT_ID.test(String(req.params.id))) {
      return res.status(400).json({ error: "invalid_id", message: "Identifiant invalide." });
    }
    const service = await Service.findOneAndDelete({ _id: req.params.id, company: companyId }).lean();
    if (!service) return res.status(404).json({ error: "not_found", message: "Service introuvable." });

    logActivity({
      company: companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "service.delete",
      description: `a supprimé le service « ${service.name} »`,
    });

    res.json({ ok: true, id: String(service._id) });
  } catch (err) {
    console.error("[mobile service delete]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

function serialize(s) {
  return {
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
  };
}
