/**
 * Rattrape les coordonnées manquantes des établissements.
 *
 * Le tri « autour de moi » et la distance affichée sur /search s'appuient sur
 * `estabLocation.lat` / `.lon`. Ces champs ne sont remplis que si le pro a
 * CLIQUÉ sur une suggestion de l'autocomplétion d'adresse ; taper son adresse
 * à la main enregistre le texte sans coordonnées. La plupart des fiches n'en
 * ont donc pas, et n'apparaissent nulle part dans un tri par distance.
 *
 *   node scripts/geocoder-etablissements.js              # simulation
 *   node scripts/geocoder-etablissements.js --apply      # écrit
 *   node scripts/geocoder-etablissements.js --apply --prod
 *
 * Où sont écrites les coordonnées : DANS LE MÊME DOCUMENT QUE L'ADRESSE.
 * Sur les fiches antérieures au multi-établissement, l'adresse vit sur le
 * compte du patron et `Company.location` est vide. Y écrire lat/lon ferait
 * basculer `hasLocation()` (utils/establishmentIdentity.js) à vrai pour une
 * location qui n'aurait QUE des coordonnées : l'adresse et la ville
 * disparaîtraient alors des cartes de résultats. On écrit donc là où
 * l'adresse se trouve déjà.
 *
 * Nominatim : 1 requête/seconde, imposée par utils/geocodage.js. Compter
 * environ une seconde par établissement à traiter.
 */

require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const { geocoderLocation, adresseDe } = require("../utils/geocodage");

const APPLIQUER = process.argv.includes("--apply");
const PROD = process.argv.includes("--prod");
const URI = PROD ? process.env.MONGO_URI_SERVER : process.env.MONGO_URI_LOCAL;

function aDesCoords(loc) {
  return !!(loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lon))
    && Number(loc.lat) !== 0 && Number(loc.lon) !== 0);
}

(async () => {
  if (!URI) {
    console.error(`Variable ${PROD ? "MONGO_URI_SERVER" : "MONGO_URI_LOCAL"} absente de .env`);
    process.exit(1);
  }

  await mongoose.connect(URI, { serverSelectionTimeoutMS: 15000 });
  console.log(`Base : ${PROD ? "PRODUCTION" : "locale"}`);
  console.log(APPLIQUER ? "Mode : ÉCRITURE\n" : "Mode : simulation (rien n'est écrit)\n");

  const Companies = mongoose.connection.db.collection("companies");
  const Users = mongoose.connection.db.collection("users");

  const fiches = await Companies.find({ isDeleted: { $ne: true } }).toArray();

  let dejaOk = 0, sansAdresse = 0, trouves = 0, echecs = 0;

  for (const c of fiches) {
    const owner = c.owner ? await Users.findOne({ _id: c.owner }, { projection: { businessName: 1, location: 1 } }) : null;
    const nom = (c.name || (owner && owner.businessName) || String(c._id)).slice(0, 30);

    // Quelle location porte l'adresse ? Celle de l'établissement si elle en a
    // une, sinon celle du compte (fiches historiques).
    const locEtab = c.location || {};
    const locCompte = (owner && owner.location) || {};
    const surEtab = !!(locEtab.address || locEtab.city || locEtab.zip);
    const loc = surEtab ? locEtab : locCompte;
    const cible = surEtab ? "établissement" : "compte";

    if (aDesCoords(loc)) {
      dejaOk++;
      console.log(`  =  ${nom.padEnd(32)} déjà géolocalisé (${cible})`);
      continue;
    }

    const adresse = adresseDe(loc);
    if (!adresse) {
      sansAdresse++;
      console.log(`  −  ${nom.padEnd(32)} aucune adresse`);
      continue;
    }

    const res = await geocoderLocation(loc);
    if (!res) {
      echecs++;
      console.log(`  ✗  ${nom.padEnd(32)} introuvable : « ${adresse} »`);
      continue;
    }

    trouves++;
    console.log(`  ✓  ${nom.padEnd(32)} ${res.lat.toFixed(5)}, ${res.lon.toFixed(5)}  (${cible})${res.approximatif ? " — position de la commune, adresse introuvable" : ""}`);

    if (!APPLIQUER) continue;

    const champs = { "location.lat": res.lat, "location.lon": res.lon };
    if (surEtab) await Companies.updateOne({ _id: c._id }, { $set: champs });
    else if (owner) await Users.updateOne({ _id: owner._id }, { $set: champs });
  }

  console.log("");
  console.log(`${fiches.length} fiche(s) · ${dejaOk} déjà OK · ${trouves} géolocalisée(s) · ${echecs} introuvable(s) · ${sansAdresse} sans adresse`);
  if (!APPLIQUER && trouves) console.log("\nRelancez avec --apply pour écrire.");

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
