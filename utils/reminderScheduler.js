const path = require("path");
const cron = require("node-cron");
const pug = require("pug");

const Booking = require("../db/models/book.model");
const Company = require("../db/models/company/company.model");
const User = require("../db/models/user.model");
const Service = require("../db/models/company/service.model");
const { atLeast, billingUserFor } = require("./planLimits");
const { identityFor } = require("./establishmentIdentity");
const { sendEmail } = require("./mailer");
const { sendReminderSmsIfAllowed } = require("./sms");
const { sendWhatsappIfAllowed, isWhatsappConfigured, WA_TPL_REMINDER } = require("./whatsapp");
const { isFeatureEnabled } = require("../middlewares/featureFlag");

/**
 * Combine le champ `date` (Date, souvent à minuit) avec le champ
 * `startTime` ("HH:MM") pour obtenir le vrai datetime du rendez-vous.
 */
function getAppointmentDateTime(booking) {
  const [hours, minutes] = (booking.startTime || "00:00")
    .split(":")
    .map((n) => parseInt(n, 10));

  const dt = new Date(booking.date);
  dt.setHours(hours || 0, minutes || 0, 0, 0);
  return dt;
}

/**
 * Cherche tous les rdv confirmés dont l'heure exacte tombe dans les
 * ~24h à venir et dont le rappel n'a pas encore été envoyé, puis
 * envoie un email de rappel à chaque client.
 */
