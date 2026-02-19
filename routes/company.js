const router = require("express").Router();

const {
  searchCompany,
  requestCompany,
} = require("../controllers/company.controller");

router.get("/companies/search", searchCompany);
router.post("/companies/send-request", requestCompany);

module.exports = router;
