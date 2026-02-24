const Booking = require("../db/models/book.model");
const Company = require("../db/models/company/company.model");
const { getAppointments } = require("../queries/booking.queries");

exports.createBooking = async (req, res) => {
  try {
    const { date, time, company, name, surname, email, phone, message } =
      req.body;

    await Booking.create({
      date: new Date(date),
      time,
      company,
      name,
      surname,
      email,
      phone,
      message,
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: "this booking is unavailable" });
  }
};

exports.getBooking = async (req, res) => {
  const { date } = req.query;

  const bookings = await Booking.find({
    date: new Date(date),
  }).select("time -_id");

  res.json({
    bookedTimes: bookings.map((b) => b.time),
  });
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
    const [h, m] = appointment.time.split(":").map(Number);

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
  const { index, COMPANY_ID } = req.body;

  const company = await Company.findById(COMPANY_ID).select("schedule");
  const result = await company.schedule;

  const target = result[index];
  console.log("target", target);

  const workingHours = target.workingHours[0];
  console.log("workingHours", workingHours);

  const start = workingHours.start; // "08:00"
  const end = workingHours.end;
  const slots = [];

  let [startHour, startMin] = start.split(":").map(Number);
  let [endHour, endMin] = end.split(":").map(Number);

  let current = new Date();
  current.setHours(startHour, startMin, 0, 0);

  const endTime = new Date();
  endTime.setHours(endHour, endMin, 0, 0);

  while (current < endTime) {
    const hour = String(current.getHours()).padStart(2, "0");
    const min = String(current.getMinutes()).padStart(2, "0");

    slots.push(`${hour}:${min}`);

    current.setMinutes(current.getMinutes() + 30);
  }

  res.json({ slots });
};

exports.getDaysOff = async (req, res) => {
  const { COMPANY_ID } = req.body;
  const result = await Company.findById(COMPANY_ID).select("schedule");

  return res.json({ result });
};