async function sendDueReminders() {
  const now = new Date();

  // Fenêtre large pour couvrir tous les délais possibles (6h → 72h)
  const windowStart = new Date(now.getTime() - 6  * 60 * 60 * 1000);
  const windowEnd   = new Date(now.getTime() + 80 * 60 * 60 * 1000);

  let candidates;
  try {
    candidates = await Booking.find({
      status: "confirmed",
      reminderSent: { $ne: true },
      date: { $gte: windowStart, $lte: windowEnd },
    });
  } catch (err) {
    console.error("[reminderScheduler] Erreur lecture DB ❌", err);
    return;
  }

  const templatePath = path.join(
    __dirname,
    "../views/templates/emails/booking-reminder.pug",
  );

  // Pre-fetch company owners in batch (avoid N+1 queries)
  const companyIds = [...new Set(candidates.map((b) => String(b.company)).filter(Boolean))];
  const companyOwnerMap = {};
  // Le forfait ET le nom affiché appartiennent à l'ÉTABLISSEMENT : on garde le
  // document Company sous la main (plan/planStatus/name), pas seulement l'owner.
  const companyById = {};
  try {
    // `location` / `phonePro` de la Company : le lieu du RDV appartient à
    // l'ÉTABLISSEMENT (cf. utils/establishmentIdentity.js). Sans eux dans le
    // select, identityFor ne verrait qu'un objet vide et le rappel partirait
    // sans adresse — silencieusement.
    const companies = await Company.find({ _id: { $in: companyIds } })
      .select("_id owner name plan planStatus location phonePro")
      .lean();
    const ownerIds = [...new Set(companies.map((c) => String(c.owner)).filter(Boolean))];
    // `company` : c'est lui qui désigne l'établissement d'origine, donc celui
    // qui a droit au repli sur les valeurs du compte.
    const owners = await User.find({ _id: { $in: ownerIds } })
      .select("_id company isPremium manualPremium subscription calendarSettings location phone businessName phonePro addons smsUsage")
      .lean();
    const ownerById = Object.fromEntries(owners.map((o) => [String(o._id), o]));
    companies.forEach((c) => {
      companyOwnerMap[String(c._id)] = ownerById[String(c.owner)] || null;
      companyById[String(c._id)] = c;
    });
  } catch (err) {
    console.error("[reminderScheduler] Erreur pre-fetch owners ❌", err);
  }

  for (const booking of candidates) {
    const appointmentAt = getAppointmentDateTime(booking);
    if (!booking.email) continue;

    // ── Plan gate: reminders only for Pro / Business ──────────────────────
    // Le forfait est celui de l'ÉTABLISSEMENT (repli sur le compte owner tant
    // que company.plan n'est pas renseigné — cf. getCompanyPlan).
    const owner = companyOwnerMap[String(booking.company)];
    const companyDoc = companyById[String(booking.company)];
    const billing = billingUserFor(companyDoc, owner);
    const billingPlan = billing.subscription.plan;
    if (!atLeast(billing, "pro")) continue;

    // ── Délai personnalisé (défaut 24h) ───────────────────────────────────
    const delayHours = owner?.calendarSettings?.reminderDelayHours || 24;
    const sendFrom   = new Date(appointmentAt.getTime() - delayHours * 60 * 60 * 1000);
    const sendUntil  = new Date(sendFrom.getTime() + 15 * 60 * 1000); // fenêtre de 15 min

    // N'envoyer que si l'heure actuelle est dans la fenêtre d'envoi
    if (now < sendFrom || now > sendUntil) continue;
    if (appointmentAt <= now) continue;
    // ─────────────────────────────────────────────────────────────────────

    // ── Message personnalisé du professionnel ─────────────────────────────
    const ownerMessage = (owner?.calendarSettings?.reminderMessage || "").trim();

    // ── Modes de paiement acceptés (configurés dans Personnaliser) ─────────
    const paymentMethods = Array.isArray(owner?.calendarSettings?.reminderPaymentMethods)
      ? owner.calendarSettings.reminderPaymentMethods
      : [];
    const paymentNote = (owner?.calendarSettings?.reminderPaymentNote || "").trim();

    // ── Catégorie du service (lookup, non snapshotté sur la réservation) ───
    let serviceCategory = "";
    if (booking.service) {
      try {
        const svc = await Service.findById(booking.service).select("category").lean();
        serviceCategory = svc?.category || "";
      } catch (_) {}
    }

    // ── Prix (snapshotté dans payment.amount à la création) ────────────────
    const servicePrice = (booking.payment && booking.payment.amount) ? Number(booking.payment.amount) : null;

    // ── Infos établissement ──────────────────────────────────────────────
    // Nom de L'ÉTABLISSEMENT d'abord (repli compte pour les fiches
    // historiques). Alimente WhatsApp {{2}}, le corps du SMS et l'email : un
    // patron multi-établissements envoyait sinon partout le même nom.
    // Les sauts de ligne sont écrasés : Meta rejette un paramètre multi-ligne.
    const businessName = (companyDoc?.name || owner?.businessName || "")
      .replace(/\s+/g, " ")
      .trim();
    // Téléphone et adresse appartiennent à l'ÉTABLISSEMENT : lus sur le compte,
    // le rappel d'un RDV pris dans le second établissement envoyait le client à
    // l'adresse du premier.
    const identity = identityFor(companyDoc, owner);
    const businessPhone = (identity.phonePro || "").trim();

    // ── Lieu du rendez-vous ──────────────────────────────────────────────
    let locationText = "";
    const loc = identity.location;
    if (loc?.serviceType === "en_ligne") {
      locationText = "En ligne";
    } else if (loc?.address || loc?.city) {
      locationText = [loc.address, loc.city].filter(Boolean).join(", ");
    }

    // ── Sujet dynamique selon le délai ────────────────────────────────────
    const delayLabel = delayHours <= 6  ? "dans 6 heures"
                     : delayHours <= 12 ? "dans 12 heures"
                     : delayHours <= 24 ? "demain"
                     : delayHours <= 48 ? "dans 2 jours"
                     : "dans 3 jours";
    const subject = `Rappel : votre rendez-vous ${delayLabel}`;

    const formattedDate = new Date(booking.date).toLocaleDateString("fr-FR", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    });

    // ── Rappel WhatsApp (canal prioritaire : moins cher que le SMS) ─────────
    // Si activé par le pro ET WhatsApp configuré côté serveur, on tente WhatsApp
    // en premier. Même pot de crédits que le SMS. En cas d'échec (quota épuisé,
    // solde vide, erreur Meta) → repli SMS ci-dessous, puis email. Jamais
    // bloquant : une erreur ici n'empêche pas les canaux suivants.
    if (
      booking.phone &&
      owner?.calendarSettings?.whatsappRemindersEnabled &&
      isWhatsappConfigured()
    ) {
      try {
        const clientFirstName = (booking.name || "").trim() || (booking.surname || "").trim() || "";
        const result = await sendWhatsappIfAllowed(owner, booking.phone, {
          plan: billingPlan, // quota inclus = propriété du forfait de l'établissement
          template: WA_TPL_REMINDER,
          // Ordre des variables {{1..4}} du template « rdv_rappel » (cf. WHATSAPP_SETUP.md)
          params: [
            clientFirstName,
            businessName || "votre établissement",
            formattedDate,
            booking.startTime || "",
          ],
        });
        if (result.sent) {
          booking.reminderSent = true;
          await booking.save();
          console.log(`[reminderScheduler] Rappel WhatsApp (${result.mode}) envoyé à ${booking.phone}`);
          continue; // WhatsApp envoyé — pas de SMS ni d'email
        }
        // result.sent === false → on continue vers le SMS ci-dessous
      } catch (waErr) {
        console.error(`[reminderScheduler] Erreur WhatsApp ${booking._id} ❌`, waErr);
      }
    }

    // ── Rappel SMS (si activé par le pro) — repli automatique sur l'email
    // ci-dessous si le quota mensuel est dépassé et qu'aucun crédit n'est
    // disponible. Jamais bloquant : une erreur ici n'empêche pas l'email.
    if (
      booking.phone &&
      owner?.calendarSettings?.smsRemindersEnabled &&
      (await isFeatureEnabled("sms_notifications"))
    ) {
      try {
        const smsBody = `Rappel : votre rendez-vous ${businessName ? `avec ${businessName} ` : ""}est ${delayLabel} (${formattedDate} à ${booking.startTime}).`;
        const result = await sendReminderSmsIfAllowed(owner, booking.phone, smsBody, { plan: billingPlan });
        if (result.sent) {
          booking.reminderSent = true;
          await booking.save();
          console.log(`[reminderScheduler] Rappel SMS (${result.mode}) envoyé à ${booking.phone}`);
          continue; // SMS envoyé avec succès — pas besoin de l'email aussi
        }
        // result.sent === false → on continue vers l'envoi email ci-dessous
      } catch (smsErr) {
        console.error(`[reminderScheduler] Erreur SMS ${booking._id} ❌`, smsErr);
      }
    }

    try {
      const html = pug.renderFile(templatePath, {
        name: booking.name || "",
        surname: booking.surname || "",
        date: booking.date,
        formattedDate,
        startHour: booking.startTime,
        endHour: booking.endTime,
        slotTime: booking.slotTime,
        serviceName: booking.serviceName || "",
        serviceCategory,
        servicePrice,
        employeeName: booking.employeeName || "",
        locationText,
        formAnswers: (Array.isArray(booking.formAnswers) ? booking.formAnswers : []).filter(
          (a) => a.required || (a.answer !== undefined && a.answer !== null && String(a.answer).trim() !== "")
        ),
        message: booking.message || "",
        ownerMessage,
        paymentMethods,
        paymentNote,
        delayLabel,
        businessName,
        businessPhone,
        bookingId: booking._id,
        cancelToken: booking.cancelToken,
        baseUrl: (process.env.BASE_URL || "https://www.branshee.com").replace(/\/$/, ""),
      });

      const ok = await sendEmail(booking.email, subject, html);

      if (ok) {
        booking.reminderSent = true;
        await booking.save();
        console.log(
          `[reminderScheduler] Rappel (${delayHours}h avant) envoyé à ${booking.email} — ${booking.date} ${booking.startTime}`,
        );
      }
    } catch (err) {
      console.error(
        `[reminderScheduler] Erreur envoi rappel ${booking._id} ❌`,
        err,
      );
    }
  }
}

