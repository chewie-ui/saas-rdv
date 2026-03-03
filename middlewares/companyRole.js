const Company = require("../db/models/company/company.model");

module.exports = async function injectCompanyRole(req, res, next) {
  try {
    if (!req.session.companyId || !req.user) {
      res.locals.grade = null;
      return next();
    }

    const company = await Company.findOne(
      {
        _id: req.session.companyId,
        "employees.user": req.user._id,
      },
      {
        "employees.$": 1,
      },
    ).lean();

    res.locals.grade = company?.employees[0]?.grade || null;

    next();
  } catch (err) {
    console.error(err);
    res.locals.grade = null;
    next();
  }
};
