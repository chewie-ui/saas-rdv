const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const Stripe = require("stripe");
const getServices = require("../utils/services");
const { getLimit, atLeast } = require("../utils/planLimits");

const stripe = new Stripe(env.stripeSecretKey);

const { getAppointments, GetAllAppointments } = require("../queries/booking.queries");
const { sendEmail } = require("../utils/mailer");

exports.panel = async (req, res) => {
  res.render("admin/panel", {
    pageName: "Dashboard",
    appointments: req.appointments,
  });
};

const Booking = require("../db/models/book.model");
const DaysOff = require("../db/models/company/daysOff.model");
const pug = require("pug");
const path = require("path");
const htmlTemplate = pug.renderFile(path.join(__dirname, "../views/templates/emails/booking-confirmed.pug"), { hour: "22:30" });
exports.book = async (req, res) => {
  const { bookId } = req.params;

  const Employee = require("../db/models/company/employee.model");

  const [client, company, activeEmployees] = await Promise.all([
    Booking.findById(bookId)
      .populate("employee", "firstName lastName profilePicture")
      .populate("clientRef", "fullName profilePicture email phone"),
    Company.findOne(
      { _id: res.locals.currentCompany._id, "employees.user": req.user._id },
      { "employees.$": 1 },
    ).lean(),
    Employee.find({ company: res.locals.currentCompany._id, active: true }).lean(),
  ]);

  const grade = company?.employees[0]?.grade;

  res.render("admin/book", {
    pageName: "Book",
    title: res.locals.t.titles.book,
    client,
    grade,
    isPremium: res.locals.user.isPremium,
    employees: activeEmployees,
  });
};

function getWeekDays(startDate = new Date(), locale = "fr-FR") {
  const week = [];
  const monday = new Date(startDate);

  const today = new Date();

  const day = monday.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);

    const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();

    // Build isoDate from local date parts so it is never shifted by UTC offset
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, "0");
    const dd   = String(d.getDate()).padStart(2, "0");
    const isoDate = `${yyyy}-${mm}-${dd}`;

    week.push({
      label: d.toLocaleDateString(locale, { weekday: "short" }),
      initial: d.toLocaleDateString(locale, { weekday: "narrow" }),
      longLabel: d.toLocaleDateString(locale, { weekday: "long" }),
      date: d.toLocaleDateString(locale, {
        day: "numeric",
        month: "long",
      }),
      dayNumber: d.getDate(),
      weekdayIndex: d.getDay(),   // 0=Sun … 6=Sat — stored while d is correct local Date
      iso: d.toISOString(),
      isoDate,                    // built from local parts, never UTC-shifted
      isToday,
    });
  }

  return week;
}

function generateTimeSlots(startHour, endHour, slotTime) {
  const slots = [];

  for (let hour = startHour; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += slotTime) {
      const h = String(hour).padStart(2, "0");
      const m = String(minute).padStart(2, "0");

      slots.push(`${h}:${m}`);
    }
  }

  return slots;
}

