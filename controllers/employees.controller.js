const Employee = require("../db/models/company/employee.model");

exports.employeesPage = async (req, res) => {
  const employees = await Employee.find({ company: res.locals.currentCompany._id })
    .sort({ createdAt: -1 })
    .lean();
  res.render("admin/employees", {
    pageName: "Employees",
    title: "Employés",
    employees,
  });
};

exports.createEmployee = async (req, res) => {
  try {
    const { firstName, lastName, age, description } = req.body;
    if (!firstName || !lastName) {
      return res.status(400).json({ error: "Prénom et nom sont requis." });
    }
    const profilePicture = req.file
      ? `/uploads/profiles/${req.file.filename}`
      : "/images/no-user.webp";

    const employee = await Employee.create({
      company: res.locals.currentCompany._id,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      age: age !== undefined && age !== "" ? Number(age) : null,
      description: (description || "").trim(),
      profilePicture,
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
    if (age !== undefined) update.age = age !== "" ? Number(age) : null;
    if (description !== undefined) update.description = description.trim();
    if (req.file) update.profilePicture = `/uploads/profiles/${req.file.filename}`;

    const employee = await Employee.findOneAndUpdate(
      { _id: id, company: res.locals.currentCompany._id },
      update,
      { new: true }
    );
    if (!employee) return res.status(404).json({ error: "Employé non trouvé." });
    res.json({ success: true, employee });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.deleteEmployee = async (req, res) => {
  try {
    await Employee.findOneAndDelete({
      _id: req.params.id,
      company: res.locals.currentCompany._id,
    });
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
