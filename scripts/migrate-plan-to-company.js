/**
 * Migration — forfait et accès offert : du COMPTE vers l'ÉTABLISSEMENT.
 *
 * Le forfait vivait sur `User` (subscription.plan, manualPremium,
 * manualPremiumExpiry). Un patron possédant deux établissements voyait donc
 * « Business 3 jours » accordé à l'un s'appliquer à l'autre : ils partageaient
 * le même compte, donc le même forfait.
 *
 * Le forfait vit désormais sur `Company` (plan, planStatus, grantExpiry).
 *
 * Stratégie : chaque établissement SANS forfait propre reçoit celui que son
 * propriétaire lui donnait déjà en pratique. Personne ne gagne ni ne perd
 * d'accès — on grave l'état actuel, puis les établissements deviennent
 * indépendants les uns des autres.
 *
 * Idempotent : un établissement ayant déjà un `plan` n'est jamais réécrit.
 *
 *   node scripts/migrate-plan-to-company.js          (simulation)
 *   node scripts/migrate-plan-to-company.js --apply  (écriture)
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const User = require("../db/models/user.model");
const Company = require("../db/models/company/company.model");
const { getPlan } = require("../utils/planLimits");

const APPLIQUER = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(env.dbUri);
  console.log("Base :", mongoose.connection.name, APPLIQUER ? "" : "  [SIMULATION — rien n'est écrit]");
  console.log("");

  const companies = await Company.find({ isDeleted: { $ne: true } })
    .populate("owner", "isPremium manualPremium manualPremiumExpiry subscription")
    .lean();

  let migres = 0;
  let dejaPourvus = 0;
  let sansProprietaire = 0;

  for (const c of companies) {
    if (c.plan) { dejaPourvus++; continue; }
    if (!c.owner) { sansProprietaire++; continue; }

    // Forfait que le compte accordait jusqu'ici à cet établissement.
    const plan = getPlan(c.owner);
    // L'échéance ne suit que pour un accès OFFERT ; un abonnement Stripe n'en
    // a pas, il court tant qu'il est payé.
    const grantExpiry = c.owner.manualPremium && c.owner.manualPremiumExpiry
      ? new Date(c.owner.manualPremiumExpiry)
      : null;

    console.log(
      "  " + String(c.name || c._id).slice(0, 30).padEnd(31),
      "<- " + plan.padEnd(10),
      grantExpiry ? "échéance " + grantExpiry.toLocaleDateString("fr-FR") : "sans échéance"
    );

    if (APPLIQUER) {
      await Company.updateOne(
        { _id: c._id },
        { $set: { plan, planStatus: "active", grantExpiry } }
      );
    }
    migres++;
  }

  console.log("");
  console.log(
    companies.length + " établissement(s) — " + migres + " migré(s), " +
    dejaPourvus + " ayant déjà un forfait propre, " + sansProprietaire + " sans propriétaire (ignoré)."
  );
  console.log("Après cette migration, changer le forfait d'un établissement n'affecte plus les autres.");
  if (!APPLIQUER) console.log("\nRelancez avec --apply pour écrire.");

  await mongoose.disconnect();
})().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
