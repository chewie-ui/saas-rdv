const router = require("express").Router();
const {
  createBooking,
  getBooking,
  getSchedule,
  getDaysOff,
} = require("../controllers/booking.controller");

router.post("/create-booking", createBooking);
router.get("/get-booking", getBooking);
router.post("/get-schedule", getSchedule);
router.post("/get-days-off", getDaysOff);

module.exports = router;
