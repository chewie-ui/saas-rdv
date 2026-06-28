/**
 * Fusionne les comptes Client (séparés) dans le modèle User unifié.
 *
 * Pour chaque Client :
 *   - un User existe avec le même email  → FUSION (le User garde son mot de
 *     passe/Google id ; on ne complète que les champs vides ; Bookings,
 *     Reviews et ClientDossiers repointés vers le User._id ; Client supprimé)
 *   - aucun User avec cet email          → PROMOTION (le Client devient un
 *     nouveau User, company:null, accountIntent:"client")
 *
 * Usage :
 *   node scripts/migrate-merge-client-into-user.js              (dry-run, aucune écriture)
 *   node scripts/migrate-merge-client-into-user.js --commit      (écrit réellement)
 *
 * Le dry-run écrit un rapport complet dans scripts/migration-report.json —
 * à relire avant de lancer --commit, en particulier les collisions Review
 * signalées (jamais résolues automatiquement) et les champs "location"
 * ignorés (forme différente entre User et Client, fusion manuelle requise).
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const User = require("../db/models/user.model");
const Client = require("../db/models/client.model");
const Booking = require("../db/models/book.model");
const Review = require("../db/models/review.model");
const ClientDossier = require("../db/models/clientDossier.model");

const COMMIT = process.argv.includes("--commit");
const REPORT_PATH = path.join(__dirname, "migration-report.json");

// Champs sûrs à copier du Client vers le User s'ils sont vides côté User —
// "location" est volontairement exclu : forme structurée (objet) chez User,
// texte libre chez Client — une fusion automatique produirait des données
// incohérentes, donc toujours laissé pour revue manuelle (cf. rapport).
const MERGEABLE_FIELDS = ["phone", "profilePicture"];

async function countRefs(clientId) {
  const [bookings, reviews, dossiers] = await Promise.all([
    Booking.countDocuments({ clientRef: clientId }),
    Review.countDocuments({ client: clientId }),
    ClientDossier.countDocuments({ clientRef: clientId }),
  ]);
  return { bookings, reviews, dossiers };
}

async function repointRefs(fromId, toId, session) {
  const opts = session ? { session } : {};
  await Booking.updateMany({ clientRef: fromId }, { clientRef: toId }, opts);
  await Review.updateMany({ client: fromId }, { client: toId }, opts);
  await ClientDossier.updateMany({ clientRef: fromId }, { clientRef: toId }, opts);
}

// Un repoint de Review.client vers `toId` peut violer l'index unique
// (company, client) si ce User a déjà un avis pour la même company sous sa
// propre identité — on le détecte avant d'écrire quoi que ce soit.
async function findReviewCollision(clientId, userId) {
  const clientReviews = await Review.find({ client: clientId }).select("company").lean();
  for (const r of clientReviews) {
    const exists = await Review.findOne({ company: r.company, client: userId }).lean();
    if (exists) return String(r.company);
  }
  return null;
}

async function supportsTransactions() {
  try {
    const admin = mongoose.connection.db.admin();
    const info = await admin.command({ hello: 1 });
    return !!(info.setName || info.msg === "isdbgrid");
  } catch (_) {
    return false;
  }
}

async function mergeOne(client, user, useTxn) {
  const fieldsToFill = {};
  MERGEABLE_FIELDS.forEach((f) => {
    if (!user[f] && client[f]) fieldsToFill[f] = client[f];
  });

  const collisionCompany = await findReviewCollision(client._id, user._id);
  if (collisionCompany) {
    return { skipped: true, reason: `Collision Review sur company ${collisionCompany} — à traiter manuellement.` };
  }

  if (!COMMIT) return { skipped: false, fieldsToFill };

  if (useTxn) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (Object.keys(fieldsToFill).length) {
          await User.findByIdAndUpdate(user._id, fieldsToFill, { session });
        }
        await repointRefs(client._id, user._id, session);
        await Client.findByIdAndDelete(client._id, { session });
      });
    } finally {
      await session.endSession();
    }
  } else {
    // Pas de replica set → écritures séquentielles (pas de vrai rollback
    // multi-documents possible ; le script est idempotent si on doit le
    // relancer après une coupure : un Client déjà supprimé est juste ignoré).
    if (Object.keys(fieldsToFill).length) {
      await User.findByIdAndUpdate(user._id, fieldsToFill);
    }
    await repointRefs(client._id, user._id, null);
    await Client.findByIdAndDelete(client._id);
  }
  return { skipped: false, fieldsToFill };
}

async function promoteOne(client) {
  if (!COMMIT) return;
  const newUser = await User.create({
    fullName: client.fullName,
    email: client.email,
    password: client.password,
    googleId: client.googleId || null,
    phone: client.phone || "",
    profilePicture: client.profilePicture || undefined,
    preferredLang: client.preferredLang || "fr",
    accountIntent: "client",
  });
  await repointRefs(client._id, newUser._id, null);
  await Client.findByIdAndDelete(client._id);
}

async function run() {
  await mongoose.connect(env.dbUri);
  const useTxn = await supportsTransactions();
  console.log(`Mode : ${COMMIT ? "COMMIT (écriture réelle)" : "DRY-RUN (aucune écriture)"} — transactions ${useTxn ? "disponibles" : "indisponibles (standalone)"}\n`);

  const clients = await Client.find({}).lean();
  console.log(`Comptes Client trouvés : ${clients.length}`);

  const report = { merge: [], promote: [], errors: [] };

  for (const client of clients) {
    // Idempotence : si une exécution précédente a déjà traité ce Client
    // (ex: relance après coupure), il n'existe plus — on l'ignore.
    const stillExists = await Client.findById(client._id).lean();
    if (!stillExists) continue;

    const user = await User.findOne({ email: client.email });
    const refs = await countRefs(client._id);

    if (user) {
      try {
        const result = await mergeOne(client, user, useTxn);
        report.merge.push({
          email: client.email,
          userId: String(user._id),
          clientId: String(client._id),
          ...refs,
          fieldsToFill: result.fieldsToFill || {},
          locationIgnored: !!client.location,
          skipped: result.skipped,
          skipReason: result.reason || null,
        });
      } catch (err) {
        report.errors.push({ email: client.email, type: "merge", error: err.message });
      }
    } else {
      report.promote.push({ email: client.email, clientId: String(client._id), ...refs });
      try {
        await promoteOne(client);
      } catch (err) {
        report.errors.push({ email: client.email, type: "promote", error: err.message });
      }
    }
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log("\n── Résumé ──────────────────────────────────────────");
  console.log("Fusions (User existant)      :", report.merge.length);
  console.log("  dont sautées (collision)   :", report.merge.filter((m) => m.skipped).length);
  console.log("Promotions (nouveau User)     :", report.promote.length);
  console.log("Erreurs                       :", report.errors.length);
  console.log("Rapport complet               :", REPORT_PATH);

  if (COMMIT) {
    const remaining = await Client.countDocuments({});
    console.log("\nClients restants après migration (attendu : nb de collisions sautées + erreurs) :", remaining);
  } else {
    console.log("\nAucune écriture effectuée (dry-run). Relire le rapport, puis relancer avec --commit.");
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("Erreur fatale :", err);
  process.exit(1);
});
