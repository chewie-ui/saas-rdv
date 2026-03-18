const router = require("express").Router();
const {
  createUser,
  logout,
  forgotPasswordVerifyCode,
  checkCodePwd,
  newPwd,
} = require("../controllers/auth.controller");
const passport = require("passport");

router.get("/register", (req, res) => {
  res.render("auth/register");
});

router.get("/login", (req, res) => {
  res.render("auth/login");
});

router.post("/register", createUser);

router.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) return next(err);

    if (!user) {
      return res.render("auth/login", {
        error: "Invalid email or password",
        errorField: "email",
      });
    }

    req.logIn(user, (err) => {
      if (err) return next(err);
      return res.redirect("/appointment");
    });
  })(req, res, next);
});

router.get("/logout", logout);

router.get("/forgot-password", (req, res) => {
  res.render("auth/forgot-password");
});

router.post("/forgot-password/verify-code", forgotPasswordVerifyCode);
router.post("/forgot-password/check-code", checkCodePwd);
router.patch("/forgot-password/new-password", newPwd);
module.exports = router;
