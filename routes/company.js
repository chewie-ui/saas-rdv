const router = require("express").Router();

const {
  searchCompany,
  requestCompany,
  swapRole,
  addDaysOff,
  getDaysOff,
  removeDaysOff,
  removeDayOff,
} = require("../controllers/company.controller");

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

module.exports = router;
