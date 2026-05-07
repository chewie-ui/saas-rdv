const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName:  { type: String, required: true, trim: true },
    age:       { type: Number, default: null },
    description: { type: String, default: "", trim: true },
    profilePicture: { type: String, default: "/images/no-user.webp" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Employee", employeeSchema);
