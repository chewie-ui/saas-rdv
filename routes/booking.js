const router = require("express").Router();
const {
  createBooking,
  getBooking,
  getSchedule,
  getDaysOff,
} = require("../controllers/booking.controller");
router.use((req, res, next) => {
  console.log("BOOKING ROUTER HIT");
  next();
});
router.post("/create-booking", createBooking);
router.get("/get-booking", getBooking);
router.post("/get-schedule", getSchedule);
router.post("/get-days-off", getDaysOff);

module.exports = router;
