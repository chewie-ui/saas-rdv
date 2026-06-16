const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const Stripe = require("stripe");
const getServices = require("../utils/services");
const { getLimit, atLeast } = require("../utils/planLimits");

const stripe = new Stripe(env.stripeSecretKey);

const { getAppointments, GetAllAppointments } = require("../queries/booking.queries");
const { sendEmail } = require("../utils/mailer");
const { isFeatureEnabled } = require("../middlewares/featureFlag");

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
  const Service = require("../db/models/company/service.model");
  const [apps, rowTime, employees, daysOffDoc, services] = await Promise.all([
    GetAllAppointments(currentCompany, employeeFilter),
    Company.findById(currentCompany).select("slotTime schedule").lean(),
    Employee.find({ company: currentCompany, active: true }).lean(),
    DaysOff.findOne({ company: currentCompany }).lean(),
    Service.find({ company: currentCompany, active: true }).select("_id name duration price employees").lean(),
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
  const view = req.query.view === "month" ? "month" : "week";
  // Rejeter "undefined" / dates invalides
  const rawDate = req.query.date;
  const parsedDate = rawDate && rawDate !== "undefined" ? new Date(rawDate + "T12:00:00") : null;
  const referenceDate = (parsedDate && !isNaN(parsedDate.getTime())) ? parsedDate : new Date();
  const focusedIso = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth()+1).padStart(2,"0")}-${String(referenceDate.getDate()).padStart(2,"0")}`;
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
  // ── Événements externes (Google Calendar) : bloquer les créneaux occupés sur l'agenda perso ──
  const companyForOwner = await Company.findById(currentCompany).select("owner").lean();
  if (companyForOwner?.owner) {
    const ownerUser = await User.findById(companyForOwner.owner).select("googleCalendar").lean();
    const gcal = ownerUser?.googleCalendar;
    if (gcal?.connected && gcal.refreshToken) {
      const toBrusselsMinutes = (date) => {
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", hour12: false,
        }).formatToParts(date);
        const h = Number(parts.find((p) => p.type === "hour").value);
        const m = Number(parts.find((p) => p.type === "minute").value);
        return h * 60 + m;
      };

      const busyByDay = await Promise.all(
        weekDays.map((d) => getBusyIntervals(gcal.refreshToken, d.isoDate))
      );

      weekDays.forEach((d, i) => {
        busyByDay[i].forEach((interval) => {
          const startMin = toBrusselsMinutes(interval.start);
          const endMin = toBrusselsMinutes(interval.end);
          if (endMin <= startMin) return;

          const slotStart = Math.floor(startMin / 30) * 30;
          const slotEnd = Math.max(Math.ceil(endMin / 30) * 30, slotStart + 30);

          // Ignore les créneaux déjà occupés par un RDV Branshee (déjà synchronisé vers Google)
          const overlapsExisting = formatted.some((a) => {
            if (a.isoDate !== d.isoDate) return false;
            const [ah, am] = a.startHour.split(":").map(Number);
            const aStart = ah * 60 + am;
            const aEnd = aStart + (a.slotTime || slotTime);
            return aStart < endMin && aEnd > startMin;
          });
          if (overlapsExisting) return;

          formatted.push({
            _id: `gcal-${d.isoDate}-${slotStart}`,
            name: "Autre événement",
            surname: "",
            isExternal: true,
            weekday: d.weekdayIndex,
            status: "external",
            slotTime: slotEnd - slotStart,
            serviceName: "",
            employeeId: "",
            employeeName: "",
            employeePhoto: "/images/no-user.webp",
            isoDate: d.isoDate,
            date: d.date,
            startHour: `${String(Math.floor(slotStart / 60)).padStart(2, "0")}:${String(slotStart % 60).padStart(2, "0")}`,
            endHour: `${String(Math.floor(slotEnd / 60)).padStart(2, "0")}:${String(slotEnd % 60).padStart(2, "0")}`,
          });
        });
      });
    }
  }

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

  // ── Données vue mois ────────────────────────────────────────────────────
  const monthDays = [];
  const mYear  = referenceDate.getFullYear();
  const mMonth = referenceDate.getMonth();
  const mFirst = new Date(mYear, mMonth, 1);
  const mLast  = new Date(mYear, mMonth + 1, 0);
  // Padding debut (lundi = 0)
  const startDow = (mFirst.getDay() + 6) % 7;
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(mYear, mMonth, -i);
    monthDays.push({ day: d.getDate(), iso: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`, current: false });
  }
  for (let d = 1; d <= mLast.getDate(); d++) {
    const iso = `${mYear}-${String(mMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const now = new Date(); const todayIso = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    monthDays.push({ day: d, iso, current: true, isToday: iso === todayIso });
  }
  while (monthDays.length < 42) {
    const prev = monthDays[monthDays.length - 1];
    const nd = new Date(prev.iso + "T12:00:00"); nd.setDate(nd.getDate() + 1);
    monthDays.push({ day: nd.getDate(), iso: `${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,"0")}-${String(nd.getDate()).padStart(2,"0")}`, current: false });
  }
  // Compter les RDV par jour pour le mois
  const apptByDay = {};
  formatted.forEach(a => { apptByDay[a.isoDate] = (apptByDay[a.isoDate] || 0) + 1; });
  monthDays.forEach(d => { d.count = apptByDay[d.iso] || 0; });
  const monthLabel = mFirst.toLocaleDateString(locale, { month: "long", year: "numeric" });

  // Mois prev/next (1er du mois)
  const prevMonth = new Date(mYear, mMonth - 1, 1);
  const nextMonth = new Date(mYear, mMonth + 1, 1);
  const prevMonthIso = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth()+1).padStart(2,"0")}-01`;
  const nextMonthIso = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth()+1).padStart(2,"0")}-01`;

  // Grille horaire : 30 min par défaut, mais on resserre le pas si des RDV
  // démarrent sur des minutes non multiples de 30 (ex: services de 15 min
  // qui débutent à :15 ou :45) afin qu'ils ne disparaissent jamais de la vue.
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  let gridStep = 30;
  formatted.forEach((a) => {
    const m = parseInt(a.startHour.split(":")[1], 10);
    if (!isNaN(m) && m !== 0) gridStep = gcd(gridStep, m);
  });
  if (gridStep === 0) gridStep = 30;

  res.render("admin/appointment", {
    pageName: "Appointment",
    title: res.locals.t.titles.calendar,
    slotTime,
    hours: generateTimeSlots(minHour, maxHour, gridStep),
    weekDays: weekDaysWithFill,
    appointments: formatted,
    weekLabel,
    dayLabel,
    focusedDayName,
    focusedDayDate,
    focusedIso,
    employees,
    employeeFilter,
    view,
    monthDays,
    monthLabel,
    prevMonthIso,
    nextMonthIso,
    services,
  });
};

// ── Création manuelle d'un rendez-vous depuis le panel admin ─────────────────
exports.createAdminBooking = async (req, res) => {
  try {
    const currentCompany = res.locals.currentCompany;
    if (!currentCompany) return res.status(401).json({ success: false, error: "unauthorized" });

    const {
      date, startTime, name, surname, phone, message,
      serviceId, employeeId,
    } = req.body;
    const rawEmail = req.body.email;
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : rawEmail;

    if (!date || !startTime || !name || !email) {
      return res.json({ success: false, error: "missing_fields", message: "Veuillez remplir tous les champs obligatoires." });
    }

    const Service = require("../db/models/company/service.model");
    const Employee = require("../db/models/company/employee.model");
    const Booking = require("../db/models/book.model");
    const pug = require("pug");
    const path = require("path");
    const { sendEmail } = require("../utils/mailer");

    const company = await Company.findById(currentCompany);
    if (!company) return res.json({ success: false, error: "company_not_found" });

    let serviceName = "";
    let actualDuration = company.slotTime || 60;
    if (serviceId) {
      const service = await Service.find({ _id: serviceId, company: currentCompany }).select("name duration").lean();
      const svc = service[0];
      if (svc) {
        serviceName = svc.name || "";
        actualDuration = svc.duration || actualDuration;
      }
    }

    let employeeName = "";
    if (employeeId) {
      const emp = await Employee.findOne({ _id: employeeId, company: currentCompany }).select("firstName lastName").lean();
      if (emp) employeeName = `${emp.firstName} ${emp.lastName}`.trim();
    }

    const [hours, minutes] = startTime.split(":").map(Number);
    const startTimeInMinutes = hours * 60 + minutes;
    const endTimeInMinutes = startTimeInMinutes + actualDuration;
    const endTime = `${String(Math.floor(endTimeInMinutes / 60)).padStart(2, "0")}:${String(endTimeInMinutes % 60).padStart(2, "0")}`;

    // ── Conflit : un même employé ne peut pas avoir deux RDV qui se chevauchent ──
    if (employeeId) {
      const overlapping = await Booking.find({
        company: currentCompany,
        date: new Date(date),
        status: { $ne: "canceled" },
        employee: employeeId,
      }).select("startTime slotTime").lean();

      const conflict = overlapping.some((b) => {
        const [bh, bm] = b.startTime.split(":").map(Number);
        const bStart = bh * 60 + bm;
        const bEnd = bStart + (b.slotTime || actualDuration);
        return startTimeInMinutes < bEnd && endTimeInMinutes > bStart;
      });
      if (conflict) {
        return res.json({ success: false, error: "conflict", message: "Cet employé a déjà un rendez-vous sur ce créneau." });
      }
    }

    const newBooking = await Booking.create({
      date: new Date(date),
      startTime,
      endTime,
      company: currentCompany,
      name,
      surname: surname || "",
      email,
      phone: phone || "",
      message: message || "",
      slotTime: actualDuration,
      status: "confirmed",
      service: serviceId || null,
      serviceName,
      employee: employeeId || null,
      employeeName,
      payment: { method: "none", status: "none", amount: 0, currency: "eur" },
    });

    const companyOwner = company.owner ? await User.findById(company.owner).lean() : null;

    let locationText = "";
    const loc = companyOwner?.location;
    if (loc?.serviceType === "en_ligne") {
      locationText = "En ligne";
    } else if (loc?.address || loc?.city) {
      locationText = [loc.address, loc.city].filter(Boolean).join(", ");
    }

    const baseUrl = process.env.BASE_URL || "https://www.branshee.com";
    const cancelUrl = `${baseUrl}/cancel-booking/${newBooking._id}?token=${newBooking.cancelToken}`;
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
        serviceName,
        employeeName,
        formAnswers: [],
        locationText,
        cancelUrl,
        bookingId: newBooking._id,
        cancelToken: newBooking.cancelToken,
      },
    );

    await sendEmail(email, "Confirmation de votre rendez-vous — BranShee", htmlTemplate);

    // ── SMS de confirmation au client (fonctionnalité cachée, désactivée par défaut) ──
    try {
      if (phone && (await isFeatureEnabled("sms_notifications"))) {
        const { sendSms } = require("../utils/sms");
        await sendSms(
          phone,
          `BranShee : votre rendez-vous est confirmé pour le ${formattedDate} à ${startTime}.`,
        );
      }
    } catch (smsErr) {
      console.error("SMS confirmation error:", smsErr.message);
    }

    try {
      if (companyOwner?.googleCalendar?.connected && companyOwner.googleCalendar.refreshToken) {
        const eventId = await addEventToCalendar(companyOwner.googleCalendar.refreshToken, newBooking);
        if (eventId) {
          await Booking.findByIdAndUpdate(newBooking._id, { googleEventId: eventId });
        }
      }
    } catch (gcalErr) {
      console.error("Google Calendar sync error (admin create):", gcalErr.message);
    }

    res.json({ success: true, bookingId: newBooking._id });
  } catch (err) {
    console.error("createAdminBooking error:", err);
    res.status(500).json({ success: false, error: "server_error", message: "Une erreur est survenue." });
  }
};

const Company = require("../db/models/company/company.model");
const User = require("../db/models/user.model");
const { addEventToCalendar, deleteEventFromCalendar, updateEventInCalendar, getBusyIntervals } = require("../utils/googleCalendarSync");

exports.client = (req, res) => {
  res.render("admin/client", {
    pageName: "Clients",
  });
};

async function getSlotTime(companyId) {
  const res = await Company.findById(companyId).select("slotTime").lean();

  return res?.slotTime;
}

async function getSlotConfig(companyId) {
  const res = await Company.findById(companyId)
    .select("bufferTime bufferBefore bufferAfter slotMode slotInterval")
    .lean();

  return {
    bufferBefore: res?.bufferBefore ?? res?.bufferTime ?? 0,
    bufferAfter:  res?.bufferAfter  ?? res?.bufferTime ?? 0,
    slotMode:     res?.slotMode || "fixed",
    slotInterval: res?.slotInterval || 30,
  };
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
  const [daysOff, currentSlotTime, slotConfig, serviceCount, activeEmployees] = await Promise.all([
    getDaysOff(currentCompany),
    getSlotTime(currentCompany),
    getSlotConfig(currentCompany),
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
    bufferBefore: slotConfig.bufferBefore,
    bufferAfter: slotConfig.bufferAfter,
    slotMode: slotConfig.slotMode,
    slotInterval: slotConfig.slotInterval,
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

exports.sendManualReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const Service = require("../db/models/company/service.model");

    const booking = await Booking.findById(id).lean();
    if (!booking) return res.status(404).json({ error: "Rendez-vous introuvable." });
    if (!booking.email) return res.status(400).json({ error: "Ce rendez-vous n'a pas d'adresse email." });
    if (booking.status !== "confirmed") return res.status(400).json({ error: "Le rendez-vous doit être confirmé." });

    // Verify ownership
    const companyDoc = await Company.findById(booking.company).lean();
    if (!companyDoc || String(companyDoc.owner) !== String(req.user._id)) {
      return res.status(403).json({ error: "Accès refusé." });
    }

    const owner = await User.findById(companyDoc.owner)
      .select("calendarSettings location isPremium manualPremium subscription")
      .lean();

    if (!atLeast(owner, "pro")) {
      return res.status(403).json({ error: "plan_limit", message: "Nécessite un abonnement Pro ou Business." });
    }

    // Service category lookup
    let serviceCategory = "";
    if (booking.service) {
      try {
        const svc = await Service.findById(booking.service).select("category").lean();
        serviceCategory = svc?.category || "";
      } catch (_) {}
    }

    const servicePrice = booking.payment?.amount ? Number(booking.payment.amount) : null;
    const ownerMessage = (owner?.calendarSettings?.reminderMessage || "").trim();
    const paymentMethods = Array.isArray(owner?.calendarSettings?.reminderPaymentMethods)
      ? owner.calendarSettings.reminderPaymentMethods : [];
    const paymentNote = (owner?.calendarSettings?.reminderPaymentNote || "").trim();

    const loc = owner?.location;
    let locationText = "";
    if (loc?.serviceType === "en_ligne") {
      locationText = "En ligne";
    } else if (loc?.address || loc?.city) {
      locationText = [loc.address, loc.city].filter(Boolean).join(", ");
    }

    const formattedDate = new Date(booking.date).toLocaleDateString("fr-FR", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    });

    const templatePath = path.join(__dirname, "../views/templates/emails/booking-reminder.pug");
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
      delayLabel: "bientôt",
      bookingId: booking._id,
      cancelToken: booking.cancelToken,
      baseUrl: (process.env.BASE_URL || "https://www.branshee.com").replace(/\/$/, ""),
    });

    const ok = await sendEmail(booking.email, "Rappel : votre rendez-vous — BranShee", html);
    if (!ok) return res.status(500).json({ error: "Échec de l'envoi de l'email." });

    await Booking.findByIdAndUpdate(id, { manualReminderSent: true, reminderSent: true });
    return res.json({ success: true });
  } catch (err) {
    console.error("sendManualReminder error:", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
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

// ── Helper : récupérer les cartes enregistrées d'un utilisateur (Stripe) ─────
// Utilisé sur /subscription pour proposer "payer avec la carte X ou en
// changer" + le récap avant paiement, au lieu de débiter instantanément
// dès qu'une carte existe ("c'est abusé, faut demander avant").
exports.getUserPaymentMethods = async function (user) {
  const stripeCustomerId = user?.subscription?.stripeCustomerId;
  if (!stripeCustomerId) return [];
  try {
    const [pmsResult, customer] = await Promise.all([
      stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card", limit: 10 }),
      stripe.customers.retrieve(stripeCustomerId),
    ]);

    let defaultPmId = customer.invoice_settings?.default_payment_method || null;
    if (!defaultPmId && user.subscription?.stripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(user.subscription.stripeSubscriptionId);
        defaultPmId = sub.default_payment_method || null;
      } catch (_) {}
    }
    if (!defaultPmId && pmsResult.data.length === 1) {
      defaultPmId = pmsResult.data[0].id;
    }

    return pmsResult.data.map((pm) => ({
      id:        pm.id,
      brand:     pm.card.brand,
      last4:     pm.card.last4,
      expMonth:  pm.card.exp_month,
      expYear:   pm.card.exp_year,
      isDefault: pm.id === defaultPmId,
    }));
  } catch (e) {
    console.error("getUserPaymentMethods error:", e.message);
    return [];
  }
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
  // Générer un code de parrainage si l'utilisateur n'en a pas encore
  if (!req.user.referralCode) {
    const crypto = require("crypto");
    const base = (req.user.fullName || "USER").trim().split(" ")[0]
      .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
    let code;
    for (let i = 0; i < 10; i++) {
      code = `${base}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      const exists = await User.exists({ referralCode: code });
      if (!exists) break;
    }
    req.user.referralCode = code;
    await User.findByIdAndUpdate(req.user._id, { referralCode: code });
  }

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

    const response = await Booking.findByIdAndUpdate(id, updateFields, { new: true }).lean();

    // ── Sync Google Calendar ──────────────────────────────────────────────────
    if (response) {
      try {
        const companyDoc = await Company.findById(response.company);
        const owner = await User.findById(companyDoc?.owner);
        if (owner?.googleCalendar?.connected && owner.googleCalendar.refreshToken) {
          const refreshToken = owner.googleCalendar.refreshToken;

          if (response.status === "canceled") {
            // Annulé/supprimé via l'admin → retirer de Google Calendar
            if (response.googleEventId) {
              await deleteEventFromCalendar(refreshToken, response.googleEventId);
              await Booking.findByIdAndUpdate(id, { googleEventId: "" });
            }
          } else {
            // Confirmé : mettre à jour (ou créer si l'événement n'existait pas, ex. réactivé)
            const eventId = await updateEventInCalendar(refreshToken, response.googleEventId, response);
            if (eventId && eventId !== response.googleEventId) {
              await Booking.findByIdAndUpdate(id, { googleEventId: eventId });
            }
          }
        }
      } catch (gcalErr) {
        console.error("Google Calendar sync error (edit):", gcalErr.message);
      }

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

  // Sans session_id on ne peut rien vérifier
  if (!session_id) {
    console.warn("[paymentVerification] Pas de session_id dans l'URL");
    return renderSuccess();
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(session_id);
  } catch (retrieveErr) {
    console.error("[paymentVerification] Impossible de récupérer la session Stripe:", retrieveErr.message);
    return renderSuccess();
  }

  console.log(`[paymentVerification] session=${session_id} payment_status=${session.payment_status} amount=${session.amount_total} customer=${session.customer} subscription=${session.subscription}`);

  // Accepter "paid" ET "no_payment_required" (promo 100%, achat 0€)
  const validStatus = ["paid", "no_payment_required"];
  if (!validStatus.includes(session.payment_status)) {
    console.warn("[paymentVerification] payment_status non valide:", session.payment_status);
    return res.redirect("/subscription");
  }

  // ── Déterminer le plan ─────────────────────────────────────────────────────
  // Priorité : metadata du checkout (toujours dispo) → line items → fallback "pro"
  let planName = session.metadata?.plan || null;

  if (!planName) {
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session_id, { limit: 5 });
      const priceId = lineItems.data[0]?.price?.id || "";
      const isBusinessPrice = [
        env.stripePriceBusinessMonthly,
        env.stripePriceBusinessYearly,
      ].filter(Boolean).includes(priceId);
      planName = isBusinessPrice ? "business" : "pro";
    } catch (liErr) {
      console.error("[paymentVerification] listLineItems error:", liErr.message);
      planName = "pro"; // fallback
    }
  }

  console.log(`[paymentVerification] plan détecté: ${planName}`);

  // ── Activer le plan ────────────────────────────────────────────────────────
  const Subscription = require("../db/models/subscription.model");
  const userId = session.client_reference_id || session.metadata?.userId || (req.user && req.user._id.toString());

  if (!userId) {
    console.error("[paymentVerification] userId introuvable — plan NON activé");
    return renderSuccess();
  }

  try {
    await User.findByIdAndUpdate(userId, {
      isPremium:                           true,
      manualPremium:                       false,
      "subscription.plan":                 planName,
      "subscription.status":               "active",
      "subscription.stripeCustomerId":     session.customer,
      "subscription.stripeSubscriptionId": session.subscription || null,
    });

    await Subscription.updateMany(
      { user: userId, status: "active" },
      { status: "superseded" }
    );

    const expDate = new Date();
    expDate.setMonth(expDate.getMonth() + 1);
    await Subscription.findOneAndUpdate(
      { user: userId, stripeSubscriptionId: session.subscription || `manual_${session_id}` },
      {
        user:                userId,
        plan:                planName,
        status:              "active",
        startDate:           new Date(),
        endDate:             expDate,
        stripeCustomerId:    session.customer,
        stripeSubscriptionId: session.subscription || null,
        amount:              (session.amount_total || 0) / 100,
        currency:            session.currency || "eur",
      },
      { upsert: true, new: true }
    );

    // Mettre à jour la session Express en cours pour affichage immédiat
    if (req.user) {
      req.user.isPremium = true;
      req.user.subscription = req.user.subscription || {};
      req.user.subscription.plan   = planName;
      req.user.subscription.status = "active";
    }

    console.log(`✅ [paymentVerification] Plan "${planName}" activé pour user ${userId}`);
    const { enforcePlanLimits } = require("./account.controller");
    enforcePlanLimits(userId, planName).catch(() => {});

    // ── Incrémenter l'utilisation du code promo maintenant que le paiement
    //    est confirmé (évite de compter les abandons sur la page Stripe).
    const promoCodeId = session.metadata?.promoCodeId;
    if (promoCodeId) {
      try {
        const PromoCode = require("../db/models/promoCode.model");
        await PromoCode.findByIdAndUpdate(promoCodeId, {
          $inc: { usedCount: 1 },
          $addToSet: { usedByUsers: userId },
        });
        console.log(`✅ [paymentVerification] PromoCode ${promoCodeId} usage enregistré`);
      } catch (promoErr) {
        console.error("[paymentVerification] Erreur MAJ promo:", promoErr.message);
      }
    }
  } catch (dbErr) {
    console.error("[paymentVerification] Erreur DB:", dbErr.message);
  }

  return renderSuccess();
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

    // Plan Basic (maxQuestions === 0) : on affiche quand même un aperçu
    // (verrouillé) de la fonctionnalité avec des questions de démonstration,
    // au lieu de la cacher complètement derrière un message "Fonctionnalité
    // Pro" — l'utilisateur voit concrètement ce que le plan Pro débloque,
    // ce qui est un meilleur argument d'upsell ("laisser l'utilisateur voir
    // la fonctionnalité, juste sans pouvoir l'utiliser tant qu'il ne paie pas").
    const demoForm = {
      active: false,
      questions: [
        { label: "Avez-vous déjà visité notre établissement ?", type: "yes_no", required: true },
        { label: "Quel est le motif de votre visite ?", type: "text", required: false },
        {
          label: "Comment avez-vous entendu parler de nous ?",
          type: "choice",
          required: false,
          options: ["Bouche-à-oreille", "Réseaux sociaux", "Recherche Google"],
        },
      ],
    };

    return res.render("admin/forms", {
      pageName: res.locals.t.sidebar.a_9,
      form: maxQuestions === 0 ? demoForm : (form || null),
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
  const defaultOrder    = ['about', 'location', 'hours', 'gallery', 'reviews'];
  const sectionOrder    = cs.sectionOrder && cs.sectionOrder.length ? cs.sectionOrder : defaultOrder;
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
    sectionOrder,
  });
};

exports.saveSectionOrder = async (req, res) => {
  try {
    const allowed = ['about', 'location', 'hours', 'gallery', 'reviews'];
    const order   = (req.body.order || []).filter(s => allowed.includes(s));
    if (!order.length) return res.status(400).json({ error: "Ordre invalide." });
    await User.findByIdAndUpdate(req.user._id, {
      "calendarSettings.sectionOrder": order,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Paramètres pré-paiement ───────────────────────────────────────────────────
exports.saveNotificationSettings = async (req, res) => {
  try {
    const { newBooking } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      "notifications.newBooking": !!newBooking,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("saveNotificationSettings error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

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

// ── Politique d'annulation ────────────────────────────────────────────────────
exports.saveCancellationPolicy = async (req, res) => {
  try {
    const { rule } = req.body;
    const validRules = ["free", "half_24h", "full_12h"];
    if (!validRules.includes(rule)) return res.status(400).json({ error: "Règle invalide." });
    await Company.findByIdAndUpdate(res.locals.currentCompany._id, {
      "cancellationPolicy.rule": rule,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("saveCancellationPolicy error:", err);
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
