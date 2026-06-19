const Service = require("../db/models/company/service.model");
const User = require("../db/models/user.model");
const { getLimit } = require("../utils/planLimits");
const { nextAvailableColor } = require("../utils/serviceColors");

// ── Page admin ────────────────────────────────────────────────────────────────
exports.servicesPage = async (req, res) => {
  const services = await Service.find({ company: res.locals.currentCompany._id })
    .populate("employees", "firstName lastName profilePicture")
    .sort("order")
    .lean();
  const maxServices = getLimit("services", req.user);
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
  });
};

// ── API : liste des services (public + admin) ─────────────────────────────────
exports.getServices = async (req, res) => {
  try {
    const { companyId, publicOnly } = req.query;
    const query = { company: companyId };
    if (publicOnly === "1") query.active = true;

    const services = await Service.find(query)
      .populate("employees", "firstName lastName profilePicture")
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
    const maxServices = getLimit("services", req.user);

    if (maxServices === 0) {
      return res.status(403).json({ error: "plan_limit", message: "Votre plan ne permet pas de créer des services." });
    }

    const count = await Service.countDocuments({ company: companyId });

    if (count >= maxServices) {
      return res.status(403).json({ error: "plan_limit", message: `Limite de ${maxServices} services atteinte.` });
    }

    const { name, description, price, duration, category, type, capacity, color } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Le nom du service est requis." });
    }

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
      duration: duration ? Number(duration) : 30,
      category: (category || "").trim(),
      order: count,
      type: isGroup ? "group" : "individual",
      capacity: cap,
      color: resolvedColor,
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
    const { name, description, price, duration, category, type, capacity, color } = req.body;
    const update = {};
    if (name !== undefined) update.name = name.trim();
    if (description !== undefined) update.description = description.trim();
    if (price !== undefined) update.price = price !== "" ? Number(price) : null;
    if (duration !== undefined) update.duration = Number(duration);
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

    const service = await Service.findOneAndUpdate(
      { _id: id, company: res.locals.currentCompany._id },
      update,
      { new: true }
    ).populate("employees", "firstName lastName profilePicture");

    if (!service) return res.status(404).json({ error: "Service non trouvé." });
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
    await Service.findOneAndDelete({ _id: id, company: res.locals.currentCompany._id });
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
    ).populate("employees", "firstName lastName profilePicture");
    if (!service) return res.status(404).json({ error: "Service non trouvé." });
    res.json({ success: true, service });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : liste des employés de la company (pour la sélection dans un service) ─
exports.getCompanyEmployees = async (req, res) => {
  try {
    const Employee = require("../db/models/company/employee.model");
    const employees = await Employee.find({
      company: res.locals.currentCompany._id,
      active: true,
    }).lean();
    res.json({ success: true, employees });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};