/**
 * Supprime les réservations de plus de 7 jours pour les utilisateurs gratuits (basic).
 * S'exécute une fois par jour à 03h00.
 */
async function purgeFreePlanHistory() {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  try {
    const allCompanies = await Company.find({}).select("_id owner").lean();
    const ownerIds = [...new Set(allCompanies.map((c) => String(c.owner)).filter(Boolean))];

    const freeOwners = await User.find({
      _id: { $in: ownerIds },
      isPremium: { $ne: true },
      manualPremium: { $ne: true },
      "subscription.status": { $ne: "active" },
    }).select("_id").lean();

    const freeOwnerSet = new Set(freeOwners.map((u) => String(u._id)));
    const freeCompanyIds = allCompanies
      .filter((c) => freeOwnerSet.has(String(c.owner)))
      .map((c) => c._id);

    if (freeCompanyIds.length === 0) return;

    const result = await Booking.deleteMany({
      company: { $in: freeCompanyIds },
      date: { $lt: cutoff },
    });

    if (result.deletedCount > 0) {
      console.log(`[purgeFreePlanHistory] Supprimé ${result.deletedCount} réservation(s) > 7j (comptes gratuits)`);
    }
  } catch (err) {
    console.error("[purgeFreePlanHistory] Erreur ❌", err);
  }
}

