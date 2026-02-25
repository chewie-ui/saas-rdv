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

const Booking = require("../db/models/book.model");

exports.book = async (req, res) => {
  const { bookId } = req.params;

  const user = await Booking.findById(bookId);
  console.log(user);

  res.render("admin/book", {
    pageName: "Book",
    user,
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
  const apps = await GetAllAppointments(req.session.companyId);
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
      _id: appointment._id,
      name: appointment.name,
      surname: appointment.surname,
      email: appointment.email,
      phone: appointment.phone,
      message: appointment.message,
      weekday: (startDate.getDay() + 6) % 7,
      status: appointment.status,

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
      "00:00",
      "01:00",
      "02:00",
      "03:00",
      "04:00",
      "05:00",
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
      "21:00",
      "22:00",
      "23:00",
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
      employees: [
        {
          user: req.user._id,
          grade: "owner",
        },
      ],
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
  const thisCompany = await Company.findById(
    res.locals.currentCompany,
  ).populate("employees.user");

  const employees = thisCompany.employees;

  const userId = req.user._id;
  console.log(thisCompany.employees);

  const thisEmployee = employees.find(
    (r) => r.user._id.toString() === userId.toString(),
  );

  res.render("admin/employees", {
    pageName: "Employees",
    employees,
    thisEmployee,
  });
};

async function getSlotTime(companyId) {
  const res = await Company.findById(companyId).select("slotTime").lean();
  console.log(res.slotTime);

  return res?.slotTime;
}

exports.availability = async (req, res) => {
  res.render("admin/availability", {
    pageName: "Availability",
    title: "Availability",
    timeSlot: [10, 15, 20, 25, 30, 45, 60, 90, 120, 180],
    hours: generateHours(10),
    currentSlotTime: await getSlotTime(req.session.companyId),
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

const CompanyRequest = require("../db/models/company/companyRequest.model");

exports.requestsEmployees = async (req, res) => {
  const { companyId } = req.query;

  const result = await CompanyRequest.find({
    company: companyId,
    status: "pending",
  })
    .populate("user", "fullName email")
    .lean();
  res.json({ success: true, result });
};

exports.approveRequestEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await CompanyRequest.findById(id);

    if (!request) {
      return res.status(404).json({ error: "id not found" });
    }

    await Company.findByIdAndUpdate(request.company, {
      $push: {
        employees: {
          user: request.user,
          grade: "staff",
        },
      },
    });

    await CompanyRequest.findByIdAndDelete(id);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
  }
};

exports.rejectRequestEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    await CompanyRequest.findByIdAndDelete(id);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
  }
};

exports.fireRequestEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const { companyId } = req.query;

    await Company.findByIdAndUpdate(companyId, {
      $pull: { employees: { user: id } },
    });

    return res.json({ success: true });
  } catch (err) {
    console.log(err);
    return res.json({ error: err });
  }
};

exports.editSlotTime = async (req, res) => {
  try {
    const { slot } = req.body;
    const { companyId } = req.session;

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

  res.json({ data });
};

exports.cancelBooking = async (req, res) => {
  const { id } = req.params;
  await Booking.findByIdAndUpdate(id, {
    status: "canceled",
  });

  res.json({ success: true });
};
