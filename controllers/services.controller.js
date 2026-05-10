const Service = require("../db/models/company/service.model");
const User = require("../db/models/user.model");

// ── Page admin ────────────────────────────────────────────────────────────────
exports.servicesPage = async (req, res) => {
  const services = await Service.find({ company: res.locals.currentCompany._id })
    .populate("employees", "firstName lastName profilePicture")
    .sort("order")
    .lean();
  res.render("admin/services", {
    pageName: "Services",
    title: "Services",
    services,
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
    const { name, description, price, duration } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Le nom du service est requis." });
    }
    const count = await Service.countDocuments({ company: res.locals.currentCompany._id });
    const service = await Service.create({
      company: res.locals.currentCompany._id,
      name: name.trim(),
      description: (description || "").trim(),
      price: price !== undefined && price !== "" ? Number(price) : null,
      duration: duration ? Number(duration) : 30,
      order: count,
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
    const { name, description, price, duration } = req.body;
    const update = {};
    if (name !== undefined) update.name = name.trim();
    if (description !== undefined) update.description = description.trim();
    if (price !== undefined) update.price = price !== "" ? Number(price) : null;
    if (duration !== undefined) update.duration = Number(duration);

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