/**
 * Relances d'onboarding (J+1 puis J+3) pour les pros qui se sont inscrits mais
 * n'ont pas fini de configurer leur page. Deux paliers max, tracés par
 * `user.onboarding.nudgeStage` (0 → aucune, 1 → J+1 envoyée, 2 → J+3 envoyée),
 * ce qui garantit qu'aucun compte ne reçoit plus de 2 emails de relance.
 *
 * Garde-fous : on ne relance que les comptes créés il y a 1 à 30 jours (au-delà
 * = froid, ne pas spammer), non désactivés, qui n'ont pas fermé la checklist
 * (`onboarding.dismissed`), et qui possèdent réellement un établissement (pro).
 * Si l'onboarding est déjà complet, on fige nudgeStage à 2 sans envoyer d'email.
 */
async function sendOnboardingNudges() {
  const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
  const { getOnboardingStatus } = require("./onboardingStatus");
  const now = Date.now();
  const H = 60 * 60 * 1000;
  const notOlderThan = new Date(now - 30 * 24 * H); // créé après cette date
  const atLeastOneDay = new Date(now - 24 * H);     // créé avant cette date (≥ 24h)

  let users;
  try {
    users = await User.find({
      createdAt: { $gte: notOlderThan, $lte: atLeastOneDay },
      "onboarding.dismissed": { $ne: true },
      // Même piège que ci-dessus : `$lt: 2` seul écarte les comptes dont
      // `onboarding.nudgeStage` n'existe pas (docs antérieurs au champ), qui
      // n'ont donc jamais reçu la moindre relance. `$not/$gte` les inclut.
      "onboarding.nudgeStage": { $not: { $gte: 2 } },
      isDisabled: { $ne: true },
      email: { $exists: true, $ne: "" },
    })
      .select("_id fullName email businessPicture onboarding createdAt")
      .lean();
  } catch (err) {
    console.error("[onboardingNudge] Erreur lecture DB ❌", err);
    return;
  }

  const templatePath = path.join(
    __dirname,
    "../views/templates/emails/onboarding-nudge.pug",
  );

  for (const user of users) {
    try {
      // Doit être un pro (établissement créé) — sinon c'est un compte client,
      // pas concerné par la mise en route d'une page de réservation.
      const company = await Company.findOne({ owner: user._id })
        .select("_id slug")
        .lean();
      if (!company) continue;

      const ageH = (now - new Date(user.createdAt).getTime()) / H;
      const stage = (user.onboarding && user.onboarding.nudgeStage) || 0;

      // Palier suivant : 0 → J+1 (≥24h) ; 1 → J+3 (≥72h)
      let targetStage = null;
      if (stage === 0 && ageH >= 24) targetStage = 1;
      else if (stage === 1 && ageH >= 72) targetStage = 2;
      if (!targetStage) continue;

      const status = await getOnboardingStatus(user, company);
      if (!status) continue;

      if (status.complete) {
        // Rien à relancer : on fige le palier au max pour ne plus réévaluer.
        await User.updateOne({ _id: user._id }, { $set: { "onboarding.nudgeStage": 2 } });
        continue;
      }

      const missingSteps = status.steps
        .filter((s) => !s.done)
        .map((s) => ({ title: s.title, desc: s.desc }));

      const firstName = (user.fullName || "").trim().split(" ")[0] || "";
      const html = pug.renderFile(templatePath, {
        firstName,
        missingSteps,
        stage: targetStage,
        dashboardUrl: `${env.appBaseUrl}/panel`,
      });

      const subject = missingSteps.length === 1
        ? "Il ne reste qu'une étape pour lancer votre agenda BranShee"
        : "Votre agenda BranShee est presque prêt 🚀";

      const ok = await sendEmail(user.email, subject, html);
      if (ok) {
        await User.updateOne({ _id: user._id }, { $set: { "onboarding.nudgeStage": targetStage } });
        console.log(`[onboardingNudge] Relance palier ${targetStage} → ${user.email} (${missingSteps.length} étape(s) restante(s))`);
      }
    } catch (err) {
      console.error(`[onboardingNudge] Erreur relance ${user && user.email} ❌`, err);
    }
  }
}

/**
 * Email « créez votre établissement » — UNE seule fois — aux comptes inscrits
 * avec l'intention « pro » ou « indécis » qui n'ont JAMAIS créé d'établissement.
 * On épargne les comptes « client » (venus juste réserver). Garde anti-doublon :
 * `user.onboarding.createEstabNudged`. Fenêtre : inscrits il y a 1 à 30 jours.
 */
