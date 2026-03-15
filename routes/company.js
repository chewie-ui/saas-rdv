const router = require("express").Router();

const {
  addDaysOff,
  getDaysOff,
  removeDaysOff,
  removeDayOff,
  deleteTimeSlot,
  scheduleDayOff,
  setScheduleDayOff,
  companyInfos,
} = require("../controllers/company.controller");
const injectCompany = require("../middlewares/injectCompany");

router.get("/company/get-infos/:companyId", injectCompany, companyInfos);

router.get("/company/get-days-off", injectCompany, getDaysOff);
router.patch("/company/add-days-off", injectCompany, addDaysOff);
router.patch("/company/remove-days-off", injectCompany, removeDaysOff);

router.delete("/company/days-off/:dayId", injectCompany, removeDayOff);

router.delete("/company/time-slot", injectCompany, deleteTimeSlot);

router.patch("/company/schedule-day-off", injectCompany, scheduleDayOff);
router.patch("/company/set-schedule-day-off", injectCompany, setScheduleDayOff);

module.exports = router;