exports.appointment = async (req, res) => {
  const currentCompany = res.locals.currentCompany;
  if (!currentCompany) {
    return res.redirect("/register");
  }

  // Employee filter from query param
  const employeeFilter = req.query.employee || "all";

  const Employee = require("../db/models/company/employee.model");
  const [apps, rowTime, employees, daysOffDoc] = await Promise.all([
    GetAllAppointments(currentCompany, employeeFilter),
    Company.findById(currentCompany).select("slotTime schedule").lean(),
    Employee.find({ company: currentCompany, active: true }).lean(),
    DaysOff.findOne({ company: currentCompany }).lean(),
  ]);

  const slotTime = rowTime.slotTime || 60;

  const formatted = apps.map((appointment) => {
    const [h, m] = appointment.startTime.split(":").map(Number);
    const startDate = new Date(appointment.date.getFullYear(), appointment.date.getMonth(), appointment.date.getDate(), h, m, 0, 0);

    // Use the booking’s stored slotTime (actual service duration) for end time
    const duration = appointment.slotTime || slotTime;
    const endDate = new Date(startDate);
    endDate.setMinutes(endDate.getMinutes() + duration);

    // Populated employee (may be null)
    const emp = appointment.employee;
    const empName  = emp ? `${emp.firstName} ${emp.lastName}`.trim() : (appointment.employeeName || "");
    const empPhoto = emp ? emp.profilePicture : "/images/no-user.webp";

    return {
      _id: appointment._id,
      name: appointment.name,
      surname: appointment.surname,
      email: appointment.email,
      phone: appointment.phone,
      message: appointment.message,
      weekday: (startDate.getDay() + 6) % 7,
      status: appointment.status,
      slotTime: duration,
      serviceName: appointment.serviceName || "",
      employeeId:   emp ? String(emp._id) : "",
      employeeName: empName,
      employeePhoto: empPhoto,

      // Build from local date parts so it always matches the local calendar day,
      // even when the server timezone is not UTC.
      isoDate: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`,
      date: startDate.toLocaleDateString("fr-BE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      // Use stored time strings directly — locale formatting is unreliable across environments
      startHour: appointment.startTime,
      endHour: `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`,
    };
  });
  const referenceDate = req.query.date ? new Date(req.query.date) : new Date();
  const focusedIso = referenceDate.toISOString().split("T")[0];
  const localeMap = {
    fr: "fr-FR",
    en: "en-US",
    nl: "nl-NL",
    es: "es-ES",
    it: "it-IT",
    de: "de-DE",
  };
  const locale = localeMap[res.locals.lang] || "fr-FR";
  const weekDays = getWeekDays(referenceDate, locale).map((d) => ({
    ...d,
    isFocused: d.iso.split("T")[0] === focusedIso,
  }));
  const firstDay = weekDays[0];
  const lastDay = weekDays[6];
  const weekLabel = `${firstDay.label} ${firstDay.date} - ${lastDay.label} ${lastDay.date}`;
  const focusedDay = weekDays.find((d) => d.isFocused) || weekDays[0];
  const dayLabel = `${focusedDay.label} ${focusedDay.date}`;
  const focusedDayName = focusedDay.longLabel;
  const focusedDayDate = focusedDay.date;
  const activeSchedule = (rowTime.schedule || []).filter((d) => !d.dayOff);
  const scheduleHours = activeSchedule.flatMap((d) => d.workingHours || []);

  const scheduleMin = scheduleHours.length > 0 ? Math.min(...scheduleHours.map((wh) => parseInt(wh.start.split(":")[0], 10))) : null;
  const scheduleMax = scheduleHours.length > 0 ? Math.max(...scheduleHours.map((wh) => parseInt(wh.end.split(":")[0], 10))) : null;

  // Include special days (DaysOff with custom working hours) in range calculation
  const weekIsos = weekDays.map((d) => d.isoDate);
  const specialDayHours = (daysOffDoc?.dates || [])
    .filter((d) => weekIsos.includes(new Date(d.date).toISOString().split("T")[0]))
    .flatMap((d) => d.workingHours || [])
    .filter((wh) => wh.start);
  const specialMin = specialDayHours.length > 0 ? Math.min(...specialDayHours.map((wh) => parseInt(wh.start.split(":")[0], 10))) : null;
  const specialMax = specialDayHours.length > 0 ? Math.max(...specialDayHours.map((wh) => parseInt(wh.end.split(":")[0], 10))) : null;

  // Compute appointment range — use total minutes so :30 appointments extend the range correctly
  const apptMinutesList = formatted.map((a) => {
    const [h, m] = a.startHour.split(":").map(Number);
    return h * 60 + m;
  });
  const apptMin = apptMinutesList.length > 0 ? Math.floor(Math.min(...apptMinutesList) / 60) : null;
  // +1h buffer so the appointment slot itself is always visible even at the last row
  const apptMax = apptMinutesList.length > 0 ? Math.ceil((Math.max(...apptMinutesList) + 60) / 60) : null;

  const candidates = [scheduleMin, specialMin, apptMin].filter((v) => v !== null);
  const minHour = candidates.length > 0 ? Math.min(...candidates) : 8;

  const candidatesMax = [scheduleMax, specialMax, apptMax].filter((v) => v !== null);
  const maxHour = candidatesMax.length > 0 ? Math.max(...candidatesMax) : 18;

  // ── Fill status per weekday (green / orange / red) ────────────────────────
  // Compare total MINUTES booked vs total available minutes so that services
  // with a different duration than the company slotTime don't skew the ratio.
  // Capacity is multiplied by the number of active employees when showing all.
  const empCapacityFactor = (employeeFilter === "all" && employees.length > 0) ? employees.length : 1;

  const weekDaysWithFill = weekDays.map((d) => {
    // weekdayIndex is stored directly from d.getDay() in getWeekDays — always the
    // correct local weekday, never shifted by UTC serialisation.
    const jsWeekday = d.weekdayIndex; // 0=Sun … 6=Sat

    // Special day override (congé with custom hours)?
    // Compare using local date parts so UTC midnight never shifts the date.
    const specialDay = (daysOffDoc?.dates || []).find((sd) => {
      const s = new Date(sd.date);
      const sdIso = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")}`;
      return sdIso === d.isoDate;
    });

    let workingHours = [];
    if (specialDay) {
      workingHours = specialDay.workingHours || [];
    } else {
      const dayConfig = (rowTime.schedule || []).find((s) => s.weekdayIndex === jsWeekday);
      if (dayConfig && !dayConfig.dayOff) workingHours = dayConfig.workingHours || [];
    }

    // Total available minutes for this day (× employee count when viewing "all")
    let totalAvailableMinutes = 0;
    workingHours.forEach((period) => {
      if (!period?.start || !period?.end) return; // guard against malformed data
      const [sh, sm] = period.start.split(":").map(Number);
      const [eh, em] = period.end.split(":").map(Number);
      if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return;
      totalAvailableMinutes += (eh * 60 + em) - (sh * 60 + sm);
    });
    totalAvailableMinutes *= empCapacityFactor;

    // Total minutes booked on this day — use each booking's real duration so that
    // a 60-min service doesn't count as only one 30-min slot (or vice-versa).
    const minutesBooked = formatted
      .filter((a) => a.isoDate === d.isoDate)
      .reduce((sum, a) => sum + (a.slotTime || slotTime), 0);

    let fillStatus = null;
    if (totalAvailableMinutes > 0) {
      const ratio = minutesBooked / totalAvailableMinutes;
      // thresholds: green < 75 % ≤ orange < 100 % ≤ red
      if      (ratio >= 1)    fillStatus = "red";
      else if (ratio >= 0.75) fillStatus = "orange";
      else                    fillStatus = "green";
    }

    // A day is "off" when there is no special override and the schedule marks it dayOff
    // (or there is simply no schedule entry for this weekday at all)
    const dayConfig2 = (rowTime.schedule || []).find((s) => s.weekdayIndex === jsWeekday);
    const isDayOff = !specialDay && (!dayConfig2 || dayConfig2.dayOff === true);

    return { ...d, fillStatus, isDayOff };
  });

  // Always use 30-min steps so appointments at :30 are never missed
  res.render("admin/appointment", {
    pageName: "Appointment",
    title: res.locals.t.titles.calendar,
    slotTime,
    hours: generateTimeSlots(minHour, maxHour, 30),
    weekDays: weekDaysWithFill,
    appointments: formatted,
    weekLabel,
    dayLabel,
    focusedDayName,
    focusedDayDate,
    employees,
    employeeFilter,
  });
};

