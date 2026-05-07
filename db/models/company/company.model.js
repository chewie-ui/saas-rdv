const mongoose = require("mongoose");
const schema = mongoose.Schema;

const companySchema = schema(
  {
    owner: {
      type: schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    slug: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
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
        workingHours: {
          type: [{ start: String, end: String }],
          default: [{ start: "08:00", end: "16:00" }],
        },
      },
    ],
  },
  { timestamps: true },
);

const Company = mongoose.model("Company", companySchema);

module.exports = Company;
