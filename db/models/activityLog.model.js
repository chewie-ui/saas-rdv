const mongoose = require("mongoose");
const schema = mongoose.Schema;

// Historique des actions effectuées sur un établissement (cf. page "Logs") —
// permet au propriétaire de voir ce que font ses collaborateurs (ex: "X a
// supprimé le service Y"). userName/role sont des snapshots au moment de
// l'action : on garde une trace même si le collaborateur est retiré plus tard.
const activityLogSchema = schema(
  {
    company: { type: schema.Types.ObjectId, ref: "Company", required: true },
    user:     { type: schema.Types.ObjectId, ref: "User", default: null },
    userName: { type: String, default: "" },
    role:     { type: String, default: "" }, // "owner" | "manager" | "staff"
    action:      { type: String, required: true },   // ex: "service.delete"
    description: { type: String, required: true },   // texte affiché tel quel
  },
  { timestamps: true }
);

activityLogSchema.index({ company: 1, createdAt: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
