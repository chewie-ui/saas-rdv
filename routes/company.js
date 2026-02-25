const router = require("express").Router();

const {
  searchCompany,
  requestCompany,
  swapRole,
} = require("../controllers/company.controller");

router.get("/companies/search", searchCompany);
router.post("/companies/send-request", requestCompany);
router.post("/switch-company", (req, res) => {
  req.session.companyId = req.body.companyId;
  res.json({ success: true });
});

router.patch("/employees/:id/role", swapRole);

module.exports = router;
