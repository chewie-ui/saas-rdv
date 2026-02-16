const router = require("express").Router();

const { getCompanyIfExist } = require("../controllers/auth.controller");
const Company = require("../db/models/company.model");

router.use(require("./auth"));
router.use(require("./admin"));
router.use(require("./booking"));

router.get("/", (req, res) => {
  res.render("client/index", {
    title: "Calendar",
  });
});

function timeToMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function generateSlots(start, end, stepMinutes = 60) {
  const slots = [];

  let current = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);

  while (current < endMinutes) {
    slots.push(minutesToTime(current));
    current += stepMinutes;
  }

  return slots;
}

router.get("/company/:company", async (req, res) => {
  const company = await getCompanyIfExist(req.params.company);

  if (!company) {
    return res.status(404).render("client/404");
  }

  // 🔥 Générer les créneaux pour chaque jour
  const scheduleWithSlots = company.schedule.map((day) => {
    if (day.dayOff) {
      return { ...day.toObject(), slots: [] };
    }

    let slots = [];

    day.workingHours.forEach((range) => {
      const generated = generateSlots(range.start, range.end, 60);
      slots = [...slots, ...generated];
    });

    return {
      ...day.toObject(),
      slots,
    };
  });

  res.render("client/index", {
    title: company.name,
    company,
    schedule: scheduleWithSlots,
  });
});

module.exports = router;
