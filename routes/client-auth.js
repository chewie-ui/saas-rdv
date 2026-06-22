const router = require("express").Router();
const ctrl = require("../controllers/client.controller");
const isClientAuth = require("../middlewares/isClientAuth");
const upload = require("../config/multer");
const { processSingleImage } = require("../middlewares/processImageUpload");
const { google } = require("googleapis");
const { createOAuthClient } = require("../config/googleCalendar");
const Client = require("../db/models/client.model");
const crypto = require("crypto");

function buildClientRedirectUri() {
  const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/auth/google/client/callback`;
}

// ─── Google OAuth for clients ────────────────────────────────────────────────

router.get("/auth/google/client", (req, res) => {
  const redirectUri = buildClientRedirectUri();
  const oauth2Client = createOAuthClient(redirectUri);
  const returnTo = req.query.returnTo || "/espace-client";
  const state = Buffer.from(JSON.stringify({ returnTo })).toString("base64url");

  const url = oauth2Client.generateAuthUrl({
    access_type: "online",
    scope: [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ],
    state,
  });

  res.redirect(url);
});

router.get("/auth/google/client/callback", async (req, res) => {
  const { code, state } = req.query;

  let returnTo = "/espace-client";
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    returnTo = parsed.returnTo || "/espace-client";
  } catch (_) {}

  try {
    const redirectUri = buildClientRedirectUri();
    const oauth2Client = createOAuthClient(redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const me = await oauth2.userinfo.get();
    const googleId = me.data.id;
    const email = (me.data.email || "").toLowerCase();
    const name = me.data.name || email.split("@")[0];

    let client = await Client.findOne({ $or: [{ googleId }, { email }] });

    if (client) {
      if (!client.googleId) {
        client.googleId = googleId;
        await client.save();
      }
    } else {
      client = await Client.create({
        fullName: name,
        email,
        password: crypto.randomBytes(32).toString("hex"),
        googleId,
      });
    }

    req.session.clientId = client._id.toString();
    return res.redirect(returnTo);
  } catch (err) {
    console.error("Google client OAuth error:", err);
    return res.redirect("/client/login?error=google");
  }
});

router.get("/client/register", ctrl.getRegister);
router.post("/client/register", ctrl.postRegister);

router.get("/client/login", ctrl.getLogin);
router.post("/client/login", ctrl.postLogin);

// ── Session info (AJAX) ───────────────────────────────────────────────────────
router.get("/client/me", async (req, res) => {
  if (!req.session?.clientId) return res.json({ client: null });
  try {
    const Client = require("../db/models/client.model");
    const client = await Client.findById(req.session.clientId)
      .select("fullName email phone profilePicture")
      .lean();
    if (!client) return res.json({ client: null });
    const parts = (client.fullName || "").trim().split(" ");
    return res.json({
      client: {
        firstName:      parts[0] || "",
        lastName:       parts.slice(1).join(" ") || "",
        email:          client.email || "",
        phone:          client.phone || "",
        profilePicture: client.profilePicture || "",
      }
    });
  } catch (_) {
    return res.json({ client: null });
  }
});

router.get("/client/logout", ctrl.logout);

router.get("/espace-client", isClientAuth, ctrl.getDashboard);

// ─── Settings ────────────────────────────────────────────────────────────────
router.get("/espace-client/parametres", isClientAuth, ctrl.getSettings);
router.post("/espace-client/parametres/profile", isClientAuth, ctrl.updateProfile);
router.patch("/espace-client/parametres/picture", isClientAuth, upload.single("profilePicture"), processSingleImage("profilePicture"), ctrl.updateClientPicture);
router.post("/espace-client/parametres/email", isClientAuth, ctrl.updateClientEmail);
router.post("/espace-client/parametres/password", isClientAuth, ctrl.updateClientPassword);
router.post("/espace-client/parametres/language", isClientAuth, ctrl.updateClientLang);

module.exports = router;
