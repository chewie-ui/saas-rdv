const router = require("express").Router();
const {
  createBooking,
  getBooking,
  getSchedule,
  getDaysOff,
  getDisabledDays,
  getBookingC,
  cancelBooking,
  cancelBookingPage,
  createBookingPaymentIntent,
  createBookingSetupIntent,
  markNoShow,
  reviewCancellationPenalty,
  getGroupSessions,
} = require("../controllers/booking.controller");
const Form = require("../db/models/form.model");
const isAuth = require("../middlewares/isAuth");
const injectCompany = require("../middlewares/injectCompany");
const { requirePermission } = require("../utils/permissions");

router.post("/create-booking", createBooking);
router.get("/get-booking", getBooking);
router.post("/get-schedule", getSchedule);
router.post("/get-days-off", getDaysOff);
router.get("/get-disabled-days/:companyId", getDisabledDays);
router.get("/get-group-sessions/:serviceId", getGroupSessions);

router.get("/get-booking/:companyId", getBookingC);
// GET = page de confirmation (ne modifie rien) ; POST = annulation réelle.
// Un lien préchargé par une messagerie ne peut donc plus annuler tout seul.
router.get("/cancel-booking/:userId", cancelBookingPage);
router.post("/cancel-booking/:userId", cancelBooking);

// ── Paiement réservation ──────────────────────────────────────────────────────
router.post("/api/booking/payment-intent", createBookingPaymentIntent);
router.post("/api/booking/setup-intent", createBookingSetupIntent);
// Ces deux routes déclenchent des prélèvements/remboursements Stripe : elles
// n'avaient AUCUN middleware (ni auth, ni permission). On exige désormais une
// session admin authentifiée, l'établissement courant (pour le scope IDOR
// côté handler) et la permission de gérer les rendez-vous.
router.patch("/appointment/:id/no-show", isAuth, injectCompany, requirePermission("appointments.manage"), markNoShow);
router.patch("/appointment/:id/review-cancellation", isAuth, injectCompany, requirePermission("appointments.manage"), reviewCancellationPenalty);

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
