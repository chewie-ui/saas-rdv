const router = require("express").Router();
const {
  createBooking,
  getBooking,
} = require("../controllers/booking.controller");

router.post("/create-booking", createBooking);
router.get("/get-booking", getBooking);

module.exports = router;
