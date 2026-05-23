const path = require("path");
const cron = require("node-cron");
const pug = require("pug");

const Booking = require("../db/models/book.model");
const Company = require("../db/models/company/company.model");
const User = require("../db/models/user.model");
const { atLeast } = require("./planLimits");
const { sendEmail } = require("./mailer");

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
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Pré-filtre MongoDB (on élargit d'1 jour pour être safe avec les
  // fuseaux horaires et la comparaison basée sur date + startTime).
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);

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
    const owners = await User.find({ _id: { $in: ownerIds } }).select("_id isPremium manualPremium subscription").lean();
    const ownerById = Object.fromEntries(owners.map((o) => [String(o._id), o]));
    companies.forEach((c) => { companyOwnerMap[String(c._id)] = ownerById[String(c.owner)] || null; });
  } catch (err) {
    console.error("[reminderScheduler] Erreur pre-fetch owners ❌", err);
  }

  for (const booking of candidates) {
    const appointmentAt = getAppointmentDateTime(booking);

    // On envoie uniquement si le rdv est dans le futur ET dans les 24h.
    if (appointmentAt <= now || appointmentAt > in24h) continue;
    if (!booking.email) continue;

    // ── Plan gate: reminders only for Pro / Business ──────────────────────
    const owner = companyOwnerMap[String(booking.company)];
    if (!atLeast(owner, "pro")) {
      // Free plan owners don't get automated reminders
      continue;
    }
    // ─────────────────────────────────────────────────────────────────────

    try {
      const html = pug.renderFile(templatePath, {
        name: booking.name || "",
        surname: booking.surname || "",
        date: booking.date,
        startHour: booking.startTime,
        endHour: booking.endTime,
        slotTime: booking.slotTime,
        serviceName: booking.serviceName || "",
        message: booking.message || "",
        bookingId: booking._id,
        cancelToken: booking.cancelToken,
        baseUrl: (process.env.BASE_URL || "https://www.branshee.com").replace(/\/$/, ""),
      });

      const ok = await sendEmail(
        booking.email,
        "Rappel : votre rendez-vous est demain",
        html,
      );

      if (ok) {
        booking.reminderSent = true;
        await booking.save();
        console.log(
          `[reminderScheduler] Rappel envoyé à ${booking.email} pour le ${booking.date} ${booking.startTime}`,
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
 * Démarre le cron : on tourne toutes les 15 minutes. Le flag
 * `reminderSent` empêche tout doublon si le serveur redémarre.
 */
function start() {
  // Toutes les 15 minutes
  cron.schedule("*/15 * * * *", () => {
    sendDueReminders().catch((err) =>
      console.error("[reminderScheduler] Erreur tâche ❌", err),
    );
  });

  // Un premier run au démarrage pour rattraper un éventuel retard
  sendDueReminders().catch((err) =>
    console.error("[reminderScheduler] Erreur run initial ❌", err),
  );

  console.log("[reminderScheduler] Démarré (check toutes les 15 min)");
}

module.exports = { start, sendDueReminders };
