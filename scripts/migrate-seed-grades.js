/**
 * Crée les grades "Manager"/"Staff" pour chaque Company existante et
 * réassigne chaque CompanyMembership depuis son ancien champ `role`
 * (enum manager/staff, retiré du schéma) vers le nouveau `grade` (ref
 * CompanyGrade) — cf. système de grades/permissions.
 *
 * Pas de prod réelle à préserver (plan encore en test) donc pas de mode
 * dry-run séparé comme pour migrate-merge-client-into-user.js — le script
 * écrit directement, mais log un résumé par établissement pour vérification
 * après coup. Idempotent : une company qui a déjà ses grades "Manager"/
 * "Staff" (isBuiltIn:true) n'en recrée pas, un membership qui a déjà un
 * grade assigné n'est pas retouché.
 *
 * Usage : node scripts/migrate-seed-grades.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const CompanyGrade = require("../db/models/company/companyGrade.model");
const { DEFAULT_GRADE_TEMPLATES } = require("../utils/permissions");

async function ensureBuiltInGrades(companyId) {
  const names = Object.keys(DEFAULT_GRADE_TEMPLATES); // ["Manager", "Staff"]
  const existing = await CompanyGrade.find({ company: companyId, name: { $in: names } }).lean();
  const existingNames = new Set(existing.map((g) => g.name));

  const created = {};
  for (const name of names) {
    const found = existing.find((g) => g.name === name);
    if (found) {
      created[name] = found._id;
      continue;
    }
    const grade = await CompanyGrade.create({
      company: companyId,
      name,
      isBuiltIn: true,
      permissions: DEFAULT_GRADE_TEMPLATES[name],
    });
    created[name] = grade._id;
  }
  return { gradeIdByName: created, alreadyExisted: existingNames.size === names.length };
}

async function run() {
  await mongoose.connect(env.dbUri);
  console.log("Connecté à MongoDB.");

  const companies = await Company.find({}).select("_id name").lean();
  console.log(`${companies.length} établissement(s) à traiter.`);

  let companiesSeeded = 0;
  let membershipsMigrated = 0;
  let membershipsSkipped = 0;

  for (const company of companies) {
    const { gradeIdByName } = await ensureBuiltInGrades(company._id);
    companiesSeeded++;

    // Champ `role` retiré du schéma Mongoose mais peut encore exister en
    // base sur de vieux documents — on le lit via le doc brut (lean) qui
    // renvoie tous les champs stockés, schéma ou pas.
    const memberships = await CompanyMembership.find({ company: company._id }).lean();

    for (const m of memberships) {
      if (m.grade) {
        membershipsSkipped++;
        continue;
      }
      const oldRole = m.role === "manager" ? "Manager" : "Staff";
      const gradeId = gradeIdByName[oldRole];
      await CompanyMembership.updateOne(
        { _id: m._id },
        { $set: { grade: gradeId }, $unset: { role: "" } }
      );
      membershipsMigrated++;
    }
  }

  console.log("──────────────────────────────────────────");
  console.log(`Établissements traités     : ${companiesSeeded}`);
  console.log(`Memberships migrés         : ${membershipsMigrated}`);
  console.log(`Memberships déjà migrés    : ${membershipsSkipped}`);
  console.log("──────────────────────────────────────────");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Erreur migration grades:", err);
  process.exit(1);
});
