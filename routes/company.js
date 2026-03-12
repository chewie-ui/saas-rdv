const router = require("express").Router();

const {
  addDaysOff,
  getDaysOff,
  removeDaysOff,
  removeDayOff,
  deleteTimeSlot,
  scheduleDayOff,
  setScheduleDayOff,
} = require("../controllers/company.controller");

router.get("/company/get-days-off", getDaysOff);
router.patch("/company/add-days-off", addDaysOff);
router.patch("/company/remove-days-off", removeDaysOff);

router.delete("/company/days-off/:dayId", removeDayOff);

router.delete("/company/time-slot", deleteTimeSlot);

router.patch("/company/schedule-day-off", scheduleDayOff);
router.patch("/company/set-schedule-day-off", setScheduleDayOff);

module.exports = router;
