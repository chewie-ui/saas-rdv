const mongoose = require("mongoose");
const schema = mongoose.Schema;

const userSchema = schema(
  {
    fullName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    companies: [
      {
        role: {
          type: String,
          enum: ["owner", "employee"],
        },
        company: {
          type: schema.Types.ObjectId,
          required: true,
          ref: "Company",
        },
        status: {
          type: String,
          enum: ["fired", "active"],
          default: "active",
        },
      },
    ],
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamp: true },
);

const User = mongoose.model("User", userSchema);

module.exports = User;