const Company = require("../db/models/company/company.model");
const User = require("../db/models/user.model");
const { addEventToCalendar, deleteEventFromCalendar } = require("../utils/googleCalendarSync");

exports.client = (req, res) => {
  res.render("admin/client", {
    pageName: "Clients",
  });
};

async function getSlotTime(companyId) {
  const res = await Company.findById(companyId).select("slotTime").lean();

  return res?.slotTime;
}

async function getDaysOff(companyId) {
  const doc = await DaysOff.findOne({ company: companyId })
    .populate("dates.employees", "firstName lastName")
    .lean();

  if (!doc) return { dates: [] };

  const today = new Date();
  today.setHours(0, 0, 0, 0); // ignore l'heure

  doc.dates = doc.dates
    .filter((d) => new Date(d.date) >= today) // garde seulement futur / aujourd'hui
    .sort((a, b) => new Date(a.date) - new Date(b.date)); // tri proche → loin

  return doc;
}
exports.availability = async (req, res) => {
  const currentCompany = res.locals.currentCompany;
  if (!currentCompany) {
    return res.redirect("/register");
  }
  const Service  = require("../db/models/company/service.model");
  const Employee = require("../db/models/company/employee.model");
  const [daysOff, currentSlotTime, serviceCount, activeEmployees] = await Promise.all([
    getDaysOff(currentCompany),
    getSlotTime(currentCompany),
    Service.countDocuments({ company: currentCompany, active: true }),
    Employee.find({ company: currentCompany._id, active: true }).select("firstName lastName").lean(),
  ]);
  const availFeatures = getLimit("availability", req.user);
  res.render("admin/availability", {
    daysOff,
    employees: activeEmployees,
    pageName: "Availability",
    title: res.locals.t.titles.avail,
    timeSlot: [10, 15, 20, 25, 30, 45, 60, 90, 120, 180],
    hours: generateHours(10),
    currentSlotTime,
    hasServices: serviceCount > 0,
    availFeatures,
  });
};

function generateHours(step = 60) {
  // comprendre cette function
  const hours = [];

  for (let i = 0; i < 24 * 60; i += step) {
    const h = String(Math.floor(i / 60)).padStart(2, "0");
    const m = String(i % 60).padStart(2, "0");
    hours.push(`${h}:${m}`);
  }

  return hours;
}

exports.toggleDay = async (req, res) => {
  const { weekdayIndex, companyId, dayOff } = req.body;

  await Company.updateOne(
    {
      _id: companyId,
      "schedule.weekdayIndex": weekdayIndex,
    },
    {
      $set: {
        "schedule.$.dayOff": dayOff,
        // "schedule.$.workingHours": workingHours,
      },
    },
  );

  res.json({ success: true });
};

exports.editAvailabilty = async (req, res) => {
  const { weekdayIndex, companyId, workingHours } = req.body;

  if (!workingHours || workingHours.length === 0) {
    return res.json({ success: false, message: "No working hours provided" });
  }

  await Company.updateOne(
    {
      _id: companyId,
      "schedule.weekdayIndex": Number(weekdayIndex),
    },
    {
      $set: {
        "schedule.$.workingHours": workingHours,
      },
    },
  );

  res.json({ success: true });
};

exports.editSlotTime = async (req, res) => {
  try {
    const { slot } = req.body;
    const companyId = res.locals.currentCompany._id;

    await Company.findByIdAndUpdate(companyId, {
      slotTime: slot,
    });

    res.json({ success: true });
  } catch (err) {
    res.json({ error: err });
  }
};

exports.deleteBooking = async (req, res) => {
  if (!atLeast(req.user, "pro")) {
    return res.status(403).json({ error: "plan_limit", message: "Nécessite un abonnement Pro ou Business." });
  }
  const { bookId } = req.params;

  const data = await Booking.findByIdAndDelete(bookId);

  // Sync Google Calendar
  if (data?.googleEventId) {
    try {
      const companyDoc = await Company.findById(data.company);
      const owner = await User.findById(companyDoc?.owner);
      if (owner?.googleCalendar?.connected && owner.googleCalendar.refreshToken) {
        await deleteEventFromCalendar(owner.googleCalendar.refreshToken, data.googleEventId);
      }
    } catch (gcalErr) {
      console.error("Google Calendar sync error (delete):", gcalErr.message);
    }
  }

  res.json({ success: true, data });
};

exports.restoreBooking = async (req, res) => {
  if (!atLeast(req.user, "pro")) {
    return res.status(403).json({ error: "plan_limit", message: "Nécessite un abonnement Pro ou Business." });
  }
  try {
    const { bookId } = req.params;

    const booking = await Booking.findByIdAndUpdate(bookId, { status: "confirmed" }, { new: true }).lean();

    // Sync Google Calendar : recréer l'événement et sauvegarder le nouvel ID
    if (booking) {
      try {
        const companyDoc = await Company.findById(booking.company);
        const owner = await User.findById(companyDoc?.owner);
        if (owner?.googleCalendar?.connected && owner.googleCalendar.refreshToken) {
          const eventId = await addEventToCalendar(owner.googleCalendar.refreshToken, booking);
          if (eventId) {
            await Booking.findByIdAndUpdate(bookId, { googleEventId: eventId });
          }
        }
      } catch (gcalErr) {
        console.error("Google Calendar sync error (restore):", gcalErr.message);
      }
    }

    res.json({ success: true });
  } catch (err) {
    if (err.code === 11000) {
      return res.json({
        success: false,
        message: "Impossible de restaurer : ce créneau horaire est déjà occupé par une autre réservation.",
      });
    }
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Une erreur est survenue lors de la restauration.",
    });
  }
};

