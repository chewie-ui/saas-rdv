const mongoose = require("mongoose");
const schema = mongoose.Schema;

const companySchema = schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },

  owner: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: true,
  },

  employees: [
    {
      type: schema.Types.ObjectId,
      ref: "User",
    },
  ],

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

  informations: {
    country: String,
    timezone: String,

    address: {
      street: String,
      city: String,
      zip: Number,
    },

    phone: String,
    description: String,
    services: String,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Company = mongoose.model("Company", companySchema);

module.exports = Company;
