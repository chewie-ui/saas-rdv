const Employee = require("../db/models/company/employee.model");
const { getLimit } = require("../utils/planLimits");
const { logActivity } = require("../utils/activityLog");

const MAX_EMPLOYEE_AGE = 100;
const MIN_EMPLOYEE_AGE = 16;
const MAX_EMPLOYEE_DESC_LENGTH = 300;

function parseAge(age) {
  if (age === undefined || age === "") return null;
  const n = Number(age);
  if (isNaN(n)) return null;
  return Math.min(Math.max(Math.round(n), MIN_EMPLOYEE_AGE), MAX_EMPLOYEE_AGE);
}

function parseDescription(description) {
  return (description || "").trim().slice(0, MAX_EMPLOYEE_DESC_LENGTH);
}

exports.employeesPage = async (req, res) => {
  const employees = await Employee.find({ company: res.locals.currentCompany._id })
    .sort({ active: -1, createdAt: 1 })  // actifs en premier, puis par date de création
    .lean();
  const maxEmployees = getLimit("employees", req.user);
  const activeCount  = employees.filter(e => e.active).length;
  res.render("admin/employees", {
    pageName: "Employees",
    title: "Employés",
    employees,
    maxEmployees,
    activeCount,
  });
};

exports.createEmployee = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const maxEmployees = getLimit("employees", req.user);

    if (maxEmployees === 0) {
      return res.status(403).json({ error: "plan_limit", message: "Votre plan ne permet pas d'ajouter des employés." });
    }

    const count = await Employee.countDocuments({ company: companyId });
    if (count >= maxEmployees) {
      return res.status(403).json({ error: "plan_limit", message: `Limite de ${maxEmployees} employé(s) atteinte.` });
    }

    const { firstName, lastName, age, description } = req.body;
    if (!firstName || !lastName) {
      return res.status(400).json({ error: "Prénom et nom sont requis." });
    }
    const profilePicture = req.file
      ? `/uploads/profiles/${req.file.filename}`
      : "/images/no-user.webp";

    const employee = await Employee.create({
      company: companyId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      age: parseAge(age),
      description: parseDescription(description),
      profilePicture,
    });
    logActivity({
      company: companyId,
      user: req.user,
      role: res.locals.membershipRole,
      action: "employee.create",
      description: `a ajouté l'employé "${employee.firstName} ${employee.lastName}"`,
    });
    res.json({ success: true, employee });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, age, description } = req.body;
    const update = {};
    if (firstName !== undefined) update.firstName = firstName.trim();
    if (lastName  !== undefined) update.lastName  = lastName.trim();
    if (age !== undefined) update.age = parseAge(age);
    if (description !== undefined) update.description = parseDescription(description);
    if (req.file) update.profilePicture = `/uploads/profiles/${req.file.filename}`;

    const employee = await Employee.findOneAndUpdate(
      { _id: id, company: res.locals.currentCompany._id },
      update,
      { new: true }
    );
    if (!employee) return res.status(404).json({ error: "Employé non trouvé." });
    logActivity({
      company: res.locals.currentCompany._id,
      user: req.user,
      role: res.locals.membershipRole,
      action: "employee.update",
      description: `a modifié l'employé "${employee.firstName} ${employee.lastName}"`,
    });
    res.json({ success: true, employee });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.deleteEmployee = async (req, res) => {
  try {
    const deleted = await Employee.findOneAndDelete({
      _id: req.params.id,
      company: res.locals.currentCompany._id,
    });
    if (deleted) {
      logActivity({
        company: res.locals.currentCompany._id,
        user: req.user,
        role: res.locals.membershipRole,
        action: "employee.delete",
        description: `a supprimé l'employé "${deleted.firstName} ${deleted.lastName}"`,
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.bulkToggleEmployees = async (req, res) => {
  try {
    const { active } = req.body;
    await Employee.updateMany(
      { company: res.locals.currentCompany._id },
      { active: !!active }
    );
    res.json({ success: true, active: !!active });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.toggleEmployee = async (req, res) => {
  try {
    const emp = await Employee.findOne({
      _id: req.params.id,
      company: res.locals.currentCompany._id,
    });
    if (!emp) return res.status(404).json({ error: "Employé non trouvé." });
    emp.active = !emp.active;
    await emp.save();
    res.json({ success: true, active: emp.active });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};
