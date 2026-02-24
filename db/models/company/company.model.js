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
      user: {
        type: schema.Types.ObjectId,
        ref: "User",
        required: true,
      },

      grade: {
        type: String,
        enum: ["owner", "admin", "staff"],
        default: "staff",
      },

      jobTitle: {
        type: String,
      },

      joinedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],

  slotTime: {
    type: Number,
    default: 30
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
