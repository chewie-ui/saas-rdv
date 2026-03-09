const Company = require("../db/models/company/company.model");

module.exports = async (req, res, next) => {
  if (!req.user) return res.redirect("/login");

  // 🔥 1️⃣ Toutes les companies où il est owner
  const ownedCompanies = await Company.find({
    owner: req.user._id,
  }).lean();

  // 🔥 2️⃣ Toutes les companies où il est employee
  const employeeCompanies = await Company.find({
    "employees.user": req.user._id,
  }).lean();

  // 🔥 3️⃣ Fusion + éviter doublons
  const allCompaniesMap = new Map();

  [...ownedCompanies, ...employeeCompanies].forEach((c) => {
    allCompaniesMap.set(c._id.toString(), c);
  });

  const allCompanies = Array.from(allCompaniesMap.values());

  if (!allCompanies.length) {
    return res.redirect("/set-company");
  }

  // 🔥 4️⃣ Company active
  let currentCompany;

  if (req.session.companyId) {
    currentCompany = allCompanies.find(
      (c) => c._id.toString() === req.session.companyId,
    );
  }

  if (!currentCompany) {
    currentCompany = allCompanies[0];
    req.session.companyId = currentCompany._id;
  }

  // 🔥 5️⃣ Injecter dans toutes les vues
  res.locals.currentCompany = currentCompany;
  res.locals.companies = allCompanies;
  res.locals.currentUser = req.user;

  next();
};
