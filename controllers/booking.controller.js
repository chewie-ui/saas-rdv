const Booking = require("../db/models/book.model");
const Company = require("../db/models/company/company.model");
const DaysOff = require("../db/models/company/daysOff.model");
const { getAppointments } = require("../queries/booking.queries");

exports.createBooking = async (req, res) => {
  try {
    const { date, startTime, company, name, surname, email, phone, message } =
      req.body;

    const response = await Company.findById(company);
    const slotTime = response.slotTime;
    const [hours, minutes] = startTime.split(":").map(Number);
    const startTimeInMinutes = hours * 60 + minutes;

    // 2. Ajouter le slotTime
    const endTimeInMinutes = startTimeInMinutes + slotTime;

    // 3. Reconvertir en format HH:MM
    const endHours = Math.floor(endTimeInMinutes / 60);
    const endMinutes = endTimeInMinutes % 60;

    // 4. Formater avec des zéros devant (ex: "09:05")
    const endTime = `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;

    console.log("Start:", startTime); // "08:30"
    console.log("End:", endTime);
    await Booking.create({
      date: new Date(date),
      startTime,
      company,
      name,
      surname,
      email,
      phone,
      message,
      slotTime,
      endTime,
      status: "confirmed",
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
  }).select("startTime -_id");

  res.json({
    bookedTimes: bookings.map((b) => b.startTime),
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
  const { index, COMPANY_ID, date } = req.body;

  // 1. Récupérer la config de base (pour le slotTime et les horaires par défaut)
  const company = await Company.findById(COMPANY_ID)
    .select("schedule slotTime")
    .lean();

  // 2. CHERCHER UNE EXCEPTION (DaysOff)
  // On nettoie la date reçue pour comparer uniquement Jour/Mois/Année
  const searchDate = new Date(date);
  searchDate.setHours(0, 0, 0, 0);

  const exceptionsDoc = await DaysOff.findOne({ company: COMPANY_ID });
  let target = company.schedule[index]; // Par défaut

  if (exceptionsDoc && exceptionsDoc.dates) {
    const specificDate = exceptionsDoc.dates.find((d) => {
      const dDate = new Date(d.date);
      dDate.setHours(0, 0, 0, 0);
      return dDate.getTime() === searchDate.getTime();
    });

    // Si on a trouvé une exception (comme ton 25 mars), on remplace le "target"
    if (specificDate) {
      target = specificDate;
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

  let allSlots = [];
  target.workingHours.forEach((period) => {
    const [startH, startM] = period.start.split(":").map(Number);
    const [endH, endM] = period.end.split(":").map(Number);

    let current = startH * 60 + startM;
    const endTotal = endH * 60 + endM;

    while (current + company.slotTime <= endTotal) {
      const h = Math.floor(current / 60);
      const m = current % 60;
      allSlots.push(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      );
      current += company.slotTime;
    }
  });

  res.json({ slots: allSlots });
};

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
  });

  res.json(doc);
};
