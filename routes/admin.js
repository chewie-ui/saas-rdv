const router = require("express").Router();
const { renderAppointments } = require("../controllers/booking.controller");
const {
  panel,
  appointment,
  client,
  availability,
  toggleDay,
  editAvailabilty,
  editSlotTime,
  book,
  deleteBooking,
  cancelBooking,
  getWeekData,
  restoreBooking,
  informationsPage,
  historyInit,
  historyDeleteRow,
  historySearch,
  historyEditRow,
  settingsInit,
  historyEditRowPatch,
  historyCheckConflicts,
  paymentVerification,
  resumeSubscription,
  saveAdminNotes,
  updateBookingEmployee,
} = require("../controllers/admin.controller");

const adminController = require("../controllers/admin.controller");

const isAuth = require("../middlewares/isAuth");
const injectCompany = require("../middlewares/injectCompany");

router.get("/appointement/:bookId", isAuth, injectCompany, renderAppointments, book);

const isVerified = [isAuth, injectCompany];

// ── Onboarding de bienvenue ───────────────────────────────────────────────────
router.get("/welcome", isAuth, injectCompany, (req, res) => {
  res.render("admin/welcome", {
    pageName: "Welcome",
    title: "Bienvenue — BranShee",
  });
});

router.get("/panel", isAuth, injectCompany, renderAppointments, panel);
router.get("/appointment", isAuth, injectCompany, appointment);
router.get("/availability", isAuth, injectCompany, availability);
router.get("/client", isAuth, injectCompany, client);
router.get("/informations", (req, res) => res.redirect(301, "/settings"));
router.get("/subscription", isAuth, injectCompany, async (req, res) => {
  let monthlyBookingCount = null;
  if (!res.locals.isPro && res.locals.currentCompany) {
    const Booking = require("../db/models/book.model");
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    monthlyBookingCount = await Booking.countDocuments({
      company: res.locals.currentCompany._id,
      date:    { $gte: startOfMonth },
      status:  { $ne: "canceled" },
    });
  }

  // Cartes déjà enregistrées → on les propose dans la boîte de confirmation
  // d'achat ("payer instant avec carte X ou changer de carte") au lieu de
  // débiter directement quand on clique sur "Acheter Business/Pro".
  const paymentMethods = await adminController.getUserPaymentMethods(req.user);

  // Offres actives (isDefaultOffer=true) → affichées dynamiquement sur la page
  const PromoCode = require("../db/models/promoCode.model");
  const defaultOffers = await PromoCode.find({ isDefaultOffer: true, active: true }).lean();

  res.render("admin/subscription", {
    pageName: "Subscription",
    title: "Plans",
    monthlyBookingCount,
    paymentMethods,
    defaultOffers,
  });
});

router.get("/settings", isVerified, settingsInit);
router.get("/history/edit/:id", isVerified, historyEditRow);
router.patch("/history/edit/:id", historyEditRowPatch);
router.get("/history/edit/:id/conflicts", isAuth, historyCheckConflicts);
router.get("/history", isVerified, historyInit);
router.delete("/history", historyDeleteRow);
router.get("/history/search", historySearch);

router.post("/toggle-day", toggleDay);
router.post("/edit-availability", editAvailabilty);

router.patch("/edit-interval", injectCompany, editSlotTime);

router.delete("/appointment/:bookId/delete", deleteBooking);
router.patch("/appointment/:bookId/restore", restoreBooking);
router.patch("/appointment/:id/cancel", cancelBooking);
router.get("/appointment/week-data", getWeekData);

router.patch("/appointement/:bookId/admin-notes", saveAdminNotes);
router.patch("/appointement/:bookId/employee", updateBookingEmployee);
router.get("/subscription/success", isVerified, paymentVerification);
router.get("/payment/success", isVerified, paymentVerification);

router.post("/subscription/resume", isAuth, resumeSubscription);

router.get("/forms", isVerified, adminController.formsIndex);
router.get("/forms/data", isVerified, adminController.getFormData);
router.post("/forms/save", isVerified, adminController.saveForm);

router.get("/customize-calendar", isAuth, injectCompany, adminController.customizeCalendarPage);

// ── Ordre des sections ────────────────────────────────────────────────────────
router.patch("/account/section-order", isVerified, adminController.saveSectionOrder);

// ── Notifications ─────────────────────────────────────────────────────────────
router.patch("/settings/notifications", isVerified, adminController.saveNotificationSettings);

// ── Pré-paiement ──────────────────────────────────────────────────────────────
router.patch("/settings/prepayment", isVerified, adminController.savePrepaymentSettings);
router.patch("/settings/cancellation-policy", isVerified, adminController.saveCancellationPolicy);

// ── Stripe Connect (Express onboarding) ───────────────────────────────────────
router.get("/settings/stripe-connect",          isVerified, adminController.initiateStripeConnect);
router.get("/settings/stripe-connect/return",   adminController.stripeConnectReturn);
router.get("/settings/stripe-connect/refresh",  adminController.stripeConnectRefresh);
router.post("/settings/stripe-connect/manual",  isVerified, adminController.saveStripeAccountManual);
router.delete("/settings/stripe-connect",       isVerified, adminController.disconnectStripeConnect);

module.exports = router;
