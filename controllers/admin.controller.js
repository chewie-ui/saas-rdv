const {
  getAppointments,
  GetAllAppointments,
} = require("../queries/booking.queries");
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
const htmlTemplate = pug.renderFile(
  path.join(__dirname, "../views/templates/emails/booking-confirmed.pug"),
  { hour: "22:30" },
);
exports.book = async (req, res) => {
  const { bookId } = req.params;

  const user = await Booking.findById(bookId);
  const company = await Company.findOne(
    {
      _id: res.locals.currentCompany._id,
      "employees.user": req.user._id,
    },
    {
      "employees.$": 1,
    },
  ).lean();

  const grade = company?.employees[0]?.grade;

  res.render("admin/book", {
    pageName: "Book",
    user,
    grade,
  });
  await sendEmail("quentin.rennies@gmail.com", "MAJ Horraire", htmlTemplate);
};

function getWeekDays(startDate = new Date()) {
  const week = [];
  const monday = new Date(startDate);

  const today = new Date(); // 👈 aujourd'hui

  // Revenir au lundi
  const day = monday.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);

    const isToday =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();

    week.push({
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      date: d.toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
      }),
      iso: d.toISOString(),
      isToday, // 👈 AJOUT IMPORTANT
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
  const rowTime = await Company.findById(currentCompany)
    .select("slotTime")
    .lean();
  const slotTime = rowTime.slotTime || 60;

  const formatted = apps.map((appointment) => {
    const [h, m] = appointment.startTime.split(":").map(Number);

    // reconstruire la date complète
    const startDate = new Date(
      appointment.date.getFullYear(),
      appointment.date.getMonth(),
      appointment.date.getDate(),
      h,
      m,
      0,
      0,
    );

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
  const firstDay = getWeekDays(referenceDate)[0];
  const lastDay = getWeekDays(referenceDate)[6];
  const weekLabel = `${firstDay.label} ${firstDay.date} - ${lastDay.label} ${lastDay.date}`;
  const hoursList = formatted.map((a) => {
    const [h] = a.startHour.split(":").map(Number);
    return h;
  });

  const minHour = Math.min(...hoursList);
  const maxHour = Math.max(...hoursList) + 1;
  res.render("admin/appointment", {
    pageName: "Appointment",
    slotTime,
    hours: generateTimeSlots(minHour, maxHour, slotTime),

    weekDays: getWeekDays(referenceDate),
    appointments: formatted,
    weekLabel,
  });
};

const Company = require("../db/models/company/company.model");
const User = require("../db/models/user.model");

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
    title: "Availability",
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

exports.joinCompany = (req, res) => {
  res.render("admin/join-company");
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

  res.json({ success: true, data });
};

exports.restoreBooking = async (req, res) => {
  const { bookId } = req.params;

  await Booking.findByIdAndUpdate(bookId, {
    status: "confirmed",
  });

  res.json({ success: true });
};

exports.cancelBooking = async (req, res) => {
  const { id } = req.params;
  await Booking.findByIdAndUpdate(id, {
    status: "canceled",
  });

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
  res.render("admin/informations", {
    pageName: "Informations",
    success: req.query.success,
  });
};
