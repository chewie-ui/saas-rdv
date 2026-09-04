/**
 * Audit LECTURE SEULE des octrois manuels posés sur des abonnés Stripe.
 *
 * Pourquoi : le webhook checkout.session.completed écrit `plan` +
 * `stripeSubscriptionId` sans jamais toucher `grantExpiry`. La colonne
 * « reste » du panneau superadmin ne lisant que `grantExpiry`, tout abonné
 * Stripe s'affichait « Illimité » — au point qu'on pouvait croire à un accès
 * offert par erreur et « corriger » en posant une durée à la main.
 *
 * Or getCompanyPlan() (utils/planLimits.js) fait :
 *     if (company.grantExpiry && grantExpiry <= now) return "basic";
 * Un octroi posé sur un abonné Stripe le fera donc RETOMBER EN GRATUIT à
 * l'échéance, alors que Stripe continue de le facturer.
 *
 * Ce script ne modifie rien : il liste les établissements concernés.
 * Correction : dans le panneau, cliquer le badge → « Illimité » (remet
 * grantExpiry à null), l'échéance redevenant celle gérée par Stripe.
 *
 * Usage :  NODE_ENV=production node scripts/audit-grant-vs-stripe.js
 */
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const Company = require("../db/models/company/company.model");

(async () => {
  await mongoose.connect(env.dbUri);
  console.log("Base :", mongoose.connection.name, "@", mongoose.connection.host, "\n");

  const payants = { $nin: ["", "basic"] };

  const conflits = await Company.find({
    plan: payants,
    isDeleted: { $ne: true },
    stripeSubscriptionId: { $nin: ["", null] },
    grantExpiry: { $ne: null },
  }).select("name plan grantExpiry stripeSubscriptionId").lean();

  console.log(`⚠️  Octroi manuel POSÉ SUR un abonné Stripe : ${conflits.length}`);
  console.log("   (retomberont en gratuit à l'échéance malgré la facturation Stripe)\n");
  for (const c of conflits) {
    const j = Math.ceil((new Date(c.grantExpiry) - Date.now()) / 86400000);
    console.log(`   - ${c.name || "(sans nom)"} | ${c.plan} | expire dans ${j} j (${new Date(c.grantExpiry).toISOString().slice(0, 10)})`);
  }

  const stripeOk = await Company.countDocuments({
    plan: payants, isDeleted: { $ne: true },
    stripeSubscriptionId: { $nin: ["", null] }, grantExpiry: null,
  });
  const octroiPur = await Company.countDocuments({
    plan: payants, isDeleted: { $ne: true },
    $or: [{ stripeSubscriptionId: "" }, { stripeSubscriptionId: null }, { stripeSubscriptionId: { $exists: false } }],
    grantExpiry: null,
  });

  console.log(`\n✅ Abonnés Stripe sans octroi (affichés « Abonné ») : ${stripeOk}`);
  console.log(`ℹ️  Octrois manuels réellement illimités (« Illimité ») : ${octroiPur}`);

  await mongoose.disconnect();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
