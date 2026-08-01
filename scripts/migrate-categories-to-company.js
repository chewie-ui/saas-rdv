/**
 * Migration — catégories de services : du COMPTE vers l'ÉTABLISSEMENT.
 *
 * Les catégories vivaient dans `User.calendarSettings.categories`. Un patron
 * possédant deux établissements voyait donc les mêmes catégories partout, et
 * un établissement fraîchement créé arrivait déjà rempli de celles du premier.
 *
 * Elles vivent désormais dans `Company.categories`.
 *
 * Stratégie : on recopie la liste du propriétaire sur CHACUN de ses
 * établissements. C'est volontaire — aujourd'hui tous affichent déjà cette
 * même liste, et leurs services y font référence par NOM. Ne recopier que sur
 * le premier ferait perdre leur regroupement aux services des autres. Chaque
 * établissement peut ensuite être nettoyé indépendamment : c'est justement ce
 * que la bascule rend possible.
 *
 * Idempotent : un établissement qui a déjà ses propres catégories n'est jamais
 * écrasé.
 *
 *   node scripts/migrate-categories-to-company.js          (simulation)
 *   node scripts/migrate-categories-to-company.js --apply  (écriture)
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const User = require("../db/models/user.model");
const Company = require("../db/models/company/company.model");

const APPLY = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(env.dbUri);
  console.log(`Base : ${mongoose.connection.name}${APPLY ? "" : "   [SIMULATION — rien n'est écrit]"}\n`);

  const companies = await Company.find({ isDeleted: { $ne: true } })
    .select("_id name owner categories bookingCategoryStyle")
    .lean();

  let migres = 0;
  let deja = 0;
  let sansSource = 0;

  for (const co of companies) {
    if ((co.categories || []).length > 0) {
      deja++;
      continue;
    }
    const owner = await User.findById(co.owner).select("calendarSettings").lean();
    const cats = (owner && owner.calendarSettings && owner.calendarSettings.categories) || [];
    if (!cats.length) {
      sansSource++;
      continue;
    }

    const clean = cats
      .filter((c) => c && typeof c.name === "string" && c.name.trim())
      .map((c) => ({ name: c.name.trim(), icon: (c.icon || "").slice(0, 10) }));
    const style = (owner.calendarSettings && owner.calendarSettings.bookingCategoryStyle) || "pills";

    console.log(
      `  ${(co.name || String(co._id)).padEnd(28)} <- ${clean.length} catégorie(s) : ${clean.map((c) => c.name).join(", ")}`
    );

    if (APPLY) {
      await Company.updateOne(
        { _id: co._id },
        { $set: { categories: clean, bookingCategoryStyle: style } }
      );
    }
    migres++;
  }

  console.log(
    `\n${companies.length} établissement(s) — ${migres} migré(s), ${deja} déjà pourvu(s), ${sansSource} sans catégorie à reprendre.`
  );
  if (!APPLY && migres > 0) console.log("Relancez avec --apply pour écrire.");

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
