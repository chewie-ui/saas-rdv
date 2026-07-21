/**
 * Nettoyage des abonnements : repasse en "basic" (retire l'accès premium) les
 * utilisateurs qui ont encore isPremium=true / subscription.status="active" en
 * base alors que leur abonnement Stripe n'est PLUS actif (annulé, impayé,
 * supprimé…). Utile une fois après l'ajout de la révocation par webhook
 * (customer.subscription.deleted / updated) : les comptes qui avaient déjà
 * arrêté de payer AVANT ce correctif n'avaient jamais été révoqués.
 *
 * Ne touche JAMAIS :
 *   - les comptes manualPremium (octroi manuel superadmin),
 *   - les abonnements Stripe encore actifs / en essai / en relance (past_due).
 *
 * SÉCURITÉ : dry-run par défaut (n'écrit rien, se contente de LISTER).
 *   node scripts/cleanup-subscriptions.js              → aperçu (dry-run)
 *   node scripts/cleanup-subscriptions.js --apply      → applique les révocations
 *   node scripts/cleanup-subscriptions.js --apply --include-orphans
 *       → révoque AUSSI les comptes premium sans aucun abonnement Stripe
 *         (ni manuel) — à n'utiliser qu'en connaissance de cause.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const User = require("../db/models/user.model");
const Subscription = require("../db/models/subscription.model");

const APPLY = process.argv.includes("--apply");
const INCLUDE_ORPHANS = process.argv.includes("--include-orphans");

// Statuts Stripe qui CONSERVENT l'accès (past_due = paiement en relance, période
// de grâce — on ne coupe pas sur un simple refus temporaire de carte).
const KEEP_STATUSES = new Set(["active", "trialing", "past_due"]);

async function run() {
  if (!env.stripeSecretKey) {
    console.error("❌ env.stripeSecretKey manquant — impossible d'interroger Stripe.");
    process.exit(1);
  }
  const stripe = require("stripe")(env.stripeSecretKey);

  await mongoose.connect(env.dbUri);
  console.log(`Base : ${mongoose.connection.name}`);
  console.log(APPLY ? "🟢 MODE APPLY — les modifications seront écrites.\n" : "🟡 DRY-RUN — aucune écriture (ajoute --apply pour exécuter).\n");

  // Comptes premium NON manuels : ce sont eux qu'on vérifie contre Stripe.
  const candidates = await User.find({
    manualPremium: { $ne: true },
    $or: [{ isPremium: true }, { "subscription.status": "active" }],
  }).select("_id email fullName isPremium subscription").lean();

  console.log(`Comptes premium (non manuels) à vérifier : ${candidates.length}\n`);

  let revoked = 0, kept = 0, orphans = 0, errors = 0;

  for (const u of candidates) {
    const subId = u.subscription && u.subscription.stripeSubscriptionId;
    const who = `${u.email || u._id} (${u.fullName || "?"})`;

    // ── Cas 1 : aucun abonnement Stripe rattaché ──────────────────────────
    if (!subId) {
      orphans++;
      if (INCLUDE_ORPHANS) {
        console.log(`  🚫 ORPHELIN (aucun sub Stripe) → révoqué : ${who}`);
        if (APPLY) await revoke(u._id, null);
      } else {
        console.log(`  ⚠️  ORPHELIN (aucun sub Stripe, non manuel) : ${who} — ignoré (utilise --include-orphans pour le révoquer)`);
      }
      continue;
    }

    // ── Cas 2 : on interroge Stripe pour l'état réel de l'abonnement ───────
    let status;
    try {
      const sub = await stripe.subscriptions.retrieve(subId);
      status = sub.status;
    } catch (err) {
      // "No such subscription" = abonnement supprimé côté Stripe → à révoquer.
      if (err && err.code === "resource_missing") {
        status = "deleted";
      } else {
        errors++;
        console.log(`  ⁉️  ERREUR Stripe pour ${who} (sub ${subId}) : ${err.message} — ignoré`);
        continue;
      }
    }

    if (KEEP_STATUSES.has(status)) {
      kept++;
      // console.log(`  ✅ Actif (${status}) : ${who}`);
    } else {
      revoked++;
      console.log(`  🚫 Stripe "${status}" → révoqué : ${who}`);
      if (APPLY) await revoke(u._id, subId);
    }
  }

  // ── Info bonus : octrois manuels expirés (non touchés — décision superadmin) ─
  const expiredManual = await User.countDocuments({
    manualPremium: true,
    manualPremiumExpiry: { $ne: null, $lt: new Date() },
  });

  console.log("\n──────── Résumé ────────");
  console.log(`  À révoquer (Stripe non actif) : ${revoked}`);
  console.log(`  Conservés (Stripe actif/relance) : ${kept}`);
  console.log(`  Orphelins sans sub Stripe : ${orphans}${INCLUDE_ORPHANS ? " (révoqués)" : " (ignorés)"}`);
  console.log(`  Erreurs Stripe : ${errors}`);
  console.log(`  (info) Octrois manuels expirés, NON touchés : ${expiredManual}`);
  console.log(APPLY ? "\n✅ Modifications appliquées." : "\n🟡 Dry-run terminé — relance avec --apply pour appliquer.");
  process.exit(0);
}

async function revoke(userId, subId) {
  await User.updateOne(
    { _id: userId },
    { $set: { isPremium: false, "subscription.status": "cancelled" } }
  );
  if (subId) {
    await Subscription.updateMany(
      { user: userId, stripeSubscriptionId: subId },
      { $set: { status: "cancelled" } }
    );
  }
}

run().catch((err) => {
  console.error("Erreur script:", err);
  process.exit(1);
});
