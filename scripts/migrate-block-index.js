/**
 * Migration — sortir les absences de l'index unique des rendez-vous.
 *
 * L'index `company_1_date_1_startTime_1_employee_1` empêche de réserver deux
 * fois le même praticien à la même minute. Les absences (`isBlock: true`) y
 * étaient soumises alors qu'elles se posent PAR-DESSUS des rendez-vous déjà
 * réservés, sans les annuler : poser une absence commençant à l'heure exacte
 * d'un rendez-vous non assigné échouait en E11000, et le pro voyait
 * « Une erreur est survenue » sans explication.
 *
 * Deux opérations :
 *   1. `isBlock: false` sur les documents antérieurs au champ — sinon ils
 *      sortiraient de l'index (le filtre partiel exige l'égalité stricte) et
 *      perdraient leur protection contre le double-booking.
 *   2. Suppression de l'ancien index, recréation avec `isBlock: false` dans le
 *      filtre partiel.
 *
 * Idempotent : relancer ne fait rien si l'index est déjà au bon format.
 *
 *   node scripts/migrate-block-index.js          (simulation)
 *   node scripts/migrate-block-index.js --apply  (écriture)
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const Booking = require("../db/models/book.model");

const APPLIQUER = process.argv.includes("--apply");
const NOM_INDEX = "company_1_date_1_startTime_1_employee_1";
const FILTRE_CIBLE = { status: "confirmed", isGroup: false, isBlock: false };

(async () => {
  await mongoose.connect(env.dbUri);
  console.log("Base :", mongoose.connection.name, APPLIQUER ? "" : "  [SIMULATION — rien n'est écrit]");
  console.log("");

  const collection = Booking.collection;

  // ── 1. Documents sans le champ isBlock ────────────────────────────────────
  const sansChamp = await collection.countDocuments({ isBlock: { $exists: false } });
  console.log(`Documents sans \`isBlock\` : ${sansChamp}`);
  if (sansChamp > 0 && APPLIQUER) {
    const r = await collection.updateMany({ isBlock: { $exists: false } }, { $set: { isBlock: false } });
    console.log(`  → ${r.modifiedCount} complétés à false`);
  }

  // ── 2. L'index lui-même ───────────────────────────────────────────────────
  const indexes = await collection.indexes();
  const existant = indexes.find((i) => i.name === NOM_INDEX);

  if (!existant) {
    console.log(`\nIndex \`${NOM_INDEX}\` absent.`);
  } else {
    const filtre = existant.partialFilterExpression || {};
    if (filtre.isBlock === false) {
      console.log(`\nIndex \`${NOM_INDEX}\` déjà au bon format — rien à faire.`);
      await mongoose.disconnect();
      return;
    }
    console.log(`\nIndex \`${NOM_INDEX}\` à refaire :`);
    console.log("  filtre actuel :", JSON.stringify(filtre));
    console.log("  filtre cible  :", JSON.stringify(FILTRE_CIBLE));
    if (APPLIQUER) {
      await collection.dropIndex(NOM_INDEX);
      console.log("  → ancien index supprimé");
    }
  }

  if (APPLIQUER) {
    // Une absence et un rendez-vous ont pu coexister sur la même clé pendant
    // la fenêtre sans index ; la recréation échouerait alors. On ne relève ce
    // cas que s'il se produit, pour le signaler clairement plutôt que planter.
    try {
      await collection.createIndex(
        { company: 1, date: 1, startTime: 1, employee: 1 },
        { unique: true, partialFilterExpression: FILTRE_CIBLE, name: NOM_INDEX },
      );
      console.log("  → nouvel index créé");
    } catch (err) {
      console.error("\n❌ Création impossible :", err.message);
      console.error("   Des rendez-vous en double existent sur (établissement, date, heure, praticien).");
      console.error("   L'index reste absent : à corriger avant de relancer.");
      process.exitCode = 1;
    }
  } else {
    console.log("\nRelancer avec --apply pour appliquer.");
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
