const Service = require("../db/models/company/service.model");
const Company = require("../db/models/company/company.model");
const User = require("../db/models/user.model");
const { getLimit } = require("../utils/planLimits");
const { nextAvailableColor } = require("../utils/serviceColors");
const { logActivity } = require("../utils/activityLog");
const fs = require("fs");
const path = require("path");

const UPLOADS_DIR = path.join(__dirname, "..", "public", "uploads", "profiles");

// ── Frais d'annulation/no-show personnalisés (par service) ────────────────────
function sanitizeCancellationFee(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const enabled = !!raw.enabled;
  const type = raw.type === "amount" ? "amount" : "percent";
  let value = raw.value !== undefined && raw.value !== "" ? Number(raw.value) : null;
  if (value !== null && !Number.isFinite(value)) value = null;
  if (value !== null) {
    value = type === "percent" ? Math.max(0, Math.min(100, value)) : Math.max(0, value);
  }
  return { enabled: enabled && value !== null, type, value };
}

// ── Réponse de la "question préalable" pour laquelle ce service est
// proposé — "all" = visible pour tout le monde. ─────────────────────────────
function sanitizeAnswerVisibility(raw) {
  return ["new", "existing"].includes(raw) ? raw : "all";
}

// ── Durée approximative ("30-40 min") — borne haute optionnelle, doit
// toujours être strictement supérieure à la durée de base. ──────────────────
function sanitizeDurationMax(baseDuration, raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const max = Number(raw);
  if (!Number.isFinite(max) || max <= baseDuration) return null;
  return max;
}

// ── Page admin ────────────────────────────────────────────────────────────────
exports.servicesPage = async (req, res) => {
  const [services, companyDoc] = await Promise.all([
    Service.find({ company: res.locals.currentCompany._id })
      .populate("employees", "fullName profilePicture")
      .sort("order")
      .lean(),
    Company.findById(res.locals.currentCompany._id).select("bookingQuestion").lean(),
  ]);

  // ── Rattrapage : services sans couleur (créés avant cette fonctionnalité,
  // ou via un autre chemin) — sans ça, ils retombent tous sur LE MÊME vert
  // par défaut à l'affichage (`svc.color || '#1e7a4e'`), donnant l'impression
  // que plusieurs services partagent une couleur alors qu'aucune n'est
  // réellement assignée. On leur attribue une vraie couleur unique ici, une
  // fois pour toutes (persisté, pas juste à l'affichage). ───────────────────
  const missingColor = services.filter((s) => !s.color);
  if (missingColor.length > 0) {
    const usedColors = services.map((s) => s.color).filter(Boolean);
    for (const s of missingColor) {
      const newColor = nextAvailableColor(usedColors);
      usedColors.push(newColor);
      s.color = newColor;
      await Service.updateOne({ _id: s._id }, { $set: { color: newColor } });
    }
  }

  const maxServices = getLimit("services", res.locals.billingUser);
  const cs = (req.user.calendarSettings) || {};
  const categories  = cs.categories || [];
  const bookingCategoryStyle = cs.bookingCategoryStyle || "pills";
  res.render("admin/services", {
    pageName: "Services",
    title: "Services",
    services,
    maxServices,
    categories,
    bookingCategoryStyle,
    bookingQuestion: companyDoc?.bookingQuestion || {
      enabled: false,
      question: "Est-ce la première fois que vous nous consultez ?",
      newLabel: "Oui, je suis nouveau",
      existingLabel: "Non, j'ai déjà consulté",
    },
  });
};

