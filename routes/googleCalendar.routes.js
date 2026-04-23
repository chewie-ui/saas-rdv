const express = require("express");
const { google } = require("googleapis");
const router = express.Router();

const { createOAuthClient } = require("../config/googleCalendar");
const User = require("../db/models/user.model");

// middleware simple
function isAuthenticated(req, res, next) {
  if (!req.user) return res.redirect("/login");
  next();
}

// 1) redirection vers Google
router.get("/auth/google/calendar", isAuthenticated, async (req, res) => {
  try {
    const oauth2Client = createOAuthClient();

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
      state: req.user._id.toString(),
    });

    return res.redirect(url);
  } catch (error) {
    console.error(error);
    return res.redirect("/panel?googleCalendar=error");
  }
});

// 2) callback Google
router.get("/auth/google/calendar/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({
      auth: oauth2Client,
      version: "v2",
    });

    const me = await oauth2.userinfo.get();

    const updateData = {
      "googleCalendar.connected": true,
      "googleCalendar.email": me.data.email || "",
      "googleCalendar.accessToken": tokens.access_token || "",
      "googleCalendar.scope": tokens.scope || "",
      "googleCalendar.tokenType": tokens.token_type || "",
    };

    if (tokens.refresh_token) {
      updateData["googleCalendar.refreshToken"] = tokens.refresh_token;
    }

    await User.findByIdAndUpdate(state, updateData);

    return res.redirect("/panel?googleCalendar=connected");
  } catch (error) {
    console.error("Google Calendar callback error:", error);
    return res.redirect("/panel?googleCalendar=error");
  }
});

// 3) déconnexion
router.post("/auth/google/calendar/disconnect", isAuthenticated, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      "googleCalendar.connected": false,
      "googleCalendar.email": "",
      "googleCalendar.refreshToken": "",
      "googleCalendar.accessToken": "",
      "googleCalendar.scope": "",
      "googleCalendar.tokenType": "",
    });

    return res.redirect("/panel?googleCalendar=disconnected");
  } catch (error) {
    console.error(error);
    return res.redirect("/panel?googleCalendar=error");
  }
});

module.exports = router;