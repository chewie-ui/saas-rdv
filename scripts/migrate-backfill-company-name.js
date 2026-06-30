/**
 * Backfill de `Company.name` pour les établissements créés avant la
 * fonctionnalité multi-établissements (où le nom vivait uniquement sur
 * `User.businessName`). Sans ce backfill, l'affichage `currentCompany.name
 * || user.businessName || 'Établissement'` (sidebar.pug) retombe sur
 * `user.businessName` — qui n'existe que côté owner — et affiche
 * "Établissement" générique pour tout collaborateur connecté.
 *
 * Idempotent : ne touche que les Company avec `name` vide.
 *
 * Usage : node scripts/migrate-backfill-company-name.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const Company = require("../db/models/company/company.model");
const User = require("../db/models/user.model");

async function run() {
  await mongoose.connect(env.dbUri);
  console.log("Connecté à MongoDB.");

  const companies = await Company.find({
    $or: [{ name: { $exists: false } }, { name: "" }],
  }).select("_id owner").lean();

  console.log(`${companies.length} établissement(s) sans nom à corriger.`);

  let updated = 0;
  let skipped = 0;

  for (const company of companies) {
    const owner = await User.findById(company.owner).select("businessName").lean();
    const name = (owner && owner.businessName && owner.businessName.trim()) || "Établissement";

    await Company.updateOne({ _id: company._id }, { $set: { name } });
    updated++;
    console.log(`  - ${company._id} → "${name}"`);
  }

  console.log("──────────────────────────────────────────");
  console.log(`Établissements corrigés : ${updated}`);
  console.log(`Ignorés (déjà nommés)   : ${skipped}`);
  console.log("──────────────────────────────────────────");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Erreur migration backfill nom d'établissement:", err);
  process.exit(1);
});
