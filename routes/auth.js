const router = require("express").Router();
const {
  createUser,
  logout,
  forgotPasswordVerifyCode,
  checkCodePwd,
  newPwd,
} = require("../controllers/auth.controller");
const passport = require("passport");
const getServices = require("../utils/services");
const { google } = require("googleapis");
const { createOAuthClient } = require("../config/googleCalendar");
const User = require("../db/models/user.model");
const Company = require("../db/models/company/company.model");
const mongoose = require("mongoose");
const crypto = require("crypto");

function buildUserRedirectUri() {
  const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/auth/google/callback`;
}

router.get("/register", (req, res) => {
  res.render("auth/register", { becomeCoach: true, alwaysSticky: true, services: getServices(res.locals.lang) });
});

router.get("/login", (req, res) => {
  const error = req.query.error === "google" ? "La connexion avec Google a échoué. Veuillez réessayer." : null;
  res.render("auth/login", { becomeCoach: true, alwaysSticky: true, error });
});

router.post("/register", createUser);

router.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) return next(err);

    if (!user) {
      return res.render("auth/login", {
        error: "Invalid email or password",
        errorField: "email",
        becomeCoach: true,
        alwaysSticky: true,
      });
    }

    req.logIn(user, (err) => {
      if (err) return next(err);
      return res.redirect("/appointment");
    });
  })(req, res, next);
});

router.get("/logout", logout);

// ─── Google OAuth for users (admin/pro) ─────────────────────────────────────

router.get("/auth/google", (req, res) => {
  const redirectUri = buildUserRedirectUri();
  console.log("🔑 Google OAuth redirect URI:", redirectUri);
  const oauth2Client = createOAuthClient(redirectUri);

  const url = oauth2Client.generateAuthUrl({
    access_type: "online",
    scope: [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
  });

  res.redirect(url);
});

router.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;

  try {
    const redirectUri = buildUserRedirectUri();
    const oauth2Client = createOAuthClient(redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const me = await oauth2.userinfo.get();
    const googleId = me.data.id;
    const email = (me.data.email || "").toLowerCase();
    const name = me.data.name || email.split("@")[0];

    // Try to find existing user by googleId or email
    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (user) {
      // Link googleId if not already set
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
    } else {
      // Create new user + company
      const companyId = new mongoose.Types.ObjectId();
      user = await User.create({
        fullName: name,
        email,
        password: crypto.randomBytes(32).toString("hex"),
        googleId,
        company: companyId,
      });
      await Company.create({
        _id: companyId,
        owner: user._id,
        schedule: [
          { weekdayIndex: 1, workingHours: [{ start: "09:00", end: "18:00" }] },
          { weekdayIndex: 2, workingHours: [{ start: "09:00", end: "18:00" }] },
          { weekdayIndex: 3, workingHours: [{ start: "09:00", end: "18:00" }] },
          { weekdayIndex: 4, workingHours: [{ start: "09:00", end: "18:00" }] },
          { weekdayIndex: 5, workingHours: [{ start: "09:00", end: "18:00" }] },
          { weekdayIndex: 6, dayOff: true },
          { weekdayIndex: 0, dayOff: true },
        ],
      });
    }

    req.login(user, (err) => {
      if (err) return res.redirect("/login?error=google");
      return res.redirect("/appointment");
    });
  } catch (err) {
    console.error("Google user OAuth error:", err);
    return res.redirect("/login?error=google");
  }
});

router.get("/forgot-password", (req, res) => {
  res.render("auth/forgot-password", { alwaysSticky: true });
});

router.post("/forgot-password/verify-code", forgotPasswordVerifyCode);
router.post("/forgot-password/check-code", checkCodePwd);
router.patch("/forgot-password/new-password", newPwd);
module.exports = router;
