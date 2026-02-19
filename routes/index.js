const router = require("express").Router();

const { getCompanyIfExist } = require("../controllers/auth.controller");

router.use(require("./auth"));
router.use(require("./company"));
router.use(require("./admin"));
router.use(require("./booking"));

router.get("/", (req, res) => {
  res.render("client/landing-page", {
    title: "Calendar",
  });
});

router.get("/company/:company", async (req, res) => {
  const company = await getCompanyIfExist(req.params.company);

  if (!company) {
    return res.status(404).render("client/404");
  }

  res.render("client/index", {
    title: company.name,
    company,
  });
});

module.exports = router;
