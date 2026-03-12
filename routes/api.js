const router = require("express").Router();

router.get("/test", (req, res) => {
  res.send("test");
});

module.exports = router;
