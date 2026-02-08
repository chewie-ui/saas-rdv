const router = require("express").Router();

router.use(require("./api"));
router.use(require("./admin"));
router.use(require("./booking"));

router.get("/", (req, res) => {
  res.render("index");
});

module.exports = router;
