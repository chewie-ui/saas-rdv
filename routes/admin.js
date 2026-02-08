const router = require("express").Router();

router.get("/panel", (req, res) => {
  res.render("panel", {
    pageName: "Dashboard",
  });
});

module.exports = router;
