const router = require("express").Router();
const {
  createBooking,
  getBooking,
  getSchedule,
  getDaysOff,
  getDisabledDays,
  getBookingC,
  cancelBooking,
  createBookingPaymentIntent,
  chargeNoShow,
} = require("../controllers/booking.controller");
const Form = require("../db/models/form.model");

router.post("/create-booking", createBooking);
router.get("/get-booking", getBooking);
router.post("/get-schedule", getSchedule);
router.post("/get-days-off", getDaysOff);
router.get("/get-disabled-days/:companyId", getDisabledDays);

router.get("/get-booking/:companyId", getBookingC);
router.get("/cancel-booking/:userId", cancelBooking);

// ── Paiement réservation ──────────────────────────────────────────────────────
router.post("/api/booking/payment-intent", createBookingPaymentIntent);
router.patch("/appointment/:id/charge-noshow", chargeNoShow);

router.get("/get-form/:companyId", async (req, res) => {
  try {
    const form = await Form.findOne({
      company: req.params.companyId,
      active: true,
    }).lean();
    return res.json({ form: form || null });
  } catch (err) {
    return res.json({ form: null });
  }
});

module.exports = router;
