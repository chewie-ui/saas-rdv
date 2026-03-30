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
} = require("../controllers/admin.controller");

const isAuth = require("../middlewares/isAuth");
const injectCompany = require("../middlewares/injectCompany");

router.get(
  "/appointement/:bookId",
  isAuth,
  injectCompany,
  renderAppointments,
  book,
);

const isVerified = [isAuth, injectCompany];

router.get("/panel", isAuth, injectCompany, renderAppointments, panel);
router.get("/appointment", isAuth, injectCompany, appointment);
router.get("/availability", isAuth, injectCompany, availability);
router.get("/client", isAuth, injectCompany, client);
router.get("/informations", isAuth, injectCompany, informationsPage);
router.get("/subscription", isAuth, injectCompany, (req, res) => {
  res.render("admin/subscription", {
    pageName: "Subscription",
    title: "Plans",
  });
});

router.get("/settings", isVerified, settingsInit);
router.get("/history/edit/:id", isVerified, historyEditRow);
router.patch("/history/edit/:id", historyEditRowPatch);
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

router.get("/subscription/success", (req, res) => {
  res.send("TY FOR YOUR MONEY");
});

module.exports = router;
