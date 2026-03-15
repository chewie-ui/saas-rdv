const router = require("express").Router();

const { getCompanyIfExist } = require("../controllers/auth.controller");
const User = require("../db/models/user.model");

router.use(require("./auth"));
router.use(require("./company"));
router.use(require("./admin"));
router.use(require("./booking"));
router.use("/api", require("./api"));
router.use("/account", require("./user/account"));

router.get("/", (req, res) => {
  res.render("client/landing-page", {
    title: "Calendar",
  });
});

router.get("/:company", async (req, res) => {
  const company = await getCompanyIfExist(req.params.company);

  if (!company) {
    return res.status(404).render("client/404");
  }

  const ID = company.owner;
  const coach = await User.findById(ID);

  res.render("client/index", {
    title: `Coach ${coach.fullName}`,
    company,
    coach,
  });
});

module.exports = router;