async function sendCreateEstablishmentNudges() {
  const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
  const now = Date.now();
  const H = 60 * 60 * 1000;
  const notOlderThan = new Date(now - 30 * 24 * H);
  const atLeastOneDay = new Date(now - 24 * H);

  let candidates;
  try {
    candidates = await User.find({
      // `$nin` et non `$in: ["pro","undecided"]` : en Mongo, `$in` ne matche
      // JAMAIS un document où le champ est absent. Les comptes créés avant
      // l'ajout de `accountIntent` (le défaut du schéma ne s'applique qu'à la
      // création) étaient donc exclus à vie de cette relance. « Tout sauf un
      // client déclaré » couvre pro + undecided + champ absent.
      accountIntent: { $nin: ["client"] },
      createdAt: { $gte: notOlderThan, $lte: atLeastOneDay },
      "onboarding.createEstabNudged": { $ne: true },
      isDisabled: { $ne: true },
      email: { $exists: true, $ne: "" },
    })
      .select("_id fullName email")
      .lean();
  } catch (err) {
    console.error("[createEstabNudge] Erreur lecture DB ❌", err);
    return;
  }
  if (!candidates.length) return;

  // Exclure ceux qui possèdent DÉJÀ un établissement.
  let ownersWithCompany = new Set();
  try {
    const ids = candidates.map((u) => u._id);
    const owners = await Company.find({ owner: { $in: ids }, isDeleted: { $ne: true } }).distinct("owner");
    ownersWithCompany = new Set(owners.map((o) => String(o)));
  } catch (err) {
    console.error("[createEstabNudge] Erreur pré-fetch companies ❌", err);
    return;
  }

  const templatePath = path.join(
    __dirname,
    "../views/templates/emails/create-establishment-nudge.pug",
  );

  for (const user of candidates) {
    if (ownersWithCompany.has(String(user._id))) continue; // a déjà un établissement
    try {
      const firstName = (user.fullName || "").trim().split(" ")[0] || "";
      const html = pug.renderFile(templatePath, {
        firstName,
        ctaUrl: `${env.appBaseUrl}/demarrer`,
      });
      const ok = await sendEmail(
        user.email,
        "Créez votre page de réservation BranShee en 1 minute 🚀",
        html,
      );
      if (ok) {
        await User.updateOne(
          { _id: user._id },
          { $set: { "onboarding.createEstabNudged": true } },
        );
        console.log(`[createEstabNudge] Email « créez votre établissement » → ${user.email}`);
      }
    } catch (err) {
      console.error(`[createEstabNudge] Erreur envoi ${user && user.email} ❌`, err);
    }
  }
}

/**
 * Relances avant l'expiration d'un octroi manuel (accès payant offert par le
 * superadmin) : une à J-7, une à J-1.
 *
 * Sans elles, un pro qui travaille tous les jours sur BranShee bascule en
 * formule gratuite du jour au lendemain — plafonné à 20 réservations par mois,
 * sans rappels — et le découvre en constatant que ça ne marche plus. C'est la
 * pire manière de demander à quelqu'un de payer.
 *
 * Anti-doublon : `grantReminder.sentFor` mémorise l'échéance déjà
 * couverte. Si le superadmin prolonge l'octroi, la date change et les relances
 * repartent automatiquement pour la nouvelle échéance.
 */
