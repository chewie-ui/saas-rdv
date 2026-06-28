const mongoose = require("mongoose");
const schema = mongoose.Schema;

// "Rejoindre un établissement" — un User (sans établissement à lui) demande
// à rejoindre la Company d'un autre (uniquement plan Business, cf. plan
// d'unification des comptes). Le propriétaire doit approuver — tant que ce
// n'est pas "accepted", le demandeur n'a aucun accès au dashboard de cette
// Company (cf. middlewares/injectCompany.js).
const companyMembershipSchema = schema(
  {
    company: { type: schema.Types.ObjectId, ref: "Company", required: true },
    user:    { type: schema.Types.ObjectId, ref: "User",    required: true },
    status:  { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

companyMembershipSchema.index({ company: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("CompanyMembership", companyMembershipSchema);
