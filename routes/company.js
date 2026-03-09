const router = require("express").Router();

const isAdmin = require("../middlewares/IsAdmin");

const {
  searchCompany,
  requestCompany,
  swapRole,
  addDaysOff,
  getDaysOff,
  removeDaysOff,
  removeDayOff,
  deleteTimeSlot,
  transferOwner,
  scheduleDayOff,
  setScheduleDayOff,
  companyInfos,
} = require("../controllers/company.controller");

router.get("/company/get-infos/:companyId", companyInfos);

router.get("/companies/search", searchCompany);
router.post("/companies/send-request", requestCompany);
router.post("/switch-company", (req, res) => {
  req.session.companyId = req.body.companyId;
  res.json({ success: true });
});

router.patch("/employees/:id/role", swapRole);

router.get("/company/get-days-off", getDaysOff);
router.patch("/company/add-days-off", addDaysOff);
router.patch("/company/remove-days-off", removeDaysOff);

router.delete("/company/days-off/:dayId", removeDayOff);

router.delete("/company/time-slot", deleteTimeSlot);
router.patch("/company/transfer-owner", isAdmin, transferOwner);

router.patch("/company/schedule-day-off", scheduleDayOff);
router.patch("/company/set-schedule-day-off", setScheduleDayOff);

module.exports = router;
