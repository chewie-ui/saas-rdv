const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const Stripe = require("stripe");

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

  const client = await Booking.findById(bookId);
  console.log(client);

  const company = await Company.findOne(
    {
      _id: res.locals.currentCompany._id,
      "employees.user": req.user._id,
    },
    {
      "employees.$": 1,
    },
  ).lean();
  console.log(company);

  const grade = company?.employees[0]?.grade;
  console.log(grade);

  res.render("admin/book", {
    pageName: "Book",
    title: res.locals.t.titles.book,
    client,
    grade,
    isPremium: res.locals.user.isPremium,
  });
  // await sendEmail("quentin.rennies@gmail.com", "MAJ Horraire", htmlTemplate);
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

    week.push({
      label: d.toLocaleDateString(locale, { weekday: "short" }),
      initial: d.toLocaleDateString(locale, { weekday: "narrow" }),
      longLabel: d.toLocaleDateString(locale, { weekday: "long" }),
      date: d.toLocaleDateString(locale, {
        day: "numeric",
        month: "long",
      }),
      dayNumber: d.getDate(),
      iso: d.toISOString(),
      isoDate: d.toISOString().split("T")[0],
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
  const apps = await GetAllAppointments(currentCompany);
  const rowTime = await Company.findById(currentCompany).select("slotTime schedule").lean();
  const slotTime = rowTime.slotTime || 60;

  const formatted = apps.map((appointment) => {
    const [h, m] = appointment.startTime.split(":").map(Number);

    // reconstruire la date complète
    const startDate = new Date(appointment.date.getFullYear(), appointment.date.getMonth(), appointment.date.getDate(), h, m, 0, 0);

    // end = +1h (pour l’instant)
    const endDate = new Date(startDate);
    endDate.setMinutes(endDate.getMinutes() + slotTime);

    return {
      _id: appointment._id,
      name: appointment.name,
      surname: appointment.surname,
      email: appointment.email,
      phone: appointment.phone,
      message: appointment.message,
      weekday: (startDate.getDay() + 6) % 7,
      status: appointment.status,

      slotTime: appointment.slotTime,
      isoDate: startDate.toISOString().split("T")[0],
      date: startDate.toLocaleDateString("fr-BE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),

      startHour: startDate.toLocaleTimeString("fr-BE", {
        hour: "2-digit",
        minute: "2-digit",
      }),

      endHour: endDate.toLocaleTimeString("fr-BE", {
        hour: "2-digit",
        minute: "2-digit",
      }),
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

  const hoursList = formatted.map((a) => {
    const [h] = a.startHour.split(":").map(Number);
    return h;
  });

  const apptMin = hoursList.length > 0 ? Math.min(...hoursList) : null;
  const apptMax = hoursList.length > 0 ? Math.max(...hoursList) + 1 : null;

  const minHour = scheduleMin !== null ? Math.min(scheduleMin, apptMin !== null ? apptMin : scheduleMin) : apptMin !== null ? apptMin : 8;
  const maxHour = scheduleMax !== null ? Math.max(scheduleMax, apptMax !== null ? apptMax : scheduleMax) : apptMax !== null ? apptMax : 18;
  res.render("admin/appointment", {
    pageName: "Appointment",
    title: res.locals.t.titles.calendar,
    slotTime,
    hours: generateTimeSlots(minHour, maxHour, slotTime),
    weekDays,
    appointments: formatted,
    weekLabel,
    dayLabel,
    focusedDayName,
    focusedDayDate,
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
  const doc = await DaysOff.findOne({ company: companyId }).select("dates");

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
  res.render("admin/availability", {
    daysOff: await getDaysOff(currentCompany),
    pageName: "Availability",
    title: res.locals.t.titles.avail,
    timeSlot: [10, 15, 20, 25, 30, 45, 60, 90, 120, 180],
    hours: generateHours(10),
    currentSlotTime: await getSlotTime(currentCompany),
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

  res.json({ success: true });
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

exports.informationsPage = (req, res) => {
  const email = req.user.email;
  const maskEmail = email.replace(/^(..)(.*)(?=@)/, "$1...");

  res.render("admin/informations", {
    pageName: "Informations",
    success: req.query.success,
    title: res.locals.t.titles.infos,
    maskEmail,
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

    const results = await Booking.findById(id);

    return res.render("admin/history-edit", {
      rowId: id,
      pageName: "History",
      title: res.locals.t.titles.history,
      results,
    });
  } catch (err) {
    console.error(err);
    return res.json({ err });
  }
};

exports.settingsInit = async (req, res) => {
  console.log({ path: "admin/settings" });

  return res.render("admin/settings", {
    pageName: "Settings",
    title: "Settings",
  });
};

exports.historyEditRowPatch = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, phone, message, date, startTime } = req.body;
    const parts = fullName.trim().split(" ");
    const name = parts[0];
    const surname = parts.slice(1).join(" ") || "";

    const updateFields = { name, surname, phone, email, message };
    if (date) updateFields.date = new Date(date);
    if (startTime) updateFields.startTime = startTime;

    const response = await Booking.findByIdAndUpdate(id, updateFields);

    if (response) {
      return res.json({ success: true });
    }
  } catch (err) {
    console.error(err);
    return res.json({ err });
  }
};

exports.paymentVerification = async (req, res) => {
  const { session_id } = req.query;

  if (!session_id) return res.redirect("/subscription");
  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status === "paid") {
      return res.render("admin/payment-success");
    } else {
      return res.redirect("/subscription");
    }
  } catch (err) {}
  return res.redirect("/subscription");
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
  try {
    const companyId = res.locals.currentCompany._id;
    const form = await Form.findOne({ company: companyId }).lean();
    return res.render("admin/forms", {
      pageName: res.locals.t.sidebar.a_9,
      form: form || null,
    });
  } catch (err) {
    console.error(err);
    return res.render("admin/forms", {
      pageName: res.locals.t.sidebar.a_9,
      form: null,
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
  try {
    const companyId = res.locals.currentCompany._id;
    const { active, questions } = req.body;

    const form = await Form.findOneAndUpdate(
      { company: companyId },
      { active, questions },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, form });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, err: err.message });
  }
};