exports.cancelBooking = async (req, res) => {
  if (!atLeast(req.user, "pro")) {
    return res.status(403).json({ error: "plan_limit", message: "Nécessite un abonnement Pro ou Business." });
  }
  const { id } = req.params;

  const booking = await Booking.findByIdAndUpdate(id, { status: "canceled" }, { new: false }).lean();

  // Sync Google Calendar
  if (booking?.googleEventId) {
    try {
      const companyDoc = await Company.findById(booking.company);
      const owner = await User.findById(companyDoc?.owner);
      if (owner?.googleCalendar?.connected && owner.googleCalendar.refreshToken) {
        await deleteEventFromCalendar(owner.googleCalendar.refreshToken, booking.googleEventId);
      }
    } catch (gcalErr) {
      console.error("Google Calendar sync error (admin cancel):", gcalErr.message);
    }
  }

  // Send cancellation email to the client
  if (booking?.email) {
    try {
      const cancelHtml = pug.renderFile(path.join(__dirname, "../views/templates/emails/booking-cancelled.pug"), {
        name:      booking.name     || "",
        surname:   booking.surname  || "",
        date:      booking.date,
        startHour: booking.startTime || "",
        endHour:   booking.endTime   || "",
      });
      await sendEmail(booking.email, "Votre rendez-vous a été annulé", cancelHtml);
    } catch (mailErr) {
      console.error("Cancel email error:", mailErr.message);
    }
  }

  res.json({ success: true });
};

exports.updateBookingEmployee = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { employeeId } = req.body;

    const Employee = require("../db/models/company/employee.model");
    let updateFields = {};

    if (employeeId) {
      const emp = await Employee.findById(employeeId).lean();
      if (!emp) return res.json({ success: false, error: "Employé introuvable." });
      updateFields.employee     = emp._id;
      updateFields.employeeName = `${emp.firstName} ${emp.lastName}`.trim();
    } else {
      updateFields.employee     = null;
      updateFields.employeeName = "";
    }

    await Booking.findByIdAndUpdate(bookId, updateFields);
    return res.json({ success: true, employeeId: employeeId || null, employeeName: updateFields.employeeName });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, error: err.message });
  }
};

exports.getWeekData = async (req, res) => {
  const currentCompany = res.locals.currentCompany;
  if (!currentCompany) {
    return res.redirect("/register");
  }
  const referenceDate = new Date(req.query.date);

  const weekDays = getWeekDays(referenceDate);

  const apps = await GetAllAppointments(currentCompany);

  res.json({
    weekDays,
    appointments: apps,
  });
};

exports.informationsPage = async (req, res) => {
  const email = req.user.email;
  const maskEmail = email.replace(/^(..)(.*)(?=@)/, "$1...");
  const canUseSocial    = getLimit("socialLinks", req.user);
  const canUseCustomUrl = require("../utils/planLimits").LIMITS.customUrl.hasFeature(req.user);
  const cs = req.user.calendarSettings || {};

  // ── Stripe : cartes & factures ──────────────────────────────────────────
  let paymentMethods = [];
  let invoices       = [];
  const stripeCustomerId = req.user.subscription?.stripeCustomerId;
  if (stripeCustomerId) {
    try {
      const [pmsResult, invResult, customer] = await Promise.all([
        stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card", limit: 10 }),
        stripe.invoices.list({ customer: stripeCustomerId, limit: 12 }),
        stripe.customers.retrieve(stripeCustomerId),
      ]);

      // Trouver la carte par défaut (customer invoice_settings ou abonnement)
      let defaultPmId = customer.invoice_settings?.default_payment_method || null;
      if (!defaultPmId && req.user.subscription?.stripeSubscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(req.user.subscription.stripeSubscriptionId);
          defaultPmId = sub.default_payment_method || null;
        } catch (_) {}
      }
      // Si aucune défaut explicite mais une seule carte → c'est elle la défaut
      if (!defaultPmId && pmsResult.data.length === 1) {
        defaultPmId = pmsResult.data[0].id;
      }

      paymentMethods = pmsResult.data.map((pm) => ({
        id:        pm.id,
        brand:     pm.card.brand,
        last4:     pm.card.last4,
        expMonth:  pm.card.exp_month,
        expYear:   pm.card.exp_year,
        isDefault: pm.id === defaultPmId,
      }));
      invoices = invResult.data.map((inv) => ({
        id:          inv.id,
        date:        inv.created,
        description: inv.description || (inv.lines?.data?.[0]?.description) || "Abonnement BranShee",
        amount:      ((inv.amount_paid || inv.amount_due || 0) / 100).toFixed(2),
        currency:    (inv.currency || "eur").toUpperCase(),
        status:      inv.status,
        pdfUrl:      inv.invoice_pdf,
        hostedUrl:   inv.hosted_invoice_url,
      }));
    } catch (e) {
      console.error("Stripe billing fetch error:", e.message);
    }
  }

  res.render("admin/informations", {
    pageName: "Informations",
    success: req.query.success,
    title: res.locals.t.titles.infos,
    maskEmail,
    currentCompany: res.locals.currentCompany,
    canUseSocial,
    canUseCustomUrl,
    cs,
    gallery:             cs.gallery   || [],
    equipment:           cs.equipment || [],
    isPro:               res.locals.isPro,
    paymentMethods,
    invoices,
    stripePublishableKey: env.stripePublishableKey || "",
  });
};

