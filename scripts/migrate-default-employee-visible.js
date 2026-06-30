/**
 * Bascule `isEmployee` à `true` pour les collaborateurs déjà acceptés mais
 * créés avant le changement de défaut (cf. db/models/company/companyMembership.model.js
 * — un collaborateur accepté doit apparaître bookable par défaut, le
 * propriétaire le masque explicitement s'il ne veut pas). Le défaut du
 * schéma Mongoose ne s'applique qu'aux NOUVEAUX documents — ce script
 * corrige les memberships déjà en base avec `isEmployee: false` par défaut
 * (jamais explicitement masqués par un patron).
 *
 * Usage : node scripts/migrate-default-employee-visible.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const CompanyMembership = require("../db/models/company/companyMembership.model");

async function run() {
  await mongoose.connect(env.dbUri);
  console.log("Connecté à MongoDB.");

  const result = await CompanyMembership.updateMany(
    { status: "accepted", isEmployee: { $ne: true } },
    { $set: { isEmployee: true } }
  );

  console.log("──────────────────────────────────────────");
  console.log(`Collaborateurs basculés en "employé" : ${result.modifiedCount}`);
  console.log("──────────────────────────────────────────");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Erreur migration isEmployee par défaut:", err);
  process.exit(1);
});
