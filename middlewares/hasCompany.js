// // check if user has company

const Company = require("../db/models/company/company.model");

module.exports = async (req, res, next) => {
  if (!req.user) return res.redirect("/login");

  const activeCompanies = req.user.companies.filter(
    (c) => c.status === "active",
  );

  let company = null;

  for (const c of activeCompanies) {
    const found = await Company.findById(c.company);
    if (found) {
      company = found;
      break;
    }
  }

  if (!company) {
    return res.redirect("/set-company");
  }

  res.locals.currentCompany = company;
  res.locals.currentUser = req.user;

  next();
};
