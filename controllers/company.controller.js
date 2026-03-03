const Company = require("../db/models/company/company.model");
const CompanyRequest = require("../db/models/company/companyRequest.model");
const DaysOff = require("../db/models/company/daysOff.model");

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

exports.getDaysOff = async (req, res) => {
  const result = await DaysOff.findOne({ company: req.session.companyId });
  return res.json(result);
};

exports.addDaysOff = async (req, res) => {
  const { dateKey } = req.body;
  await DaysOff.findOneAndUpdate(
    { company: req.session.companyId },
    {
      $addToSet: {
        dates: { date: dateKey },
      },
    },
    { upsert: true, new: true },
  );
  return res.json({ success: true });
};

exports.removeDaysOff = async (req, res) => {
  const { dateKey } = req.body;

  const cleanDate = new Date(dateKey);
  cleanDate.setHours(0, 0, 0, 0);

  await DaysOff.updateOne(
    { company: req.session.companyId },
    {
      $pull: {
        dates: { date: cleanDate },
      },
    },
  );

  res.json({ success: true });
};

exports.removeDayOff = async (req, res) => {
  const { dayId } = req.params;
  console.log("ID", dayId);
  console.log(req.session.companyId);

  await DaysOff.updateOne(
    {
      company: req.session.companyId,
    },
    {
      $pull: {
        dates: { _id: dayId },
      },
    },
  );

  return res.json({ success: true });
};

exports.deleteTimeSlot = async (req, res) => {
  try {
    const { weekdayIndex, slotId } = req.body;
    const companyId = req.session.companyId;

    console.log(weekdayIndex);
    console.log(slotId);
    

    await Company.updateOne(
      {
        _id: companyId,
        "schedule.weekdayIndex": weekdayIndex,
      },
      {
        $pull: {
          "schedule.$.workingHours": {
            _id: slotId,
          },
        },
      }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};
