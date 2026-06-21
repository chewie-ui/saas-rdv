// Archive la collection "pageviews" actuelle sous "pageviews_v1" (pour garder
// l'historique consultable au besoin), puis repart avec une collection
// "pageviews" vide — comptage "v2" propre (bots filtrés + beacon JS).
//
// Usage : NODE_ENV=production node scripts/reset-pageviews-v2.js
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

async function main() {
  await mongoose.connect(env.dbUri);
  const db = mongoose.connection.db;

  const collections = (await db.listCollections().toArray()).map((c) => c.name);

  if (!collections.includes("pageviews")) {
    console.log("Aucune collection 'pageviews' trouvée — rien à faire.");
    return process.exit(0);
  }

  if (collections.includes("pageviews_v1")) {
    console.log("'pageviews_v1' existe déjà — abandon pour ne rien écraser. Supprime-la manuellement si tu veux vraiment recommencer.");
    return process.exit(1);
  }

  const count = await db.collection("pageviews").countDocuments();
  await db.collection("pageviews").rename("pageviews_v1");
  console.log(`Archivé ${count} documents : 'pageviews' → 'pageviews_v1'.`);

  await db.createCollection("pageviews");
  console.log("Nouvelle collection 'pageviews' vide créée. Compteur repassé à 0 (v2).");

  process.exit(0);
}

main().catch((err) => {
  console.error("Erreur :", err);
  process.exit(1);
});
