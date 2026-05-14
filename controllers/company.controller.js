const Company = require("../db/models/company/company.model");
const DaysOff = require("../db/models/company/daysOff.model");

exports.companyInfos = async (req, res) => {
  const { companyId } = req.params;
  const doc = await Company.findById(companyId);
  return res.json(doc);
};

exports.getDaysOff = async (req, res) => {
  const result = await DaysOff.findOne({
    company: res.locals.currentCompany._id,
  });
  return res.json(result);
};

exports.addDaysOff = async (req, res) => {
  const { dateKey, employeeIds } = req.body;

  const result = await DaysOff.findOneAndUpdate(
    { company: res.locals.currentCompany._id },
    {
      $push: {
        dates: {
          date: new Date(dateKey),
          workingHours: [],
          dayOff: true,
          employees: Array.isArray(employeeIds) ? employeeIds : [],
        },
      },
    },
    { upsert: true, new: true },
  );

  // Find the newly added date entry to return its _id
  const searchDateStr = new Date(dateKey).toISOString().split("T")[0];

  const newEntry = result.dates
    .slice()
    .reverse()
    .find(
      (d) => new Date(d.date).toISOString().split("T")[0] === searchDateStr,
    );

  return res.json({ success: true, dateEntry: newEntry });
};

exports.removeDaysOff = async (req, res) => {
  const { dateKey } = req.body;

  const cleanDate = new Date(dateKey);

  await DaysOff.updateOne(
    { company: res.locals.currentCompany._id },
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
  console.log(res.locals.currentCompany._id);

  await DaysOff.updateOne(
    {
      company: res.locals.currentCompany._id,
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
    const companyId = res.locals.currentCompany._id;

    console.log(weekdayIndex);
    console.log(slotId);
    console.log(companyId);

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
      },
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

exports.scheduleDayOff = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const { schedule, dateId } = req.body;

    if (!schedule || !schedule.start) {
      // Supprimer les horaires (remettre en congé total)
      await DaysOff.findOneAndUpdate(
        { company: companyId, "dates._id": dateId },
        { $set: { "dates.$.workingHours": [], "dates.$.dayOff": true } },
      );
    } else {
      await DaysOff.findOneAndUpdate(
        { company: companyId, "dates._id": dateId },
        {
          $set: {
            "dates.$.workingHours": [
              { start: schedule.start, end: schedule.end },
            ],
            "dates.$.dayOff": false,
          },
        },
      );
    }
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json(err);
  }
};

exports.updateDayOffEmployees = async (req, res) => {
  try {
    const { dayId } = req.params;
    const { employeeIds } = req.body;
    await DaysOff.updateOne(
      { company: res.locals.currentCompany._id, "dates._id": dayId },
      { $set: { "dates.$.employees": Array.isArray(employeeIds) ? employeeIds : [] } }
    );
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false });
  }
};

exports.setScheduleDayOff = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const { dateId, time, type } = req.body;

    if (!["start", "end"].includes(type)) {
      return res.status(400).json({ success: false, error: "Type undefined" });
    }

    const fieldPath = `dates.$.workingHours.0.${type}`;

    const updated = await DaysOff.findOneAndUpdate(
      { company: companyId, "dates._id": dateId },
      {
        $set: {
          [fieldPath]: time,
          "dates.$.dayOff": false,
        },
      },
      { new: true },
    );

    if (!updated) {
      return res.status(404).json({ success: false, error: "Date not found" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

exports.updateBuffer = async (req, res) => {
  try {
    const { bufferTime } = req.body;
    const value = Math.max(0, Math.min(60, Number(bufferTime) || 0));
    await Company.findByIdAndUpdate(res.locals.currentCompany._id, { bufferTime: value });
    return res.json({ success: true, bufferTime: value });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};
