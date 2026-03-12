const mongoose = require("mongoose");
const schema = mongoose.Schema;

const companySchema = schema(
  {
    owner: {
      type: schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    slotTime: {
      type: Number,
      default: 30,
    },

    schedule: [
      {
        weekdayIndex: {
          type: Number,
          required: true,
          min: 0,
          max: 6,
        },
        dayOff: {
          type: Boolean,
          default: false,
        },
        workingHours: [
          {
            start: String,
            end: String,
          },
        ],
      },
    ],
  },
  { timestamps: true },
);

const Company = mongoose.model("Company", companySchema);

module.exports = Company;
