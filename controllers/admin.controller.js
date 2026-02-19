const {
  getAppointments,
  GetAllAppointments,
} = require("../queries/booking.queries");

exports.panel = (req, res) => {
  res.render("admin/panel", {
    pageName: "Dashboard",
    appointments: req.appointments,
  });
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

exports.appointment = async (req, res) => {
  const apps = await GetAllAppointments();
  console.log(apps);

  const formatted = apps.map((appointment) => {
    const [h, m] = appointment.time.split(":").map(Number);

    // reconstruire la date complète
    const startDate = new Date(appointment.date);
    startDate.setHours(h, m, 0, 0);

    // end = +1h (pour l’instant)
    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 1);

    return {
      name: "Docteur Fring",

      weekday: (startDate.getDay() + 6) % 7, // ✅ FIX

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

  res.render("admin/appointment", {
    pageName: "Appointment",
    hours: [
      "06:00",
      "07:00",
      "08:00",
      "09:00",
      "10:00",
      "11:00",
      "12:00",
      "13:00",
      "14:00",
      "15:00",
      "16:00",
      "17:00",
      "18:00",
      "19:00",
      "20:00",
    ],
    weekDays: getWeekDays(),

    appointments: formatted,
  });
};

const countries = require("i18n-iso-countries");
countries.registerLocale(require("i18n-iso-countries/langs/en.json"));
const countryList = countries.getNames("en", { select: "official" });
const moment = require("moment-timezone");

const timezones = moment.tz.names().map((tz) => {
  const offset = moment.tz(tz).format("Z"); // -05:00
  return {
    name: tz,
    label: `(GMT ${offset}) - ${tz}`,
  };
});

function generateDefaultSchedule() {
  return Array.from({ length: 7 }, (_, i) => ({
    weekdayIndex: i,
    dayOff: i === 0, // dimanche OFF
    workingHours: [
      {
        start: "08:00",
        end: "17:00",
      },
    ],
  }));
}

exports.createCompany = (req, res) => {
  res.render("admin/create-company", {
    countries: countryList,
    timezones,
    defaultCountry: "Belgium",
    defaultTimezone: "Europe/Brussels",
  });
};

const Company = require("../db/models/company/company.model");
const User = require("../db/models/user.model");

exports.companySchedule = (req, res) => {
  res.render("admin/company-schedule");
};

exports.companyAddress = (req, res) => {
  res.render("admin/company-address");
};

exports.firstSetupCompany = async (req, res) => {
  console.log(generateDefaultSchedule());

  try {
    const { name, country, timezone, services } = req.body;

    const company = await Company.create({
      name,
      owner: req.user._id,
      informations: {
        country,
        timezone,
        services: services,
      },
      schedule: generateDefaultSchedule(),
      employees: req.user._id,
    });
    req.session.companyId = company._id;

    await User.findByIdAndUpdate(req.user._id, {
      $push: {
        companies: {
          role: "owner",
          company: company._id,
          status: "active",
        },
      },
    });

    res.redirect("company-address");
  } catch (err) {
    console.error(err);

    if (err.code === 11000) {
      return res.render("admin/create-company", {
        countries: countryList,
        timezones,
        defaultCountry: "Belgium",
        defaultTimezone: "Europe/Brussels",
        error: "Company name already used",
      });
    }
    res.redirect("/create-company");
  }
};

exports.secondSetupCompany = async (req, res) => {
  try {
    const { street, city, zip } = req.body;
    const companyId = req.session.companyId;

    await Company.findByIdAndUpdate(companyId, {
      $set: {
        "informations.address": {
          street,
          city,
          zip,
        },
      },
    });

    res.redirect("/panel");
  } catch (err) {
    res.json({ err });
  }
};

exports.client = (req, res) => {
  res.render("admin/client", {
    pageName: "Clients",
  });
};

exports.employees = async (req, res) => {
  console.log("company from controller", res.locals);

  const thisCompany = await Company.findById(res.locals.currentCompany);

  const employees = thisCompany.employees;

  res.render("admin/employees", {
    pageName: "Employees",
    employees,
  });
};

exports.availability = (req, res) => {
  res.render("admin/availability", {
    pageName: "Availability",
    title: "Availability",
    hours: generateHours(30), // permettre a user de changer l'intervale
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
  console.log(dayOff);

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

exports.setCompany = (req, res) => {
  res.render("admin/set-company");
};

exports.joinCompany = (req, res) => {
  res.render("admin/join-company");
};
