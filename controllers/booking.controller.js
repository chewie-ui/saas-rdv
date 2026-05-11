const Booking = require("../db/models/book.model");
const User = require("../db/models/user.model");
const Company = require("../db/models/company/company.model");
const Employee = require("../db/models/company/employee.model");
const { addEventToCalendar, deleteEventFromCalendar } = require("../utils/googleCalendarSync");
const DaysOff = require("../db/models/company/daysOff.model");
const { getAppointments } = require("../queries/booking.queries");
const pug = require("pug");
const path = require("path");

const { sendEmail } = require("../utils/mailer");
const { log } = require("console");

exports.createBooking = async (req, res) => {
  try {
    const { date, startTime, company, name, surname, email, phone, message, formAnswers,
            serviceId, serviceName, serviceDuration } = req.body;

    // employeeId / employeeName may be auto-resolved below — use let
    let employeeId   = req.body.employeeId   || null;
    let employeeName = req.body.employeeName || "";

    const response = await Company.findById(company);
    const companySlotTime = response.slotTime;

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
    });

    const htmlTemplate = pug.renderFile(
      path.join(__dirname, "../views/templates/emails/booking-confirmed.pug"),
      {
        name,
        surname,
        date,
        startHour: startTime,
        message,
        endHour: endTime,
        slotTime: actualDuration,
        bookingId: newBooking._id,
        cancelToken: newBooking.cancelToken,
      },
    );

    await sendEmail(email, "Appointement Confirmation", htmlTemplate);

    // Sync Google Calendar
    try {
      const companyOwner = await User.findById(response.owner);
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

  // Get company slotTime so we can compute slot granularity.
  const [companyDoc, activeEmployeeCount] = await Promise.all([
    Company.findById(companyId).select("slotTime").lean(),
    // Only count employees when no specific one is filtered
    specificEmployee ? Promise.resolve(0) : Employee.countDocuments({ company: companyId, active: true }),
  ]);

  const granularity = (serviceDuration && Number(serviceDuration) > 0)
    ? Number(serviceDuration)
    : (companyDoc?.slotTime || 30);

  // ── Case 1: specific employee selected → block only their slots ──────────
  if (specificEmployee) {
    const bookings = await Booking.find({ ...baseQuery, employee: employeeId }).select("startTime slotTime");
    const blockedSet = new Set();
    bookings.forEach((b) => {
      const [h, m] = b.startTime.split(":").map(Number);
      const startMin = h * 60 + m;
      const endMin   = startMin + (b.slotTime || granularity);
      for (let t = startMin; t < endMin; t += granularity) {
        blockedSet.add(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
      }
    });
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
        blockedSet.add(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
      }
    });
    return res.json({ bookedTimes: Array.from(blockedSet) });
  }

  // ── Case 3: company has employees, no filter → block slot only when ALL are busy ──
  // Fetch all confirmed bookings for the date that belong to an active employee
  const activeEmployees = await Employee.find({ company: companyId, active: true }).select("_id").lean();
  const activeIds = activeEmployees.map((e) => String(e._id));

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
  const { index, COMPANY_ID, date, serviceDuration } = req.body;
  const jsWeekdayIndex = parseInt(index);
  // 1. Récupérer la config de base (pour le slotTime et les horaires par défaut)
  const company = await Company.findById(COMPANY_ID)
    .select("schedule slotTime")
    .lean();

  // 2. CHERCHER UNE EXCEPTION (DaysOff)
  // Comparaison par date ISO UTC → timezone-safe quel que soit le serveur
  const searchDateStr = new Date(date).toISOString().split("T")[0];

  const exceptionsDoc = await DaysOff.findOne({ company: COMPANY_ID });
  let target = company.schedule.find((d) => d.weekdayIndex === jsWeekdayIndex);

  if (exceptionsDoc && exceptionsDoc.dates) {
    const specificDate = exceptionsDoc.dates.find((d) =>
      new Date(d.date).toISOString().split("T")[0] === searchDateStr
    );

    if (specificDate) {
      // Si l'exception a des horaires spécifiques → utiliser ces horaires (journée partielle)
      // Si l'exception est dayOff sans horaires → jour bloqué complètement
      if (specificDate.workingHours && specificDate.workingHours.length > 0 &&
          specificDate.workingHours[0].start) {
        target = specificDate; // Journée avec horaires spéciaux
      } else {
        return res.json({ slots: [] }); // Jour complètement bloqué
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

  const doc = await DaysOff.findOne({ company: companyId }).select("dates");
  return res.json(doc ? doc.dates : []);
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
  console.log(token);
  console.log(userId);

  const canceledBooking = await Booking.findOneAndUpdate(
    { _id: userId, cancelToken: token },
    { status: "canceled" },
    { new: false },
  ).lean();
  console.log({ "booking infos": canceledBooking });

  if (!canceledBooking) {
    return res.status(404).render("client/404.pug", {
      message: "Lien d'annulation invalide ou déjà utilisé.",
    });
  }

  const company = await Company.findById(canceledBooking.company);
  const coach = await User.findById(company.owner);

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
