const express = require("express");
const { google } = require("googleapis");
const router = express.Router();

const { createOAuthClient } = require("../config/googleCalendar");
const User = require("../db/models/user.model");
const Company = require("../db/models/company/company.model");
const Booking = require("../db/models/book.model");
const { addEventToCalendar } = require("../utils/googleCalendarSync");

// middleware simple
function isAuthenticated(req, res, next) {
  if (!req.user) return res.redirect("/login");
  next();
}

/** Construit l'URI de callback à partir du domaine de la requête courante */
function buildRedirectUri(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host  = req.headers["x-forwarded-host"]  || req.get("host");
  return `${proto}://${host}/auth/google/calendar/callback`;
}

// 1) redirection vers Google
router.get("/auth/google/calendar", isAuthenticated, async (req, res) => {
  try {
    const redirectUri  = buildRedirectUri(req);
    const oauth2Client = createOAuthClient(redirectUri);

    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/userinfo.email"],
      state: req.user._id.toString(),
    });

    return res.redirect(url);
  } catch (error) {
    console.error(error);
    return res.redirect("/appointment?googleCalendar=error");
  }
});

// 2) callback Google
router.get("/auth/google/calendar/callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    const redirectUri  = buildRedirectUri(req);
    const oauth2Client = createOAuthClient(redirectUri);
    const { tokens }   = await oauth2Client.getToken(code);

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

    const updatedUser = await User.findByIdAndUpdate(state, updateData, { new: true });

    // ── Sync existing bookings in background (non-blocking) ──────────────────
    const refreshToken = tokens.refresh_token || updatedUser.googleCalendar?.refreshToken;
    if (refreshToken) {
      syncExistingBookings(state, refreshToken).catch((err) => console.error("Background gcal sync error:", err));
    }

    return res.redirect("/appointment?googleCalendar=connected");
  } catch (error) {
    console.error("Google Calendar callback error:", error);
    return res.redirect("/appointment?googleCalendar=error");
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

    return res.redirect("/appointment?googleCalendar=disconnected");
  } catch (error) {
    console.error(error);
    return res.redirect("/appointment?googleCalendar=error");
  }
});

// ── Background sync: push all existing confirmed bookings to Google Calendar ──
async function syncExistingBookings(userId, refreshToken) {
  // Find the company owned by this user
  const company = await Company.findOne({ owner: userId }).select("_id").lean();
  if (!company) return;

  // Get all confirmed bookings without a googleEventId yet
  const bookings = await Booking.find({
    company: company._id,
    status: "confirmed",
    $or: [{ googleEventId: { $exists: false } }, { googleEventId: "" }, { googleEventId: null }],
  }).lean();

  if (bookings.length === 0) {
    console.log("[GCal sync] No bookings to sync.");
    return;
  }

  console.log(`[GCal sync] Syncing ${bookings.length} existing booking(s)...`);

  let synced = 0;
  let failed = 0;

  for (const booking of bookings) {
    try {
      const eventId = await addEventToCalendar(refreshToken, booking);
      if (eventId) {
        await Booking.findByIdAndUpdate(booking._id, { googleEventId: eventId });
        synced++;
      }
    } catch (err) {
      console.error(`[GCal sync] Failed for booking ${booking._id}:`, err.message);
      failed++;
    }
  }

  console.log(`[GCal sync] Done — ${synced} synced, ${failed} failed.`);
}

module.exports = router;
