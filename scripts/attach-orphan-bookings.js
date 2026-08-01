/**
 * Rattachement rétroactif des réservations prises SANS compte.
 *
 * Le tableau de bord client filtre sur `clientRef`. Une réservation faite en
 * invité n'en a pas : la personne créait ensuite un compte avec le même email,
 * se connectait, et ne voyait aucun de ses rendez-vous.
 *
 * Le rattachement se fait desormais automatiquement à l'inscription ET à
 * chaque connexion (mot de passe comme Google). Ce script traite le stock
 * existant, pour que les clients concernés n'aient pas à attendre leur
 * prochaine connexion.
 *
 * Ne réattribue jamais une réservation déjà rattachée à un autre compte.
 *
 *   node scripts/attach-orphan-bookings.js          (simulation)
 *   node scripts/attach-orphan-bookings.js --apply  (écriture)
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const Client = require("../db/models/client.model");
const Booking = require("../db/models/book.model");
const attachOrphanBookings = require("../utils/attachOrphanBookings");

const APPLY = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(env.dbUri);
  console.log(`Base : ${mongoose.connection.name}${APPLY ? "" : "   [SIMULATION — rien n'est écrit]"}\n`);

  const clients = await Client.find({}).select("_id email fullName").lean();
  let total = 0;
  let concernes = 0;

  for (const c of clients) {
    if (!c.email) continue;
    const rx = new RegExp(`^${String(c.email).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const n = await Booking.countDocuments({
      $or: [{ clientRef: null }, { clientRef: { $exists: false } }],
      email: rx,
    });
    if (!n) continue;

    console.log(`  ${(c.fullName || "?").padEnd(24)} ${c.email.padEnd(34)} ${n} RDV`);
    if (APPLY) await attachOrphanBookings(c);
    total += n;
    concernes++;
  }

  console.log(`\n${clients.length} compte(s) client — ${concernes} concerné(s), ${total} rendez-vous à rattacher.`);
  if (!APPLY && total > 0) console.log("Relancez avec --apply pour écrire.");

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