async function sendGrantExpiryReminders() {
  const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
  const J = 24 * 60 * 60 * 1000;
  const maintenant = Date.now();

  let comptes;
  try {
    comptes = await User.find({
      manualPremium: true,
      manualPremiumExpiry: { $ne: null, $gt: new Date(maintenant), $lte: new Date(maintenant + 8 * J) },
      isDisabled: { $ne: true },
      email: { $exists: true, $ne: "" },
    })
      .select("_id fullName email manualPremiumExpiry grantReminder")
      .lean();
  } catch (err) {
    console.error("[grantExpiry] Erreur lecture DB ❌", err);
    return;
  }
  if (!comptes.length) return;

  const templatePath = path.join(__dirname, "../views/templates/emails/grant-expiry-reminder.pug");

  for (const user of comptes) {
    try {
      const expiry = new Date(user.manualPremiumExpiry);
      const joursRestants = Math.ceil((expiry.getTime() - maintenant) / J);

      // Étape visée : 1 = relance J-7 · 2 = relance J-1. Entre les deux, rien.
      const etapeVoulue = joursRestants <= 1 ? 2 : joursRestants <= 7 ? 1 : 0;
      if (etapeVoulue === 0) continue;

      const suivi = user.grantReminder || {};
      // Une échéance différente de celle déjà couverte = octroi prolongé ou
      // remplacé : on repart de zéro pour cette nouvelle date.
      const memeEcheance =
        suivi.sentFor && new Date(suivi.sentFor).getTime() === expiry.getTime();
      const etapeFaite = memeEcheance ? suivi.stage || 0 : 0;
      if (etapeFaite >= etapeVoulue) continue;

      // Établissement concerné + volume réel du mois écoulé : c'est ce qui rend
      // l'email utile plutôt que générique (« vous avez eu 22 RDV le mois
      // dernier, le gratuit s'arrête à 20 »).
      const estab = await Company.findOne({ owner: user._id, isDeleted: { $ne: true } })
        .sort({ createdAt: 1 })
        .select("name")
        .lean();
      let rdv30j = null;
      if (estab) {
        rdv30j = await Booking.countDocuments({
          company: estab._id,
          createdAt: { $gte: new Date(maintenant - 30 * J) },
        });
      }

      const html = pug.renderFile(templatePath, {
        firstName: (user.fullName || "").trim().split(" ")[0] || "",
        estabName: estab ? estab.name : "",
        daysLeft: joursRestants,
        expiryLabel: expiry.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }),
        monthlyBookings: rdv30j,
        ctaUrl: `${env.appBaseUrl}/subscription`,
      });

      const objet =
        etapeVoulue === 2
          ? "Votre accès complet BranShee se termine demain"
          : `Votre accès complet BranShee se termine dans ${joursRestants} jours`;

      const ok = await sendEmail(user.email, objet, html);
      if (ok) {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              "grantReminder.sentFor": expiry,
              "grantReminder.stage": etapeVoulue,
            },
          },
        );
        console.log(
          `[grantExpiry] Relance J-${etapeVoulue === 2 ? 1 : 7} → ${user.email} (échéance ${expiry.toISOString().slice(0, 10)})`,
        );
      }
    } catch (err) {
      console.error(`[grantExpiry] Erreur envoi ${user && user.email} ❌`, err);
    }
  }
}

/**
 * Démarre le cron : on tourne toutes les 15 minutes. Le flag
 * `reminderSent` empêche tout doublon si le serveur redémarre.
 */
function start() {
  // Toutes les 15 minutes : rappels
  cron.schedule("*/15 * * * *", () => {
    sendDueReminders().catch((err) =>
      console.error("[reminderScheduler] Erreur tâche ❌", err),
    );
  });

  // Chaque nuit à 03h00 : nettoyage historique comptes gratuits
  cron.schedule("0 3 * * *", () => {
    purgeFreePlanHistory().catch((err) =>
      console.error("[purgeFreePlanHistory] Erreur tâche ❌", err),
    );
  });

  // Chaque jour à 10h00 : relances d'onboarding (J+1 / J+3)
  cron.schedule("0 10 * * *", () => {
    sendOnboardingNudges().catch((err) =>
      console.error("[onboardingNudge] Erreur tâche ❌", err),
    );
  });

  // Chaque jour à 10h30 : email « créez votre établissement » (comptes
  // pro/indécis sans établissement) — un seul envoi par compte.
  cron.schedule("30 10 * * *", () => {
    sendCreateEstablishmentNudges().catch((err) =>
      console.error("[createEstabNudge] Erreur tâche ❌", err),
    );
  });

  // Chaque jour à 09h00 : relances avant expiration d'un octroi (J-7 et J-1).
  // Tôt dans la journée, pour laisser au pro le temps de réagir le jour même.
  cron.schedule("0 9 * * *", () => {
    sendGrantExpiryReminders().catch((err) =>
      console.error("[grantExpiry] Erreur tâche ❌", err),
    );
  });

  // Un premier run au démarrage pour rattraper un éventuel retard
  sendDueReminders().catch((err) =>
    console.error("[reminderScheduler] Erreur run initial ❌", err),
  );

  console.log("[reminderScheduler] Démarré (rappels toutes les 15 min, purge gratuits à 03h00)");
}

module.exports = {
  start,
  sendDueReminders,
  purgeFreePlanHistory,
  sendOnboardingNudges,
  sendCreateEstablishmentNudges,
  sendGrantExpiryReminders,
};
