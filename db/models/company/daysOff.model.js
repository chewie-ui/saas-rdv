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
    },
  ],
});

const DaysOff = mongoose.model("DaysOff", daysOffSchema);

module.exports = DaysOff;
