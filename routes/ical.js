const router  = require("express").Router();
const crypto  = require("crypto");
const User    = require("../db/models/user.model");
const Booking = require("../db/models/book.model");
const isAuth  = require("../middlewares/isAuth");

/* ── Génère / récupère le token feed de l'utilisateur connecté ─────────────
   GET /api/calendar-feed-token  → { token, feedUrl }
   ────────────────────────────────────────────────────────────────────────── */
router.get("/api/calendar-feed-token", isAuth, async (req, res) => {
  try {
    let user = req.user;
    if (!user.calendarFeedToken) {
      const token = crypto.randomBytes(24).toString("hex");
      await User.findByIdAndUpdate(user._id, { calendarFeedToken: token });
      user.calendarFeedToken = token;
    }
    const base = process.env.APP_URL || "https://www.branshee.com";
    res.json({
      token:   user.calendarFeedToken,
      feedUrl: `${base}/ical/${user.calendarFeedToken}`,
    });
  } catch (err) {
    console.error("[calendar-feed-token]", err.message);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

/* ── Flux iCal public (authentifié par token secret dans l'URL) ────────────
   GET /ical/:token  → fichier .ics
   ────────────────────────────────────────────────────────────────────────── */
router.get("/ical/:token", async (req, res) => {
  try {
    const user = await User.findOne({ calendarFeedToken: req.params.token }).lean();
    if (!user) return res.status(404).send("Flux introuvable.");

    const now     = new Date();
    const cutoff  = new Date(now.getFullYear(), now.getMonth() - 3, 1); // 3 mois passés
    const bookings = await Booking.find({
      company: user.company,
      date:    { $gte: cutoff },
      status:  { $ne: "canceled" },
    })
    .populate("service", "name")
    .populate("employee", "fullName")
    .lean();

    function pad(n) { return String(n).padStart(2, "0"); }
    function toICS(iso) {
      return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    }
    function icsLine(key, val) {
      // Fold lines > 75 chars (RFC 5545)
      const line = `${key}:${val}`;
      if (line.length <= 75) return line;
      let out = "";
      for (let i = 0; i < line.length; i += 74) {
        out += (i === 0 ? "" : "\r\n ") + line.slice(i, i + 74);
      }
      return out;
    }

    const stamp = toICS(new Date().toISOString());
    // Nom de l'ÉTABLISSEMENT du flux (repli compte) — le nom du compte seul
    // était indiscernable entre deux établissements du même patron.
    let feedCompany = null;
    if (user.company) {
      try {
        const Company = require("../db/models/company/company.model");
        feedCompany = await Company.findById(user.company).select("name").lean();
      } catch (_) { /* repli sur le compte ci-dessous */ }
    }
    const calName = (feedCompany?.name || user.businessName || user.fullName || "BranShee") + " — Rendez-vous";

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//BranShee//FR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      `X-WR-CALNAME:${calName}`,
      "X-WR-CALDESC:Agenda automatique BranShee",
      "X-WR-TIMEZONE:Europe/Paris",
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H",
    ];

    for (const b of bookings) {
      const dateObj = new Date(b.date);
      const [sh, sm] = (b.startTime || "00:00").split(":").map(Number);
      const [eh, em] = (b.endTime   || b.startTime || "00:00").split(":").map(Number);

      const dtStart = new Date(dateObj);
      dtStart.setUTCHours(sh, sm, 0, 0);
      const dtEnd = new Date(dateObj);
      dtEnd.setUTCHours(eh, em, 0, 0);
      if (dtEnd <= dtStart) dtEnd.setUTCHours(dtEnd.getUTCHours() + 1);

      const serviceName  = b.service?.name  || "RDV";
      const employeeName = b.employee?.fullName || "";
      const clientName   = [b.firstName, b.lastName].filter(Boolean).join(" ") || b.email || "Client";
      const summary      = `${serviceName} — ${clientName}`;
      const description  = [
        `Client : ${clientName}`,
        b.email    ? `Email : ${b.email}`       : "",
        b.phone    ? `Tél : ${b.phone}`         : "",
        employeeName ? `Avec : ${employeeName}` : "",
        `Réservé via BranShee`,
      ].filter(Boolean).join("\\n");

      lines.push(
        "BEGIN:VEVENT",
        icsLine("UID", `branshee-${b._id}@branshee.com`),
        icsLine("DTSTAMP",     stamp),
        icsLine("DTSTART",     toICS(dtStart.toISOString())),
        icsLine("DTEND",       toICS(dtEnd.toISOString())),
        icsLine("SUMMARY",     summary),
        icsLine("DESCRIPTION", description),
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "DESCRIPTION:Rappel rendez-vous",
        "TRIGGER:-PT30M",
        "END:VALARM",
        "END:VEVENT",
      );
    }

    lines.push("END:VCALENDAR");

    res.set({
      "Content-Type":        "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="branshee-agenda.ics"`,
      "Cache-Control":       "no-cache, no-store",
    });
    res.send(lines.join("\r\n"));
  } catch (err) {
    console.error("[ical feed]", err.message);
    res.status(500).send("Erreur serveur.");
  }
});

module.exports = router;
