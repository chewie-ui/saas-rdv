/**
 * Backfill — facturation par établissement (Phase 2).
 *
 * Recopie le forfait EFFECTIF du compte owner sur chacun de ses établissements
 * (`company.plan` / `planStatus` / `stripeSubscriptionId`), UNIQUEMENT quand
 * `company.plan` est encore vide (idempotent, ne réécrase jamais un plan déjà
 * défini par un webhook Stripe).
 *
 * Choix volontaire : si un owner possède plusieurs établissements avec un seul
 * abonnement, TOUS héritent du plan payant. On sur-attribue légèrement plutôt
 * que de retirer un accès dont l'établissement bénéficie déjà aujourd'hui
 * (le plan est actuellement partagé au niveau du compte). La réconciliation
 * (1 abonnement = 1 établissement) se fera ensuite via les nouveaux checkouts.
 *
 * Usage :  NODE_ENV=production node scripts/backfill-company-plan.js
 * Ajoute --dry pour un aperçu sans écriture.
 */
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const User = require("../db/models/user.model");
const Company = require("../db/models/company/company.model");
const { getPlan } = require("../utils/planLimits");

const DRY = process.argv.includes("--dry");

async function main() {
  await mongoose.connect(env.mongoUri || env.mongoURI || process.env.MONGO_URI);
  console.log(`[backfill] connecté${DRY ? " (DRY RUN)" : ""}`);

  const companies = await Company.find({ isDeleted: { $ne: true } })
    .select("_id owner plan planStatus stripeSubscriptionId name")
    .lean();

  // Cache des owners pour éviter les requêtes répétées.
  const ownerCache = new Map();
  async function ownerOf(id) {
    const key = String(id);
    if (!ownerCache.has(key)) {
      ownerCache.set(key, await User.findById(id).select("subscription isPremium manualPremium").lean());
    }
    return ownerCache.get(key);
  }

  let updated = 0, skipped = 0;
  for (const c of companies) {
    if (c.plan) { skipped++; continue; } // déjà défini (webhook) → on ne touche pas
    const owner = await ownerOf(c.owner);
    const plan = getPlan(owner); // "basic" | "essentiel" | "pro" | "business"
    // Rien à écrire pour un plan gratuit : company.plan vide = hérite déjà.
    if (plan === "basic") { skipped++; continue; }

    const patch = {
      plan,
      planStatus: "active",
      stripeSubscriptionId: (owner && owner.subscription && owner.subscription.stripeSubscriptionId) || "",
    };
    console.log(`  ${DRY ? "[dry] " : ""}${c.name || c._id} → ${plan}`);
    if (!DRY) await Company.findByIdAndUpdate(c._id, patch);
    updated++;
  }

  console.log(`[backfill] terminé — ${updated} mis à jour, ${skipped} inchangés (sur ${companies.length}).`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error("[backfill] ERREUR:", e); process.exit(1); });
