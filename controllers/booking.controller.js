const Booking  = require("../db/models/book.model");
const User     = require("../db/models/user.model");
const Company  = require("../db/models/company/company.model");
const Employee = require("../db/models/company/employee.model");
const { addEventToCalendar, deleteEventFromCalendar } = require("../utils/googleCalendarSync");
const DaysOff  = require("../db/models/company/daysOff.model");
const { getAppointments } = require("../queries/booking.queries");
const pug  = require("pug");
const path = require("path");
const { getLimit, atLeast } = require("../utils/planLimits");
const { sendEmail } = require("../utils/mailer");
const { log } = require("console");

const Stripe = require("stripe");
const _env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const _stripeKey = _env.stripeSecretKey || process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY_LOCAL || "";
const stripe = _stripeKey ? new Stripe(_stripeKey) : null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert EUR float → integer cents for Stripe */
const toCents = (eur) => Math.round(Number(eur) * 100);

/** Hours between now and a booking date+time string */
function hoursUntil(bookingDate, startTime) {
  const [h, m] = startTime.split(":").map(Number);
  const dt = new Date(bookingDate);
  dt.setHours(h, m, 0, 0);
  return (dt - Date.now()) / 3_600_000;
}

// ── Stripe: create PaymentIntent for booking (immediate charge) ───────────────
exports.createBookingPaymentIntent = async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe non configuré." });
    const { email, name, amountEur, currency, companyId, serviceName } = req.body;
    if (!email)      return res.status(400).json({ error: "Email requis." });
    if (!amountEur || Number(amountEur) <= 0) {
      return res.status(400).json({ error: "Montant invalide." });
    }

    const amountCents = toCents(amountEur);
    if (amountCents < 50) return res.status(400).json({ error: "Montant minimum 0.50 €." });

    // ── Récupérer le compte Stripe Connect + plan du coach ────────────────────
    let connectedAccountId = null;
    let coachPlan = "basic";

    if (companyId) {
      try {
        const comp = await Company.findById(companyId).select("stripeConnect owner").lean();
        if (comp?.stripeConnect?.status === "active" && comp.stripeConnect.accountId) {
          connectedAccountId = comp.stripeConnect.accountId;
        }
        // Récupérer le plan du propriétaire pour savoir si on prend des frais
        if (comp?.owner) {
          const owner = await User.findById(comp.owner).select("isPremium manualPremium subscription").lean();
          if (owner) {
            const { getPlan } = require("../utils/planLimits");
            coachPlan = getPlan(owner);
          }
        }
      } catch (_) {}
    }

    // En dev : jamais de transfer_data (les comptes test n'ont pas la capacité transfers)
    const isDevFallback = process.env.NODE_ENV !== "production";

    if (!connectedAccountId && process.env.NODE_ENV === "production") {
      return res.status(400).json({
        error: "stripe_not_connected",
        message: "Cet établissement n'a pas encore connecté Stripe. Choisissez un autre mode de paiement.",
      });
    }

    // ── Frais plateforme Branshee (5% — plan gratuit uniquement) ──────────────
    // Pro et Business → pas de frais
    const PLATFORM_FEE_PCT = 0.05; // 5%
    const applicationFee   = !isDevFallback && coachPlan === "basic"
      ? Math.round(amountCents * PLATFORM_FEE_PCT)
      : 0;

    // ── Créer le PaymentIntent ────────────────────────────────────────────────
    // En production avec un compte connecté : transfer_data vers le coach
    // En dev sans compte connecté : paiement direct (test uniquement)
    const piParams = {
      amount:               amountCents,
      currency:             (currency || "eur").toLowerCase(),
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description:          serviceName ? `Réservation — ${serviceName}` : "Réservation en ligne",
      receipt_email:        email.trim().toLowerCase(),
      ...(connectedAccountId && !isDevFallback && {
        transfer_data: { destination: connectedAccountId },
      }),
      ...(applicationFee > 0 && { application_fee_amount: applicationFee }),
      metadata: {
        companyId:          String(companyId || ""),
        connectedAccountId: connectedAccountId || "none",
        coachPlan,
        platformFee:        applicationFee > 0 ? `${(applicationFee / 100).toFixed(2)}€ (5%)` : "none",
        serviceName:        serviceName || "",
        clientEmail:        email.trim().toLowerCase(),
        clientName:         name || "",
      },
    };

    console.log("[PaymentIntent] Creating:", { amountCents, isDevFallback, connectedAccountId: connectedAccountId || "none" });
    const pi = await stripe.paymentIntents.create(piParams);
    console.log("[PaymentIntent] Created:", pi.id);

    res.json({ clientSecret: pi.client_secret, paymentIntentId: pi.id });
  } catch (err) {
    console.error("createBookingPaymentIntent error:", err.message, err.raw?.message || "");
    res.status(500).json({ error: err.raw?.message || err.message || "Erreur Stripe." });
  }
};

