/**
 * Migration — identité publique : du COMPTE vers l'ÉTABLISSEMENT.
 *
 * Adresse, email/téléphone pro, réseaux sociaux, site web, description et
 * texte « À propos » vivaient uniquement sur `User`. Un patron possédant deux
 * établissements voyait donc les infos du premier s'afficher sur la page
 * publique du second.
 *
 * Ces champs vivent désormais sur `Company`.
 *
 * Stratégie : les valeurs du compte sont recopiées sur son établissement
 * D'ORIGINE uniquement — celui que `User.company` désigne, créé à l'époque où
 * un compte n'en avait qu'un. Les établissements créés ensuite ne reçoivent
 * RIEN : c'est précisément la fuite qu'on corrige. Ils restent vides jusqu'à
 * ce que le pro les remplisse depuis la page Informations.
 *
 * Idempotent : un champ déjà renseigné sur l'établissement n'est jamais écrasé.
 *
 *   node scripts/migrate-identity-to-company.js          (simulation)
 *   node scripts/migrate-identity-to-company.js --apply  (écriture)
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const User = require("../db/models/user.model");
const Company = require("../db/models/company/company.model");
const { IDENTITY_FIELDS } = require("../utils/establishmentIdentity");

const APPLY = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(env.dbUri);
  console.log(`Base : ${mongoose.connection.name}${APPLY ? "" : "   [SIMULATION — rien n'est écrit]"}\n`);

  // Seuls les comptes qui pointent vers un établissement d'origine.
  const users = await User.find({ company: { $ne: null } })
    .select(`company phone ${IDENTITY_FIELDS.join(" ")}`)
    .lean();

  let migres = 0;
  let rien = 0;
  let introuvables = 0;

  for (const u of users) {
    const co = await Company.findById(u.company).select(IDENTITY_FIELDS.join(" ")).lean();
    if (!co) {
      introuvables++;
      continue;
    }

    const set = {};
    for (const f of IDENTITY_FIELDS) {
      if (co[f]) continue; // déjà renseigné côté établissement → on n'écrase pas
      const val = u[f] || (f === "phonePro" ? u.phone : "") || "";
      if (val) set[f] = val;
    }

    if (!Object.keys(set).length) {
      rien++;
      continue;
    }

    console.log(`  ${String(u.company)} : ${Object.keys(set).join(", ")}`);
    if (APPLY) await Company.updateOne({ _id: u.company }, { $set: set });
    migres++;
  }

  console.log(
    `\n${users.length} compte(s) avec établissement d'origine — ${migres} migré(s), ${rien} sans rien à reprendre, ${introuvables} établissement(s) introuvable(s).`
  );
  console.log(
    "Les établissements SECONDAIRES ne reçoivent volontairement rien : ils démarrent vides."
  );
  if (!APPLY && migres > 0) console.log("\nRelancez avec --apply pour écrire.");

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
