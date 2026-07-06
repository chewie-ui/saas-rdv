const path = require("path");
const cron = require("node-cron");
const pug = require("pug");

const Booking = require("../db/models/book.model");
const Company = require("../db/models/company/company.model");
const User = require("../db/models/user.model");
const Service = require("../db/models/company/service.model");
const { atLeast } = require("./planLimits");
const { sendEmail } = require("./mailer");
const { sendReminderSmsIfAllowed } = require("./sms");
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
  try {
    const companies = await Company.find({ _id: { $in: companyIds } }).select("_id owner").lean();
    const ownerIds = [...new Set(companies.map((c) => String(c.owner)).filter(Boolean))];
    const owners = await User.find({ _id: { $in: ownerIds } })
      .select("_id isPremium manualPremium subscription calendarSettings location businessName phonePro addons smsUsage")
      .lean();
    const ownerById = Object.fromEntries(owners.map((o) => [String(o._id), o]));
    companies.forEach((c) => { companyOwnerMap[String(c._id)] = ownerById[String(c.owner)] || null; });
  } catch (err) {
    console.error("[reminderScheduler] Erreur pre-fetch owners ❌", err);
  }

  for (const booking of candidates) {
    const appointmentAt = getAppointmentDateTime(booking);
    if (!booking.email) continue;

    // ── Plan gate: reminders only for Pro / Business ──────────────────────
    const owner = companyOwnerMap[String(booking.company)];
    if (!atLeast(owner, "pro")) continue;

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
    const businessName = (owner?.businessName || "").trim();
    const businessPhone = (owner?.phonePro || "").trim();

    // ── Lieu du rendez-vous ──────────────────────────────────────────────
    let locationText = "";
    const loc = owner?.location;
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
        const result = await sendReminderSmsIfAllowed(owner, booking.phone, smsBody);
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

  // Un premier run au démarrage pour rattraper un éventuel retard
  sendDueReminders().catch((err) =>
    console.error("[reminderScheduler] Erreur run initial ❌", err),
  );

  console.log("[reminderScheduler] Démarré (rappels toutes les 15 min, purge gratuits à 03h00)");
}

module.exports = { start, sendDueReminders, purgeFreePlanHistory };
