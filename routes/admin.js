const router = require("express").Router();
const { renderAppointments } = require("../controllers/booking.controller");
const { panel, appointment } = require("../controllers/admin.controller");

router.get("/panel", renderAppointments, panel);
router.get("/appointment", appointment);

module.exports = router;
