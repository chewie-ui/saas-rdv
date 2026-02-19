const router = require("express").Router();
const { renderAppointments } = require("../controllers/booking.controller");
const {
  panel,
  appointment,
  createCompany,
  firstSetupCompany,
  companySchedule,
  companyAddress,
  secondSetupCompany,
  client,
  employees,
  availability,
  toggleDay,
  editAvailabilty,
  setCompany,
  joinCompany,
} = require("../controllers/admin.controller");

const hasCompany = require("../middlewares/hasCompany");
const isAuth = require("../middlewares/isAuth");

router.get("/panel", isAuth, hasCompany, renderAppointments, panel);
router.get("/appointment", isAuth, hasCompany, appointment);
router.get("/availability", isAuth, hasCompany, availability);
router.get("/client", isAuth, hasCompany, client);
router.get("/employees", isAuth, hasCompany, employees);
router.get("/create-company", createCompany);
router.post("/create-company", isAuth, firstSetupCompany);

router.get("/company-schedule", companySchedule);
router.get("/company-address", companyAddress);

router.post("/company-address", secondSetupCompany);

router.post("/toggle-day", toggleDay);
router.post("/edit-availability", editAvailabilty);

router.get("/set-company", setCompany);
router.get("/join-company", isAuth, joinCompany);

module.exports = router;
