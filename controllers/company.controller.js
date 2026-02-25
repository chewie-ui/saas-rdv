const Company = require("../db/models/company/company.model");
const CompanyRequest = require("../db/models/company/companyRequest.model");

exports.searchCompany = async (req, res) => {
  const { name } = req.query;

  if (!name) {
    return res.json([]);
  }

  const companies = await Company.find({
    name: { $regex: name, $options: "i" },
  }).limit(5);

  const companyIds = companies.map((c) => c._id);

  const existingRequests = await CompanyRequest.find({
    user: req.user._id,
    company: { $in: companyIds },
  });

  const requestsMap = {};

  existingRequests.forEach((req) => {
    requestsMap[req.company.toString()] = req.status;
  });

  const formattedCompanies = companies.map((company) => ({
    ...company.toObject(),
    requestStatus: requestsMap[company._id.toString()] || null,
  }));

  return res.json(formattedCompanies);
};

exports.requestCompany = async (req, res) => {
  try {
    const { companyId } = req.body;

    const res = await CompanyRequest.create({
      company: companyId,
      user: req.user._id,
    });

    return res.json({ success: true, res });
  } catch (e) {
    return res.json({ error: e });
  }
};

exports.swapRole = async (req, res) => {
  const { id } = req.params;
  const { companyId } = req.session;
  const { role } = req.body;

  const updated = await Company.findOneAndUpdate(
    { _id: companyId, "employees.user": id },
    { $set: { "employees.$.grade": role } },
    { new: true },
  );
  if (!updated)
    return res
      .status(404)
      .json({ success: false, message: "Employee not found" });
  return res.json({ success: true });
};