exports.historyInit = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 13;
    const skip = (page - 1) * limit;

    const now = new Date();
    const query = {
      company: res.locals.currentCompany._id,
      // date: { $lt: now },
    };

    const history = await Booking.find(query).sort({ date: -1, startTime: 1 }).skip(skip).limit(limit).populate("user");

    const totalBookings = await Booking.countDocuments(query);
    const totalPages = Math.ceil(totalBookings / limit);
    console.log(`totalBookings: ${totalBookings}`);
    console.log(`totalPages: ${totalPages}`);

    return res.render("admin/history", {
      pageName: "History",
      title: res.locals.t.titles.history,
      history,
      currentPage: page,
      totalBookings,
      totalPages,
    });
  } catch (err) {
    console.log(history);
    return res.send(err);
  }
};

exports.historyDeleteRow = async (req, res) => {
  try {
    const { id } = req.body;

    const response = await Booking.findByIdAndDelete(id);
    console.log(response);
    if (response) {
      return res.json({ success: true });
    } else {
      return res.json({ success: false });
    }
  } catch (err) {
    return res.json({ err });
  }
};

exports.historySearch = async (req, res) => {
  const { client } = req.query;
  try {
    const searchRegex = new RegExp(client, "i");

    const results = await Booking.find({
      $or: [{ name: searchRegex }, { surname: searchRegex }, { email: searchRegex }, { phone: searchRegex }, { message: searchRegex }],
    });
    return res.json({ success: true, results });
  } catch (err) {
    return res.json({ err });
  }
};

exports.historyEditRow = async (req, res) => {
  try {
    const { id } = req.params;
    const results = await Booking.findById(id).populate("employee");

    // Fetch services & employees for the booking's company (for edit selectors)
    let services = [];
    let employees = [];
    if (results && results.company) {
      const Service  = require("../db/models/company/service.model");
      const Employee = require("../db/models/company/employee.model");
      [services, employees] = await Promise.all([
        Service.find({ company: results.company, active: true }).select("_id name duration price").lean(),
        Employee.find({ company: results.company, active: true }).select("_id firstName lastName").lean(),
      ]);
    }

    return res.render("admin/history-edit", {
      rowId: id,
      pageName: "History",
      title: res.locals.t.titles.history,
      results,
      services,
      employees,
    });
  } catch (err) {
    console.error(err);
    return res.json({ err });
  }
};

exports.settingsInit = async (req, res) => {
  const email     = req.user.email;
  const maskEmail = email.replace(/^(..)(.*)(?=@)/, "$1...");
  const canUseSocial    = getLimit("socialLinks", req.user);
  const canUseCustomUrl = require("../utils/planLimits").LIMITS.customUrl.hasFeature(req.user);
  const cs = req.user.calendarSettings || {};

  // ── Stripe : cartes & factures ──────────────────────────────────────────
  let paymentMethods = [];
  let invoices       = [];
  const stripeCustomerId = req.user.subscription?.stripeCustomerId;
  if (stripeCustomerId) {
    try {
      const [pmsResult, invResult, customer] = await Promise.all([
        stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card", limit: 10 }),
        stripe.invoices.list({ customer: stripeCustomerId, limit: 12 }),
        stripe.customers.retrieve(stripeCustomerId),
      ]);

      let defaultPmId = customer.invoice_settings?.default_payment_method || null;
      if (!defaultPmId && req.user.subscription?.stripeSubscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(req.user.subscription.stripeSubscriptionId);
          defaultPmId = sub.default_payment_method || null;
        } catch (_) {}
      }
      if (!defaultPmId && pmsResult.data.length === 1) defaultPmId = pmsResult.data[0].id;

      paymentMethods = pmsResult.data.map((pm) => ({
        id:        pm.id,
        brand:     pm.card.brand,
        last4:     pm.card.last4,
        expMonth:  pm.card.exp_month,
        expYear:   pm.card.exp_year,
        isDefault: pm.id === defaultPmId,
      }));
      invoices = invResult.data.map((inv) => ({
        id:          inv.id,
        date:        inv.created,
        description: inv.description || (inv.lines?.data?.[0]?.description) || "Abonnement BranShee",
        amount:      ((inv.amount_paid || inv.amount_due || 0) / 100).toFixed(2),
        currency:    (inv.currency || "eur").toUpperCase(),
        status:      inv.status,
        pdfUrl:      inv.invoice_pdf,
        hostedUrl:   inv.hosted_invoice_url,
      }));
    } catch (e) {
      console.error("Stripe billing fetch error:", e.message);
    }
  }

  const twoFAEnabled = req.user?.twoFA?.enabled || false;
  const currentLang  = req.cookies?.user_lang || req.user?.preferredLang || "fr";

  return res.render("admin/settings", {
    pageName: "Settings",
    title: res.locals.t?.titles?.infos || "Paramètres",
    success: req.query.success,
    maskEmail,
    currentCompany: res.locals.currentCompany,
    canUseSocial,
    canUseCustomUrl,
    cs,
    gallery:             cs.gallery   || [],
    equipment:           cs.equipment || [],
    isPro:               res.locals.isPro,
    currentPlan:         res.locals.currentPlan,
    paymentMethods,
    invoices,
    stripePublishableKey: env.stripePublishableKey || "",
    twoFAEnabled,
    currentLang,
    // Stripe Connect
    stripeConnect: res.locals.currentCompany?.stripeConnect || { status: "not_connected", accountId: "", accountEmail: "" },
    acceptedPayments: res.locals.currentCompany?.acceptedPayments || {},
    stripeConnectClientId: env.stripeConnectClientId || "",
    stripeConnectSuccess:  req.query.stripeConnectSuccess === "1",
    stripeConnectError:    req.query.stripeConnectError   || null,
  });
};

