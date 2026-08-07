/**
 * Met en pause les établissements jamais configurés, et prévient leur
 * propriétaire.
 *
 * Une fiche encore nommée « Établissement », sans ville, sans photo, sans
 * description et sans prestation n'a jamais été touchée. Elle polluait la
 * recherche et envoyait le visiteur sur une page vide. La recherche les masque
 * déjà (cf. routes/index.js), mais tant qu'elles restent « actives » le
 * propriétaire ne sait pas qu'il n'a rien fini.
 *
 * DEUX GARDE-FOUS, parce qu'on touche à de vrais comptes :
 *   1. Un délai d'inactivité (30 jours par défaut) : quelqu'un qui s'est
 *      inscrit hier et configure ce soir ne doit pas être mis en pause.
 *   2. Aucun établissement ayant le moindre rendez-vous n'est touché, même
 *      vide par ailleurs — s'il a des clients, il est vivant.
 *
 * La mise en pause est RÉVERSIBLE en un clic : un bandeau apparaît dans
 * l'admin du pro avec un bouton « Réactiver » (views/layouts/admin.pug).
 *
 *   node scripts/pause-fiches-vides.js                 (simulation)
 *   node scripts/pause-fiches-vides.js --jours=60      (autre seuil)
 *   node scripts/pause-fiches-vides.js --apply         (met en pause)
 *   node scripts/pause-fiches-vides.js --apply --email (… et prévient par email)
 *
 * L'envoi d'email est volontairement séparé de --apply : on peut mettre en
 * pause d'abord, regarder le résultat, et n'écrire aux gens qu'ensuite.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const path = require("path");
const pug = require("pug");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const Company = require("../db/models/company/company.model");
const Service = require("../db/models/company/service.model");
const Booking = require("../db/models/book.model");
const User = require("../db/models/user.model");
const { sendEmail } = require("../utils/mailer");

const APPLIQUER = process.argv.includes("--apply");
const ENVOYER_EMAIL = process.argv.includes("--email");
const argJours = process.argv.find((a) => a.startsWith("--jours="));
const JOURS_INACTIVITE = argJours ? parseInt(argJours.split("=")[1], 10) : 30;

// Même règle que le filtre de recherche (routes/index.js) : le nom est le seul
// critère qui prouve que le pro a touché sa fiche. Un horaire par défaut est
// créé à l'inscription, il ne prouve rien.
const NOM_PAR_DEFAUT = /^\s*(établissement|etablissement)\s*$/i;

function nomNonConfigure(nom) {
  return !nom || !String(nom).trim() || NOM_PAR_DEFAUT.test(String(nom));
}

(async () => {
  await mongoose.connect(env.dbUri);
  console.log("Base :", mongoose.connection.name, APPLIQUER ? "" : "  [SIMULATION — rien n'est écrit]");
  console.log(`Seuil d'inactivité : ${JOURS_INACTIVITE} jours`);
  console.log("");

  const limite = new Date(Date.now() - JOURS_INACTIVITE * 24 * 3600 * 1000);

  const companies = await Company.find({ isPaused: { $ne: true }, isDeleted: { $ne: true } })
    .select("name slug owner location photo description createdAt")
    .populate("owner", "email fullName lastLoginAt createdAt")
    .lean();

  const aPauser = [];
  const gardes = [];

  for (const c of companies) {
    if (!nomNonConfigure(c.name)) continue;
    if (c.location?.city || c.photo || c.description) continue;

    const nbServices = await Service.countDocuments({ company: c._id });
    if (nbServices > 0) continue;

    // Un établissement qui a des rendez-vous est vivant, quoi qu'en dise sa fiche.
    const nbRdv = await Booking.countDocuments({ company: c._id, isBlock: { $ne: true } });
    if (nbRdv > 0) {
      gardes.push({ nom: c.name, raison: `${nbRdv} rendez-vous` });
      continue;
    }

    // Récence : dernière connexion, à défaut la création du compte.
    const derniere = c.owner?.lastLoginAt || c.owner?.createdAt || c.createdAt;
    if (derniere && new Date(derniere) > limite) {
      gardes.push({ nom: c.name, raison: `actif le ${new Date(derniere).toISOString().slice(0, 10)}` });
      continue;
    }

    aPauser.push({ company: c, derniere });
  }

  console.log(`Établissements actifs examinés : ${companies.length}`);
  console.log(`À mettre en pause              : ${aPauser.length}`);
  console.log(`Épargnés malgré une fiche vide : ${gardes.length}`);
  if (gardes.length) {
    gardes.slice(0, 10).forEach((g) => console.log(`   · ${g.nom || "(sans nom)"} — ${g.raison}`));
    if (gardes.length > 10) console.log(`   … et ${gardes.length - 10} autre(s)`);
  }
  console.log("");

  aPauser.forEach(({ company: c, derniere }) => {
    const quand = derniere ? new Date(derniere).toISOString().slice(0, 10) : "jamais";
    console.log(`   → ${c.owner?.email || "(sans email)"}  ·  dernière activité : ${quand}`);
  });

  if (!APPLIQUER) {
    console.log("");
    console.log("Relancer avec --apply pour mettre en pause.");
    console.log("Ajouter --email pour prévenir les propriétaires par email.");
    await mongoose.disconnect();
    return;
  }

  let pauses = 0;
  let emails = 0;
  for (const { company: c } of aPauser) {
    await Company.findByIdAndUpdate(c._id, { isPaused: true });
    pauses++;

    if (!ENVOYER_EMAIL || !c.owner?.email) continue;
    try {
      const html = pug.renderFile(
        path.join(__dirname, "../views/templates/emails/etablissement-en-pause.pug"),
        {
          prenom: (c.owner.fullName || "").split(" ")[0] || "",
          lien: "https://www.branshee.com/dashboard",
        },
      );
      await sendEmail(c.owner.email, "Votre page BranShee est en pause", html);
      emails++;
    } catch (e) {
      console.error(`   email vers ${c.owner.email} : ${e.message}`);
    }
  }

  console.log("");
  console.log(`Mis en pause : ${pauses}`);
  console.log(ENVOYER_EMAIL ? `Emails envoyés : ${emails}` : "Aucun email envoyé (ajouter --email).");
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