// ── Stripe: no-show — payment already captured, nothing to do ─────────────────
// This endpoint is kept for admin UI but no-show = money was already taken.
exports.chargeNoShow = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return res.status(404).json({ error: "Réservation introuvable." });
    if (booking.payment?.method !== "online") {
      return res.status(400).json({ error: "Pas de paiement en ligne sur ce RDV." });
    }
    if (booking.payment?.status === "paid") {
      // Already paid — just confirm it as "no-show acknowledged"
      return res.json({ success: true, info: "Paiement déjà encaissé.", amount: booking.payment.amount });
    }
    res.json({ success: false, error: "Aucun paiement à encaisser." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createBooking = async (req, res) => {
  try {
    const { date, startTime, company, name, surname, email, phone, message, formAnswers,
            serviceId, serviceName, serviceDuration,
            paymentMethod, stripePaymentIntentId, servicePrice } = req.body;

    // employeeId / employeeName may be auto-resolved below — use let
    let employeeId   = req.body.employeeId   || null;
    let employeeName = req.body.employeeName || "";

    const response = await Company.findById(company);
    const companySlotTime = response.slotTime;

    // ── Plan gate: monthly bookings cap for basic (free) plan ─────────────
    if (response.owner) {
      const companyOwner = await User.findById(response.owner).lean();
      const monthlyLimit = getLimit("monthlyBookings", companyOwner);
      if (monthlyLimit !== Infinity) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthlyCount = await Booking.countDocuments({
          company,
          date:   { $gte: startOfMonth },
          status: { $ne: "canceled" },
        });
        if (monthlyCount >= monthlyLimit) {
          return res.json({
            success: false,
            error: "monthly_limit_reached",
            message: "Ce professionnel a atteint la limite mensuelle de réservations.",
          });
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    // Use service duration if provided, otherwise fall back to company slot time
    const actualDuration = (serviceDuration && Number(serviceDuration) > 0)
      ? Number(serviceDuration)
      : companySlotTime;

    const [hours, minutes] = startTime.split(":").map(Number);
    const startTimeInMinutes = hours * 60 + minutes;
    const endTimeInMinutes   = startTimeInMinutes + actualDuration;
    const endHours   = Math.floor(endTimeInMinutes / 60);
    const endMinutes = endTimeInMinutes % 60;
    const endTime = `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;

    // ── Auto-assign an available employee when none was explicitly chosen ──
    if (!employeeId) {
      const activeEmployees = await Employee.find({ company, active: true }).lean();

      if (activeEmployees.length > 0) {
        // Find employees already booked at an overlapping slot on that date
        const overlapping = await Booking.find({
          company,
          date: new Date(date),
          status: { $ne: "canceled" },
          employee: { $in: activeEmployees.map((e) => e._id) },
        }).select("employee startTime slotTime").lean();

        const busyIds = new Set();
        overlapping.forEach((b) => {
          const [bh, bm] = b.startTime.split(":").map(Number);
          const bStart = bh * 60 + bm;
          const bEnd   = bStart + (b.slotTime || actualDuration);
          // Overlap: our window [startMin, endMin) intersects [bStart, bEnd)
          if (startTimeInMinutes < bEnd && endTimeInMinutes > bStart) {
            busyIds.add(String(b.employee));
          }
        });

        const free = activeEmployees.find((e) => !busyIds.has(String(e._id)));
        if (!free) {
          return res.json({ success: false, error: "no_employee_available" });
        }
        employeeId   = String(free._id);
        employeeName = `${free.firstName} ${free.lastName}`;
      }
    }

    const newBooking = await Booking.create({
      date: new Date(date),
      startTime,
      company,
      name,
      surname,
      email,
      phone,
      message,
      slotTime: actualDuration,   // store the ACTUAL duration, not the default slot
      endTime,
      status: "confirmed",
      formAnswers: Array.isArray(formAnswers) ? formAnswers : [],
      clientRef: req.session?.clientId || null,
      service:      serviceId   || null,
      serviceName:  serviceName || "",
      employee:     employeeId  || null,
      employeeName: employeeName || "",
      // ── Payment ────────────────────────────────────────────────────────────
      payment: {
        method: ["online", "on_site", "bank_transfer", "paypal"].includes(paymentMethod) ? paymentMethod : "none",
        status: paymentMethod === "online" && stripePaymentIntentId ? "paid" : "none",
        stripePaymentIntentId: stripePaymentIntentId || "",
        amount:   servicePrice ? Number(servicePrice) : 0,
        currency: "eur",
        paidAt:   paymentMethod === "online" && stripePaymentIntentId ? new Date() : null,
      },
    });

    // ── Fetch owner for location + Google Calendar ──────────────────────────
    const companyOwner = await User.findById(response.owner).lean();

    // Build location text
    let locationText = "";
    const loc = companyOwner?.location;
    if (loc?.serviceType === "en_ligne") {
      locationText = "En ligne";
    } else if (loc?.address || loc?.city) {
      locationText = [loc.address, loc.city].filter(Boolean).join(", ");
    }

    // Cancel URL
    const baseUrl = process.env.BASE_URL || "https://www.branshee.com";
    const cancelUrl = `${baseUrl}/cancel-booking/${newBooking._id}?token=${newBooking.cancelToken}`;

    // Formatted date (fr-FR)
    const formattedDate = new Date(date).toLocaleDateString("fr-FR", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    });

    const htmlTemplate = pug.renderFile(
      path.join(__dirname, "../views/templates/emails/booking-confirmed.pug"),
      {
        name,
        surname,
        date,
        formattedDate,
        startHour: startTime,
        endHour: endTime,
        slotTime: actualDuration,
        message,
        serviceName:  serviceName  || "",
        employeeName: employeeName || "",
        formAnswers:  Array.isArray(formAnswers) ? formAnswers : [],
        locationText,
        cancelUrl,
        bookingId:   newBooking._id,
        cancelToken: newBooking.cancelToken,
      },
    );

    await sendEmail(email, "Confirmation de votre rendez-vous — BranShee", htmlTemplate);

    // Sync Google Calendar
    try {
      if (companyOwner?.googleCalendar?.connected && companyOwner.googleCalendar.refreshToken) {
        const eventId = await addEventToCalendar(companyOwner.googleCalendar.refreshToken, newBooking);
        if (eventId) {
          await Booking.findByIdAndUpdate(newBooking._id, { googleEventId: eventId });
        }
      }
    } catch (gcalErr) {
      console.error("Google Calendar sync error (create):", gcalErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: "this booking is unavailable" });
  }
};

exports.getBooking = async (req, res) => {
  const { date, companyId, employeeId, serviceDuration } = req.query;

  const specificEmployee = employeeId && employeeId !== "null" && employeeId !== "";

  const baseQuery = {
    company: companyId,
    date: new Date(date),
    status: { $ne: "canceled" },
  };

  // ── Block past time slots when the requested date is today ───────────────
  const requestedDate = new Date(date);
  const now = new Date();
  const isToday =
    requestedDate.getFullYear() === now.getFullYear() &&
    requestedDate.getMonth()    === now.getMonth()    &&
    requestedDate.getDate()     === now.getDate();
  const nowMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : -1;

  // Get company slotTime so we can compute slot granularity.
  const [companyDoc, activeEmployeeCount] = await Promise.all([
    Company.findById(companyId).select("slotTime").lean(),
    // Only count employees when no specific one is filtered
    specificEmployee ? Promise.resolve(0) : Employee.countDocuments({ company: companyId, active: true }),
  ]);

  const granularity = (serviceDuration && Number(serviceDuration) > 0)
    ? Number(serviceDuration)
    : (companyDoc?.slotTime || 30);

  // Helper: add a slot to the blocked set (also blocks past slots for today)
  function addBlocked(blockedSet, slotStr) {
    blockedSet.add(slotStr);
  }

  // Helper: mark all past slots for today as blocked
  function blockPastSlots(blockedSet, gran) {
    if (nowMinutes < 0) return;
    for (let t = 0; t < nowMinutes; t += gran) {
      blockedSet.add(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
    }
  }

  // ── Case 1: specific employee selected → block only their slots ──────────
  if (specificEmployee) {
    const bookings = await Booking.find({ ...baseQuery, employee: employeeId }).select("startTime slotTime");
    const blockedSet = new Set();
    bookings.forEach((b) => {
      const [h, m] = b.startTime.split(":").map(Number);
      const startMin = h * 60 + m;
      const endMin   = startMin + (b.slotTime || granularity);
      for (let t = startMin; t < endMin; t += granularity) {
        addBlocked(blockedSet, `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
      }
    });
    blockPastSlots(blockedSet, granularity);
    return res.json({ bookedTimes: Array.from(blockedSet) });
  }

  // ── Case 2: no employees on this company → 1 booking blocks the slot ─────
  if (activeEmployeeCount === 0) {
    const bookings = await Booking.find(baseQuery).select("startTime slotTime");
    const blockedSet = new Set();
    bookings.forEach((b) => {
      const [h, m] = b.startTime.split(":").map(Number);
      const startMin = h * 60 + m;
      const endMin   = startMin + (b.slotTime || granularity);
      for (let t = startMin; t < endMin; t += granularity) {
        addBlocked(blockedSet, `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
      }
    });
    blockPastSlots(blockedSet, granularity);
    return res.json({ bookedTimes: Array.from(blockedSet) });
  }

  // ── Case 3: company has employees, no filter → block slot only when ALL are busy ──
  const activeEmployees = await Employee.find({ company: companyId, active: true }).select("_id").lean();

  const bookings = await Booking.find({
    ...baseQuery,
    employee: { $in: activeEmployees.map((e) => e._id) },
  }).select("startTime slotTime employee").lean();

  // For each granularity slot, track which employee IDs are booked
  const slotEmployeeMap = {}; // "HH:MM" → Set of employee id strings

  bookings.forEach((b) => {
    const [h, m] = b.startTime.split(":").map(Number);
    const startMin = h * 60 + m;
    const endMin   = startMin + (b.slotTime || granularity);
    for (let t = startMin; t < endMin; t += granularity) {
      const key = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
      if (!slotEmployeeMap[key]) slotEmployeeMap[key] = new Set();
      slotEmployeeMap[key].add(String(b.employee));
    }
  });

  // Block slot only when every active employee is booked at that time
  const blockedSet = new Set();
  Object.entries(slotEmployeeMap).forEach(([slot, empSet]) => {
    if (empSet.size >= activeEmployeeCount) blockedSet.add(slot);
  });

  // Also block past slots for today
  blockPastSlots(blockedSet, granularity);

  res.json({ bookedTimes: Array.from(blockedSet) });
};

function formatFutureDate(date) {
  const now = new Date();
  const d = new Date(date);

  const diffMs = d - now;
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));

  // passé (sécurité)
  if (diffMs < 0) {
    return d.toLocaleDateString("fr-BE");
  }

  // moins de 1 heure
  if (diffMinutes < 60) {
    return `dans ${diffMinutes} min`;
  }

  // moins de 24h
  if (diffHours < 24) {
    return `dans ${diffHours} h`;
  }

  // demain
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  if (d.toDateString() === tomorrow.toDateString()) {
    return `demain à ${d.toLocaleTimeString("fr-BE", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  // sinon date complète
  return d.toLocaleDateString("fr-BE");
}

exports.renderAppointments = async (req, res, next) => {
  const appointments = await getAppointments();
  const futureAppointments = [];

  const now = new Date();

  appointments.forEach((appointment) => {
    const [h, m] = appointment.startTime.split(":").map(Number);

    const appointmentDate = new Date(appointment.date);
    appointmentDate.setHours(h, m, 0, 0);

    if (appointmentDate > now) {
      futureAppointments.push({
        ...appointment.toObject(),
        displayDate: appointmentDate.toLocaleDateString("fr-BE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
      });
    }
  });

  req.appointments = futureAppointments;
  next();
};

exports.getSchedule = async (req, res) => {
  const { index, COMPANY_ID, date, serviceDuration, employeeId } = req.body;
  const jsWeekdayIndex = parseInt(index);
  // 1. Récupérer la config de base (pour le slotTime et les horaires par défaut)
  const company = await Company.findById(COMPANY_ID)
    .select("schedule slotTime")
    .lean();

  // 2. CHERCHER UNE EXCEPTION (DaysOff) — filtrée par employé si précisé
  const searchDateStr = new Date(date).toISOString().split("T")[0];
  const specificEmp   = employeeId && employeeId !== "null" && employeeId !== "";

  const exceptionsDoc = await DaysOff.findOne({ company: COMPANY_ID });
  let target = company.schedule.find((d) => d.weekdayIndex === jsWeekdayIndex);

  if (exceptionsDoc && exceptionsDoc.dates) {
    // Trouver une exception pertinente pour cet employé (ou pour tous si pas d'employé)
    const relevantException = exceptionsDoc.dates.find((d) => {
      if (new Date(d.date).toISOString().split("T")[0] !== searchDateStr) return false;
      const empIds = (d.employees || []).map((e) => String(e));
      if (specificEmp) {
        // Exception pertinente si : tous les employés (vide) OU cet employé
        return empIds.length === 0 || empIds.includes(String(employeeId));
      } else {
        // Pas de préférence : ne bloquer que si l'exception concerne TOUS les employés
        return empIds.length === 0;
      }
    });

    if (relevantException) {
      if (
        relevantException.workingHours &&
        relevantException.workingHours.length > 0 &&
        relevantException.workingHours[0].start
      ) {
        target = relevantException; // Journée avec horaires spéciaux
      } else {
        return res.json({ slots: [] }); // Jour bloqué pour cet employé/tous
      }
    }
  }

  // 3. GENERATION DES SLOTS (Ta logique actuelle, mais avec le bon "target")
  if (
    !target ||
    target.dayOff ||
    (target.workingHours && target.workingHours.length === 0)
  ) {
    return res.json({ slots: [] });
  }

  // Use the selected service duration as the step (granularity) if provided,
  // otherwise fall back to the company's global slot time.
  const step = (serviceDuration && Number(serviceDuration) > 0)
    ? Number(serviceDuration)
    : company.slotTime;

  let allSlots = [];
  target.workingHours.forEach((period) => {
    const [startH, startM] = period.start.split(":").map(Number);
    const [endH, endM] = period.end.split(":").map(Number);

    let current = startH * 60 + startM;
    const endTotal = endH * 60 + endM;

    while (current + step <= endTotal) {
      const h = Math.floor(current / 60);
      const m = current % 60;
      allSlots.push(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      );
      current += step;
    }
  });

  res.json({ slots: allSlots });
};

// - Saturday no schedule

exports.getDaysOff = async (req, res) => {
  const { COMPANY_ID } = req.body;
  const result = await Company.findById(COMPANY_ID).select("schedule");

  return res.json({ result });
};

exports.getDisabledDays = async (req, res) => {
  const { companyId } = req.params;
  const employeeId  = req.query.employeeId;
  const specificEmp = employeeId && employeeId !== "null" && employeeId !== "";

  const doc = await DaysOff.findOne({ company: companyId }).select("dates");
  if (!doc) return res.json([]);

  const filtered = doc.dates.filter((d) => {
    const empIds = (d.employees || []).map((e) => String(e));
    if (specificEmp) {
      // Bloquer ce jour si l'exception concerne tous (vide) OU cet employé
      return empIds.length === 0 || empIds.includes(String(employeeId));
    } else {
      // Pas de préférence : griser le jour seulement si tous les employés sont off (tableau vide)
      return empIds.length === 0;
    }
  });

  return res.json(filtered);
};

exports.getBookingC = async (req, res) => {
  const { companyId } = req.params;

  const doc = await Booking.find({
    company: companyId,
    status: { $ne: "canceled" },
  });

  res.json(doc);
};

exports.cancelBooking = async (req, res) => {
  const { userId } = req.params;
  const { token } = req.query;

  const canceledBooking = await Booking.findOneAndUpdate(
    { _id: userId, cancelToken: token },
    { status: "canceled" },
    { new: false },
  ).lean();

  if (!canceledBooking) {
    return res.status(404).render("client/404.pug", {
      message: "Lien d'annulation invalide ou déjà utilisé.",
    });
  }

  const company = await Company.findById(canceledBooking.company);
  const coach   = await User.findById(company.owner);

  // ── Politique d'annulation + remboursement ────────────────────────────────
  let chargeResult = null;
  if (stripe &&
      canceledBooking.payment?.method  === "online" &&
      canceledBooking.payment?.status  === "paid"   &&
      canceledBooking.payment?.stripePaymentIntentId) {

    const hrs    = hoursUntil(canceledBooking.date, canceledBooking.startTime);
    const amount = canceledBooking.payment.amount || 0;
    const piId   = canceledBooking.payment.stripePaymentIntentId;

    try {
      // reverse_transfer: true → le montant est aussi repris du compte connecté
      if (hrs >= 24) {
        // > 24 h → remboursement total
        await stripe.refunds.create({
          payment_intent:   piId,
          reason:           "requested_by_customer",
          reverse_transfer: true,
        });
        await Booking.findByIdAndUpdate(canceledBooking._id, { "payment.status": "refunded" });
        chargeResult = { refunded: true, pct: 100, amount };
      } else if (hrs >= 0 && amount > 0) {
        // < 24 h → remboursement 50 % (on garde 50 % pour l'établissement)
        const refundCents = toCents(amount * 0.5);
        if (refundCents >= 50) {
          await stripe.refunds.create({
            payment_intent:   piId,
            amount:           refundCents,
            reason:           "requested_by_customer",
            reverse_transfer: true,
          });
          await Booking.findByIdAndUpdate(canceledBooking._id, { "payment.status": "partial" });
          chargeResult = { refunded: true, pct: 50, amount: amount * 0.5, kept: amount * 0.5 };
        } else {
          // Montant trop petit → remboursement total
          await stripe.refunds.create({ payment_intent: piId, reverse_transfer: true });
          await Booking.findByIdAndUpdate(canceledBooking._id, { "payment.status": "refunded" });
          chargeResult = { refunded: true, pct: 100, amount };
        }
      }
      // RDV déjà passé : pas de remboursement — l'argent reste chez l'établissement
    } catch (stripeErr) {
      console.error("Refund error:", stripeErr.message);
    }
  }

  // Sync Google Calendar
  if (canceledBooking.googleEventId) {
    try {
      if (coach?.googleCalendar?.connected && coach.googleCalendar.refreshToken) {
        await deleteEventFromCalendar(coach.googleCalendar.refreshToken, canceledBooking.googleEventId);
      }
    } catch (gcalErr) {
      console.error("Google Calendar sync error (public cancel):", gcalErr.message);
    }
  }

  res.render("client/index.pug", {
    cancelBooking: true,
    chargeResult,
    company,
    coach,
  });
};

// ─── CLIENT PANEL ───────────────────────────────────────────────────────────
exports.getClientPanel = async (req, res) => {
  res.render("client/my-bookings", {
    title: "Mes rendez-vous — BranShee",
    alwaysSticky: true,
    bookings: null,
    email: null,
    error: null,
  });
};

exports.postClientPanel = async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes("@")) {
    return res.render("client/my-bookings", {
      title: "Mes rendez-vous — BranShee",
      alwaysSticky: true,
      bookings: null,
      email: null,
      error: "Veuillez entrer une adresse email valide.",
    });
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const allBookings = await Booking.find({ email: email.toLowerCase().trim() })
    .populate("company", "fullName profilePicture")
    .sort({ date: -1 })
    .lean();

  const upcoming = allBookings.filter(
    (b) => new Date(b.date) >= now && b.status === "confirmed"
  );
  const past = allBookings.filter(
    (b) => new Date(b.date) < now || b.status === "canceled"
  );

  return res.render("client/my-bookings", {
    title: "Mes rendez-vous — BranShee",
    alwaysSticky: true,
    bookings: { upcoming, past },
    email,
    error: null,
  });
};
