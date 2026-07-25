// ── API mobile : intégrations agenda ──────────────────────────────────────
// Routes liées au COMPTE (pas à un établissement) : montées avant
// `mobileCompany`, elles travaillent sur `req.mobileUser`.
//   GET  /integrations                            état Google Calendar + flux iCal
//   POST /integrations/google-calendar/disconnect délie le compte Google
//
// La CONNEXION à Google Calendar reste sur le site : c'est un flux OAuth par
// navigateur (routes/googleCalendar.routes.js). L'app en affiche seulement
// l'état et renvoie vers le site pour connecter.
//
// Le flux iCal reprend exactement la logique de routes/ical.js
// (GET /api/calendar-feed-token) : token secret généré à la demande, URL
// publique /ical/<token> construite sur APP_URL.
const crypto = require("crypto");
const User = require("../../db/models/user.model");

const APP_BASE = process.env.APP_URL || "https://www.branshee.com";

// GET /api/v1/integrations
exports.get = async (req, res) => {
  try {
    const user = req.mobileUser;

    // Même génération paresseuse que le web : on ne crée le token qu'au
    // premier accès, puis on le réutilise tel quel.
    let feedToken = user.calendarFeedToken;
    if (!feedToken) {
      feedToken = crypto.randomBytes(24).toString("hex");
      await User.updateOne({ _id: user._id }, { $set: { calendarFeedToken: feedToken } });
      user.calendarFeedToken = feedToken;
    }

    const gcal = user.googleCalendar || {};
    const feedUrl = `${APP_BASE}/ical/${feedToken}`;

    res.json({
      googleCalendar: {
        connected: !!gcal.connected,
        email: gcal.email || "",
        // Le lien à ouvrir dans un navigateur pour lancer le flux OAuth.
        connectUrl: `${APP_BASE}/auth/google/calendar`,
      },
      ical: {
        token: feedToken,
        feedUrl,
        // webcal:// fait proposer l'abonnement directement par l'agenda du
        // téléphone (iOS, Google Agenda, Outlook) au lieu de télécharger le .ics.
        webcalUrl: feedUrl.replace(/^https?:\/\//, "webcal://"),
      },
    });
  } catch (err) {
    console.error("[mobile integrations get]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/integrations/google-calendar/disconnect
// Réplique routes/googleCalendar.routes.js (POST /auth/google/calendar/disconnect) :
// on repasse `connected` à false et on vide TOUS les jetons, pour qu'aucun
// accès ne subsiste côté serveur.
exports.disconnectGoogleCalendar = async (req, res) => {
  try {
    const user = req.mobileUser;

    if (!user.googleCalendar || !user.googleCalendar.connected) {
      return res.status(400).json({
        error: "not_connected",
        message: "Aucun agenda Google n'est connecté à ce compte.",
      });
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          "googleCalendar.connected": false,
          "googleCalendar.email": "",
          "googleCalendar.refreshToken": "",
          "googleCalendar.accessToken": "",
          "googleCalendar.scope": "",
          "googleCalendar.tokenType": "",
        },
      },
    );

    res.json({ ok: true, googleCalendar: { connected: false, email: "", connectUrl: `${APP_BASE}/auth/google/calendar` } });
  } catch (err) {
    console.error("[mobile integrations disconnect]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
