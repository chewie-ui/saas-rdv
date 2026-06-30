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
  updateDayOffEmployees,
  updateBuffer,
  updateSlotMode,
  updateSmartGrouping,
  updateBookingLeadTime,
  updateScheduleMode,
} = require("../controllers/company.controller");
const isAuth = require("../middlewares/isAuth");
const injectCompany = require("../middlewares/injectCompany");
const { requirePermission, hasPermission } = require("../utils/permissions");

// Poser/retirer un congé pour une liste d'`employeeIds` donnée : si la liste
// est vide (= tout le monde) ou contient quelqu'un d'autre que soi-même, il
// faut availability.manageOthersTimeOff ; si elle ne contient QUE soi-même,
// manageOwnTimeOff (résolu avec l'override individuel) suffit.
function requireTimeOffPermission(req, res, next) {
  const ids = Array.isArray(req.body.employeeIds) ? req.body.employeeIds : [];
  const onlySelf = ids.length > 0 && ids.every((id) => String(id) === String(req.user._id));
  const allowed = onlySelf
    ? res.locals.canManageOwnTimeOff
    : hasPermission(res, "availability.manageOthersTimeOff");
  if (!allowed) return res.status(403).json({ success: false, error: "forbidden" });
  next();
}

router.get("/company/get-infos/:companyId", injectCompany, companyInfos);

router.get("/company/get-days-off", isAuth, injectCompany, getDaysOff);
router.patch("/company/add-days-off", isAuth, injectCompany, requireTimeOffPermission, addDaysOff);
router.patch("/company/remove-days-off", isAuth, injectCompany, requireTimeOffPermission, removeDaysOff);

router.delete("/company/days-off/:dayId", isAuth, injectCompany, requirePermission("availability.manageOthersTimeOff"), removeDayOff);
router.patch("/company/days-off/:dayId/employees", isAuth, injectCompany, requirePermission("availability.manageOthersTimeOff"), updateDayOffEmployees);

router.delete("/company/time-slot", isAuth, injectCompany, requirePermission("availability.manageShared"), deleteTimeSlot);

router.patch("/company/schedule-day-off", isAuth, injectCompany, requirePermission("availability.manageOthersTimeOff"), scheduleDayOff);
router.patch("/company/set-schedule-day-off", isAuth, injectCompany, requirePermission("availability.manageOthersTimeOff"), setScheduleDayOff);
router.patch("/company/buffer", isAuth, injectCompany, requirePermission("availability.manageShared"), updateBuffer);
router.patch("/company/slot-mode", isAuth, injectCompany, requirePermission("availability.manageShared"), updateSlotMode);
router.patch("/company/smart-grouping", isAuth, injectCompany, requirePermission("availability.manageShared"), updateSmartGrouping);
router.patch("/company/booking-lead-time", isAuth, injectCompany, requirePermission("availability.manageShared"), updateBookingLeadTime);
router.patch("/company/schedule-mode", isAuth, injectCompany, requirePermission("availability.manageShared"), updateScheduleMode);

module.exports = router;