exports.historyEditRowPatch = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      surname,
      fullName,
      email,
      phone,
      message,
      date,
      startTime,
      endTime,
      status,
      adminNotes,
      serviceId,
      serviceName,
      employeeId,
    } = req.body;

    // Support both separate name/surname and legacy fullName
    let firstName = name;
    let lastName = surname;
    if (!firstName && !lastName && fullName) {
      const parts = fullName.trim().split(" ");
      firstName = parts[0];
      lastName = parts.slice(1).join(" ") || "";
    }

    const updateFields = {};
    if (firstName !== undefined) updateFields.name = firstName;
    if (lastName !== undefined) updateFields.surname = lastName;
    if (email !== undefined) updateFields.email = email;
    if (phone !== undefined) updateFields.phone = phone;
    if (message !== undefined) updateFields.message = message;
    if (adminNotes !== undefined) updateFields.adminNotes = adminNotes;
    if (date) updateFields.date = new Date(date);
    if (startTime) updateFields.startTime = startTime;
    if (endTime) updateFields.endTime = endTime;
    if (status && ["confirmed", "canceled"].includes(status)) {
      updateFields.status = status;
    }
    // Service update
    if (serviceId !== undefined) {
      updateFields.service    = serviceId || null;
      if (serviceName !== undefined) updateFields.serviceName = serviceName || "";
    }
    // Employee update (empty string = "no employee")
    if (employeeId !== undefined) {
      updateFields.employee     = employeeId || null;
      updateFields.employeeName = "";
    }

    // ── Optional: force-delete conflicting bookings before saving ──────────────
    const { forceDeleteConflicts } = req.body;
    if (forceDeleteConflicts && req.body.date && updateFields.startTime && updateFields.endTime) {
      const bookingCompany = (await Booking.findById(id).select("company").lean())?.company;
      const conflictQuery = buildConflictQuery(
        bookingCompany,
        req.body.date,       // keep as YYYY-MM-DD string for buildConflictQuery
        updateFields.startTime,
        updateFields.endTime,
        updateFields.employee ?? undefined,
        id
      );
      await Booking.deleteMany(conflictQuery);
    }

    const response = await Booking.findByIdAndUpdate(id, updateFields);

    if (response) {
      return res.json({ success: true });
    }
    return res.json({ success: false });
  } catch (err) {
    console.error(err);
    return res.json({ err });
  }
};

// ── Shared helper: build a MongoDB conflict query ─────────────────────────────
function buildConflictQuery(company, date, startTime, endTime, employeeId, excludeId) {
  // Use a 24-hour window to be timezone-safe
  const dayStart = new Date(date + "T00:00:00.000Z");
  const dayEnd   = new Date(date + "T23:59:59.999Z");

  const query = {
    company,
    date:      { $gte: dayStart, $lte: dayEnd },
    status:    "confirmed",
    startTime: { $lt: endTime },
    endTime:   { $gt: startTime },
    _id:       { $ne: excludeId },
  };
  if (employeeId) {
    query.$or = [
      { employee: employeeId },
      { employee: null },
    ];
  }
  return query;
}

// ── Check conflicts before saving a booking edit ──────────────────────────────
exports.historyCheckConflicts = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, startTime, endTime, employeeId } = req.query;

    if (!date || !startTime || !endTime) {
      return res.json({ hasConflict: false, conflicts: [] });
    }

    const booking = await Booking.findById(id).select("company").lean();
    if (!booking) return res.json({ hasConflict: false, conflicts: [] });

    const query = buildConflictQuery(
      booking.company,
      date,
      startTime,
      endTime,
      employeeId || null,
      id
    );

    const conflicts = await Booking.find(query)
      .select("name surname startTime endTime date serviceName employeeName")
      .lean();

    return res.json({
      hasConflict: conflicts.length > 0,
      conflicts: conflicts.map((c) => ({
        id: c._id,
        name: `${c.name || ""} ${c.surname || ""}`.trim(),
        time: `${c.startTime} – ${c.endTime}`,
        service: c.serviceName || "",
      })),
    });
  } catch (err) {
    console.error("[historyCheckConflicts]", err);
    return res.json({ hasConflict: false, conflicts: [], error: err.message });
  }
};

