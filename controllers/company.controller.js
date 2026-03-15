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
  const { dateKey } = req.body;
  await DaysOff.findOneAndUpdate(
    { company: res.locals.currentCompany._id },
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
    const { companyId } = req.session;
    const { schedule, dateId } = req.body;

    await DaysOff.findOneAndUpdate(
      { company: companyId, "dates._id": dateId },
      {
        $set: {
          "dates.$.workingHours": [
            { start: schedule.start, end: schedule.end },
          ],
        },
      },
    );
    return res.json({ success: true });
  } catch (err) {
    return res.json(err);
  }
};

exports.setScheduleDayOff = async (req, res) => {
  try {
    const { companyId } = req.session;
    const { dateId, time, type } = req.body;

    if (!["start", "end"].includes(type)) {
      return res.status(400).json({ success: false, error: "Type undefined" });
    }

    const path = `dates.$.workingHours.0.${type}`;

    const updated = await DaysOff.findOneAndUpdate(
      { company: companyId, "dates._id": dateId },
      {
        $set: {
          [path]: time,
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
