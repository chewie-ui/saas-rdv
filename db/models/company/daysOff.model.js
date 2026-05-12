const mongoose = require("mongoose");
const schema = mongoose.Schema;

const daysOffSchema = new schema({
  company: {
    type: schema.Types.ObjectId,
    ref: "Company",
    required: true,
    index: true,
  },

  dates: [
    {
      date: {
        type: Date,
        required: true,
      },
      workingHours: [{ start: String, end: String }],
      dayOff: Boolean,
      // [] = applies to ALL employees; [id1, id2] = specific employees only
      employees: [{ type: schema.Types.ObjectId, ref: "Employee" }],
    },
  ],
});

const DaysOff = mongoose.model("DaysOff", daysOffSchema);

module.exports = DaysOff;