exports.paymentVerification = async (req, res) => {
  const { session_id } = req.query;
  const renderSuccess = () => res.render("admin/payment-success", { t: res.locals.t });

  // No session_id: can't verify — show success anyway (Stripe redirected here)
  if (!session_id) return renderSuccess();

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== "paid") return res.redirect("/subscription");

    // ── Determine plan from line items ───────────────────────────────────────
    const Subscription = require("../db/models/subscription.model");
    const lineItems = await stripe.checkout.sessions.listLineItems(session_id, { limit: 5 });
    const priceId = lineItems.data[0]?.price?.id || "";
    const isBusinessPrice = [
      env.stripePriceBusinessMonthly,
      env.stripePriceBusinessYearly,
      env.stripePricePlanBusiness,
    ].filter(Boolean).includes(priceId);
    const planName = isBusinessPrice ? "business" : "pro";

    const userId = session.client_reference_id || (req.user && req.user._id.toString());

    if (userId) {
      // Update user document
      await User.findByIdAndUpdate(userId, {
        isPremium: true,
        manualPremium: false,
        "subscription.plan":                 planName,
        "subscription.status":               "active",
        "subscription.stripeCustomerId":     session.customer,
        "subscription.stripeSubscriptionId": session.subscription,
      });

      // Désactiver tous les anciens docs Subscription actifs
      await Subscription.updateMany(
        { user: userId, status: "active" },
        { status: "superseded" }
      );

      // Créer/mettre à jour le Subscription document (clé = stripeSubscriptionId)
      const expDate = new Date();
      expDate.setMonth(expDate.getMonth() + 1);
      await Subscription.findOneAndUpdate(
        { user: userId, stripeSubscriptionId: session.subscription },
        {
          user:                   userId,
          plan:                   planName,
          status:                 "active",
          startDate:              new Date(),
          endDate:                expDate,
          stripeCustomerId:       session.customer,
          stripeSubscriptionId:   session.subscription,
          amount:                 (session.amount_total || 0) / 100,
          currency:               session.currency,
        },
        { upsert: true, new: true }
      );

      // Update session so the current request sees the new plan immediately
      if (req.user) {
        req.user.isPremium = true;
        req.user.subscription = req.user.subscription || {};
        req.user.subscription.plan = planName;
        req.user.subscription.status = "active";
      }
      console.log(`✅ [paymentVerification] Plan activé : ${planName} pour user ${userId}`);
    }

    return renderSuccess();
  } catch (err) {
    console.error("[paymentVerification] Erreur :", err.message);
    return renderSuccess();
  }
};

const Subscription = require("../db/models/subscription.model");

exports.resumeSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ user: req.user._id });

    if (!subscription || !subscription.stripeSubscriptionId) {
      return res.status(404).json({ error: "Abonnement introuvable." });
    }

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    subscription.autoRenew = true;
    subscription.status = "active";
    await subscription.save();

    return res.json({
      success: true,
      message: "Abonnement réactivé avec succès.",
    });
  } catch (error) {
    console.error(error);
    return res.json({ err });
  }
};

exports.saveAdminNotes = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { adminNotes } = req.body;

    await Booking.findByIdAndUpdate(bookId, { adminNotes });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, err });
  }
};

const Form = require("../db/models/form.model");

exports.formsIndex = async (req, res) => {
  const { getLimit } = require("../utils/planLimits");
  try {
    const companyId = res.locals.currentCompany._id;
    const form = await Form.findOne({ company: companyId }).lean();
    const maxQuestions = getLimit("formQuestions", req.user);
    return res.render("admin/forms", {
      pageName: res.locals.t.sidebar.a_9,
      form: form || null,
      title: res.locals.t.sidebar.a_9,
      maxQuestions,
    });
  } catch (err) {
    console.error(err);
    return res.render("admin/forms", {
      pageName: res.locals.t.sidebar.a_9,
      form: null,
      title: res.locals.t.sidebar.a_9,
      maxQuestions: 0,
    });
  }
};

exports.getFormData = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const form = await Form.findOne({ company: companyId }).lean();
    return res.json({ success: true, form: form || null });
  } catch (err) {
    return res.json({ success: false, err: err.message });
  }
};

exports.saveForm = async (req, res) => {
  const { getLimit } = require("../utils/planLimits");
  try {
    const companyId = res.locals.currentCompany._id;
    const { active, questions } = req.body;

    // Enforce plan limit server-side
    const maxQuestions = getLimit("formQuestions", req.user);
    if (maxQuestions === 0) {
      return res.json({ success: false, error: "plan_limit", message: "Votre plan ne permet pas d'utiliser le formulaire." });
    }
    const limitedQuestions = Array.isArray(questions) ? questions.slice(0, maxQuestions) : [];

    const form = await Form.findOneAndUpdate(
      { company: companyId },
      { active: maxQuestions > 0 ? active : false, questions: limitedQuestions },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, form });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, err: err.message });
  }
};

exports.customizeCalendarPage = async (req, res) => {
  const cs = req.user.calendarSettings || {};
  const canUseSocial    = getLimit("socialLinks", req.user);
  const canUseCustomUrl = require("../utils/planLimits").LIMITS.customUrl.hasFeature(req.user);
  return res.render("admin/customize", {
    pageName: "Customize",
    title: res.locals.t.customize.title,
    calendarSettings: cs,
    gallery:      cs.gallery   || [],
    equipment:    cs.equipment || [],
    isPro:        res.locals.isPro,
    currentPlan:  res.locals.currentPlan,
    services:     getServices(res.locals.lang),
    currentCompany: res.locals.currentCompany,
    canUseSocial,
    canUseCustomUrl,
  });
};

