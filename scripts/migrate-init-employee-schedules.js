/**
 * Initialise le schedule individuel de tous les CompanyMembership isEmployee:true
 * dont le schedule est encore vide, en copiant le Company.schedule de leur établissement.
 *
 * À lancer une seule fois après avoir activé le mode "par employé" et constaté
 * que les modifications d'horaire ne s'enregistraient pas (bug lazy-init corrigé
 * dans toggleDay/editAvailabilty, ce script fixe les enregistrements existants).
 *
 * Usage : node scripts/migrate-init-employee-schedules.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");

async function run() {
  await mongoose.connect(env.mongoUri);
  console.log("Connected to MongoDB");

  const companies = await Company.find({ scheduleMode: "perEmployee" }).select("schedule scheduleMode").lean();
  console.log(`Found ${companies.length} companies in perEmployee mode`);

  let total = 0;
  for (const company of companies) {
    const result = await CompanyMembership.updateMany(
      {
        company: company._id,
        isEmployee: true,
        $or: [{ schedule: { $size: 0 } }, { schedule: { $exists: false } }],
      },
      { $set: { schedule: company.schedule || [] } }
    );
    if (result.modifiedCount > 0) {
      console.log(`  Company ${company._id}: initialized ${result.modifiedCount} membership(s)`);
      total += result.modifiedCount;
    }
  }

  console.log(`Done. Total memberships initialized: ${total}`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