// ── API : question préalable au choix du service ──────────────────────────────
exports.updateBookingQuestion = async (req, res) => {
  try {
    const { enabled, question, newLabel, existingLabel } = req.body;
    const update = {};
    if (enabled !== undefined) update["bookingQuestion.enabled"] = !!enabled;
    if (question !== undefined) update["bookingQuestion.question"] = String(question).trim().slice(0, 200);
    if (newLabel !== undefined) update["bookingQuestion.newLabel"] = String(newLabel).trim().slice(0, 80);
    if (existingLabel !== undefined) update["bookingQuestion.existingLabel"] = String(existingLabel).trim().slice(0, 80);
    await Company.findByIdAndUpdate(res.locals.currentCompany._id, { $set: update });
    return res.json({ success: true, ...update });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ── API : liste des services (public + admin) ─────────────────────────────────
exports.getServices = async (req, res) => {
  try {
    const { companyId, publicOnly } = req.query;
    const query = { company: companyId };
    if (publicOnly === "1") query.active = true;

    const services = await Service.find(query)
      .populate("employees", "fullName profilePicture")
      .sort("order")
      .lean();
    res.json({ success: true, services });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : créer un service ────────────────────────────────────────────────────
exports.createService = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const maxServices = getLimit("services", res.locals.billingUser);

    if (maxServices === 0) {
      return res.status(403).json({ error: "plan_limit", message: "Votre plan ne permet pas de créer des services." });
    }

    const count = await Service.countDocuments({ company: companyId });

    if (count >= maxServices) {
      return res.status(403).json({ error: "plan_limit", message: `Limite de ${maxServices} services atteinte.` });
    }

    const { name, description, price, duration, durationMax, category, type, capacity, color, cancellationFee, answerVisibility } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Le nom du service est requis." });
    }

    const baseDuration = duration ? Number(duration) : 30;

    const isGroup = type === "group";
    const cap = isGroup ? Math.max(1, Math.min(500, Number(capacity) || 1)) : null;

    const existingColors = (await Service.find({ company: companyId }).select("color").lean())
      .map((s) => s.color).filter(Boolean);

    let resolvedColor;
    if (color) {
      if (existingColors.some((c) => c.toLowerCase() === color.toLowerCase())) {
        return res.status(400).json({ error: "color_taken", message: "Cette couleur est déjà utilisée par un autre service." });
      }
      resolvedColor = color;
    } else {
      resolvedColor = nextAvailableColor(existingColors);
    }

    const service = await Service.create({
      company: companyId,
      name: name.trim(),
      description: (description || "").trim(),
      price: price !== undefined && price !== "" ? Number(price) : null,
      duration: baseDuration,
      durationMax: sanitizeDurationMax(baseDuration, durationMax),
      category: (category || "").trim(),
      order: count,
      type: isGroup ? "group" : "individual",
      capacity: cap,
      color: resolvedColor,
      cancellationFee: sanitizeCancellationFee(cancellationFee),
      answerVisibility: sanitizeAnswerVisibility(answerVisibility),
    });
    logActivity({
      company: companyId,
      user: req.user,
      role: res.locals.membershipRole,
      action: "service.create",
      description: `a créé le service "${service.name}"`,
    });
    res.json({ success: true, service });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : modifier un service ─────────────────────────────────────────────────
exports.updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, duration, durationMax, category, type, capacity, color, cancellationFee, answerVisibility } = req.body;
    const update = {};
    if (name !== undefined) update.name = name.trim();
    if (description !== undefined) update.description = description.trim();
    if (price !== undefined) update.price = price !== "" ? Number(price) : null;
    if (duration !== undefined) update.duration = Number(duration);
    if (durationMax !== undefined) {
      const baseDuration = duration !== undefined
        ? Number(duration)
        : (await Service.findById(id).select("duration").lean())?.duration || 30;
      update.durationMax = sanitizeDurationMax(baseDuration, durationMax);
    }
    if (category !== undefined) update.category = category.trim();
    if (color !== undefined) {
      if (color) {
        const existingColors = (await Service.find({ company: res.locals.currentCompany._id, _id: { $ne: id } }).select("color").lean())
          .map((s) => s.color).filter(Boolean);
        if (existingColors.some((c) => c.toLowerCase() === color.toLowerCase())) {
          return res.status(400).json({ error: "color_taken", message: "Cette couleur est déjà utilisée par un autre service." });
        }
      }
      update.color = color || null;
    }
    if (type !== undefined) {
      const isGroup = type === "group";
      update.type = isGroup ? "group" : "individual";
      update.capacity = isGroup ? Math.max(1, Math.min(500, Number(capacity) || 1)) : null;
    } else if (capacity !== undefined) {
      update.capacity = Math.max(1, Math.min(500, Number(capacity) || 1));
    }
    if (cancellationFee !== undefined) {
      update.cancellationFee = sanitizeCancellationFee(cancellationFee);
    }
    if (answerVisibility !== undefined) {
      update.answerVisibility = sanitizeAnswerVisibility(answerVisibility);
    }

    const service = await Service.findOneAndUpdate(
      { _id: id, company: res.locals.currentCompany._id },
      update,
      { new: true }
    ).populate("employees", "fullName profilePicture");

    if (!service) return res.status(404).json({ error: "Service non trouvé." });
    logActivity({
      company: res.locals.currentCompany._id,
      user: req.user,
      role: res.locals.membershipRole,
      action: "service.update",
      description: `a modifié le service "${service.name}"`,
    });
    res.json({ success: true, service });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : activer / désactiver TOUS les services ─────────────────────────────
exports.bulkToggleServices = async (req, res) => {
  try {
    const { active } = req.body;
    await Service.updateMany(
      { company: res.locals.currentCompany._id },
      { active: !!active }
    );
    res.json({ success: true, active: !!active });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : toggle actif/inactif ────────────────────────────────────────────────
exports.toggleService = async (req, res) => {
  try {
    const { id } = req.params;
    const service = await Service.findOne({ _id: id, company: res.locals.currentCompany._id });
    if (!service) return res.status(404).json({ error: "Service non trouvé." });
    service.active = !service.active;
    await service.save();
    res.json({ success: true, active: service.active });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : supprimer un service ────────────────────────────────────────────────
exports.deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Service.findOneAndDelete({ _id: id, company: res.locals.currentCompany._id });
    if (deleted) {
      logActivity({
        company: res.locals.currentCompany._id,
        user: req.user,
        role: res.locals.membershipRole,
        action: "service.delete",
        description: `a supprimé le service "${deleted.name}"`,
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : gérer les employés d'un service ────────────────────────────────────
exports.setServiceEmployees = async (req, res) => {
  try {
    const { id } = req.params;
    const { employees } = req.body; // array of user IDs
    const service = await Service.findOneAndUpdate(
      { _id: id, company: res.locals.currentCompany._id },
      { employees: employees || [] },
      { new: true }
    ).populate("employees", "fullName profilePicture");
    if (!service) return res.status(404).json({ error: "Service non trouvé." });
    res.json({ success: true, service });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : image d'un service ──────────────────────────────────────────────────
exports.updateServiceImage = async (req, res) => {
  try {
    if (!req.file || !req.file.filename) {
      return res.status(400).json({ error: "Aucune image reçue." });
    }
    const service = await Service.findOne({ _id: req.params.id, company: res.locals.currentCompany._id }).select("image").lean();
    if (!service) return res.status(404).json({ error: "Service non trouvé." });

    // Supprimer l'ancienne image si elle existe
    if (service.image) {
      const oldPath = path.join(UPLOADS_DIR, service.image);
      fs.unlink(oldPath, () => {});
    }

    const updated = await Service.findByIdAndUpdate(
      req.params.id,
      { image: req.file.filename },
      { new: true }
    ).lean();
    res.json({ success: true, image: updated.image });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
};

exports.deleteServiceImage = async (req, res) => {
  try {
    const service = await Service.findOne({ _id: req.params.id, company: res.locals.currentCompany._id }).select("image").lean();
    if (!service) return res.status(404).json({ error: "Service non trouvé." });

    if (service.image) {
      const filePath = path.join(UPLOADS_DIR, service.image);
      fs.unlink(filePath, () => {});
    }
    await Service.findByIdAndUpdate(req.params.id, { image: "" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : liste des employés de la company (pour la sélection dans un service) ─
exports.getCompanyEmployees = async (req, res) => {
  try {
    const { getBookableTeam } = require("../utils/bookableTeam");
    const employees = await getBookableTeam(res.locals.currentCompany._id);
    res.json({ success: true, employees });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};