// ── Paramètres pré-paiement ───────────────────────────────────────────────────
exports.savePrepaymentSettings = async (req, res) => {
  try {
    const { enabled, required, cash, cardOnSite,
            bankTransferEnabled, iban, bic, bankName, bankNote,
            paypalEnabled, paypalMe } = req.body;
    const companyId = res.locals.currentCompany._id;
    await Company.findByIdAndUpdate(companyId, {
      "prepayment.enabled":  !!enabled,
      "prepayment.required": !!required,
      // Modes de paiement acceptés
      "acceptedPayments.cash":                  !!cash,
      "acceptedPayments.cardOnSite":            !!cardOnSite,
      "acceptedPayments.bankTransfer.enabled":  !!bankTransferEnabled,
      "acceptedPayments.bankTransfer.iban":     (iban     || "").trim().replace(/\s/g, ""),
      "acceptedPayments.bankTransfer.bic":      (bic      || "").trim().toUpperCase(),
      "acceptedPayments.bankTransfer.bankName": (bankName || "").trim(),
      "acceptedPayments.bankTransfer.note":     (bankNote || "").trim(),
      "acceptedPayments.paypal.enabled":        !!paypalEnabled,
      "acceptedPayments.paypal.paypalMe":       (paypalMe || "").trim().replace(/^https?:\/\/paypal\.me\//i, ""),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("savePrepaymentSettings error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Stripe Connect (Express — onboarding hébergé par Stripe) ─────────────────

/**
 * Démarre l'onboarding Express :
 *   1. Crée un compte Express Stripe (ou réutilise un compte "pending" existant)
 *   2. Génère un lien d'onboarding hébergé par Stripe
 *   3. Redirige l'admin vers ce lien
 * → Aucun ca_xxx / STRIPE_CONNECT_CLIENT_ID requis.
 */
exports.initiateStripeConnect = async (req, res) => {
  try {
    const baseUrl   = env.appBaseUrl || "https://www.branshee.com";
    const companyId = res.locals.currentCompany._id.toString();

    // ── 1. Compte Express : réutiliser si "pending", sinon créer ─────────────
    let accountId = res.locals.currentCompany?.stripeConnect?.accountId;
    const currentStatus = res.locals.currentCompany?.stripeConnect?.status;

    if (!accountId || currentStatus === "not_connected") {
      const account = await stripe.accounts.create({
        type: "express",
        capabilities: {
          card_payments: { requested: true },
          transfers:     { requested: true },
        },
        metadata: { companyId },
        ...(req.user?.email && { email: req.user.email }),
      });
      accountId = account.id;

      // Sauvegarder le compte en attente
      await Company.findByIdAndUpdate(companyId, {
        "stripeConnect.accountId":    accountId,
        "stripeConnect.status":       "pending",
        "stripeConnect.accountEmail": req.user?.email || "",
      });
    }

    // ── 2. Générer le lien d'onboarding ──────────────────────────────────────
    const accountLink = await stripe.accountLinks.create({
      account:     accountId,
      refresh_url: `${baseUrl}/settings/stripe-connect/refresh?accountId=${accountId}`,
      return_url:  `${baseUrl}/settings/stripe-connect/return?accountId=${accountId}`,
      type:        "account_onboarding",
    });

    return res.redirect(accountLink.url);
  } catch (err) {
    console.error("initiateStripeConnect (Express) error:", err);
    return res.redirect("/settings?stripeConnectError=init");
  }
};

/**
 * Retour après onboarding Stripe Express.
 * Stripe redirige ici même si l'onboarding n'est pas terminé —
 * on vérifie details_submitted pour savoir si c'est complet.
 */
exports.stripeConnectReturn = async (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.redirect("/settings?stripeConnectError=missing_account");

  try {
    const account = await stripe.accounts.retrieve(accountId);
    const isComplete = !!(account.details_submitted);
    const email = account.email || account.business_profile?.support_email || "";

    const company = await Company.findOne({ "stripeConnect.accountId": accountId });
    if (!company) return res.redirect("/settings?stripeConnectError=not_found");

    await Company.findByIdAndUpdate(company._id, {
      "stripeConnect.status":       isComplete ? "active" : "pending",
      "stripeConnect.accountEmail": email,
    });

    if (isComplete) {
      return res.redirect("/settings?stripeConnectSuccess=1");
    } else {
      // Onboarding non terminé — on peut lui proposer de continuer
      return res.redirect("/settings?stripeConnectError=incomplete");
    }
  } catch (err) {
    console.error("stripeConnectReturn error:", err);
    return res.redirect(`/settings?stripeConnectError=${encodeURIComponent(err.message || "return_error")}`);
  }
};

/**
 * Refresh : le lien d'onboarding a expiré — on en régénère un.
 */
exports.stripeConnectRefresh = async (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.redirect("/settings?stripeConnectError=refresh");

  try {
    const baseUrl = env.appBaseUrl || "https://www.branshee.com";
    const accountLink = await stripe.accountLinks.create({
      account:     accountId,
      refresh_url: `${baseUrl}/settings/stripe-connect/refresh?accountId=${accountId}`,
      return_url:  `${baseUrl}/settings/stripe-connect/return?accountId=${accountId}`,
      type:        "account_onboarding",
    });
    return res.redirect(accountLink.url);
  } catch (err) {
    console.error("stripeConnectRefresh error:", err);
    return res.redirect("/settings?stripeConnectError=refresh");
  }
};

/** Déconnecte le compte Stripe Connect (supprime la liaison en DB) */
exports.disconnectStripeConnect = async (req, res) => {
  try {
    const company = res.locals.currentCompany;
    await Company.findByIdAndUpdate(company._id, {
      "stripeConnect.accountId":    "",
      "stripeConnect.status":       "not_connected",
      "stripeConnect.accountEmail": "",
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("disconnectStripeConnect error:", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

/** Sauvegarde manuelle d'un compte Stripe (acct_xxx) — fallback pour les pros qui ont déjà un compte */
exports.saveStripeAccountManual = async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!accountId || !accountId.startsWith("acct_")) {
      return res.status(400).json({ error: "Identifiant invalide. Il doit commencer par acct_" });
    }
    let accountEmail = "";
    try {
      const account = await stripe.accounts.retrieve(accountId);
      accountEmail = account.email || account.business_profile?.support_email || "";
    } catch (_) {
      return res.status(400).json({ error: "Compte Stripe introuvable." });
    }
    const companyId = res.locals.currentCompany._id;
    await Company.findByIdAndUpdate(companyId, {
      "stripeConnect.accountId":    accountId,
      "stripeConnect.status":       "active",
      "stripeConnect.accountEmail": accountEmail,
    });
    return res.json({ success: true, accountEmail });
  } catch (err) {
    console.error("saveStripeAccountManual error:", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};
