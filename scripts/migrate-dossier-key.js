// Migration : renseigne ClientDossier.clientKey et remplace l'index unique
// (company, email) par (company, clientKey).
//
// À lancer AVANT de déployer le nouveau modèle en production, sans quoi
// l'ancien index unique rejette deux dossiers sans e-mail.
//
//   node scripts/migrate-dossier-key.js          → simulation (aucune écriture)
//   node scripts/migrate-dossier-key.js --write  → applique
//
// La cible est choisie par MONGO_URI (défaut : la base LOCALE). Passer
// --prod pour viser MONGO_URI_SERVER.
const mongoose = require("mongoose");
require("dotenv").config({ quiet: true });
const { dossierKey } = require("../utils/dossierKey");

const ECRIRE = process.argv.includes("--write");
const PROD = process.argv.includes("--prod");
const uri = PROD ? process.env.MONGO_URI_SERVER : process.env.MONGO_URI_LOCAL;

(async () => {
  if (!uri) { console.error("URI de base introuvable"); process.exit(1); }
  await mongoose.connect(uri);
  const col = mongoose.connection.db.collection("clientdossiers");
  console.log(`Base : ${mongoose.connection.name} (${PROD ? "PRODUCTION" : "locale"})`);
  console.log(ECRIRE ? "Mode : ÉCRITURE\n" : "Mode : simulation — rien ne sera modifié\n");

  const docs = await col.find({}).project({ company: 1, email: 1, phone: 1, fullName: 1, lastName: 1, firstName: 1, clientKey: 1 }).toArray();
  const vues = new Map();   // company+clé → premier _id, pour repérer les collisions
  let aEcrire = 0, collisions = 0;

  for (const d of docs) {
    const cle = dossierKey(d) || String(d._id);
    if (d.clientKey === cle) continue;
    // Deux dossiers qui produisent la même clé ne peuvent pas coexister sous
    // l'index unique : on le signale plutôt que de faire échouer la migration
    // au milieu.
    const k = String(d.company) + "|" + cle;
    if (vues.has(k)) {
      collisions++;
      console.log(`  ⚠ collision  ${cle}  (${d._id} et ${vues.get(k)})`);
      continue;
    }
    vues.set(k, d._id);
    aEcrire++;
    if (ECRIRE) await col.updateOne({ _id: d._id }, { $set: { clientKey: cle } });
    else console.log(`  ${String(d._id).slice(-6)}  ${(d.email || "(sans e-mail)").padEnd(34)} → ${cle}`);
  }

  console.log(`\n${docs.length} dossiers | ${aEcrire} à mettre à jour | ${collisions} collision(s)`);

  if (ECRIRE) {
    const idx = await col.indexes();
    if (idx.some((i) => i.name === "company_1_email_1")) {
      await col.dropIndex("company_1_email_1");
      console.log("ancien index (company, email) supprimé");
    }
    await col.createIndex({ company: 1, clientKey: 1 }, { unique: true });
    console.log("nouvel index (company, clientKey) créé");
  } else {
    console.log("\nRelancer avec --write pour appliquer.");
  }
  process.exit(0);
})().catch((e) => { console.error("ERREUR :", e.message); process.exit(1); });
