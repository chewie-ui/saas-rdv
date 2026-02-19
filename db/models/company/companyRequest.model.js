const mongoose = require("mongoose");
const schema = mongoose.Schema;

const CompanyRequestSchema = new schema({
  company: {
    type: schema.Types.ObjectId,
    ref: "Company",
    required: true,
  },
  user: {
    type: schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "accepted", "rejected"],
    default: "pending",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

CompanyRequestSchema.index({ company: 1, user: 1 }, { unique: true });

const CompanyRequest = mongoose.model("CompanyRequest", CompanyRequestSchema);

module.exports = CompanyRequest;
