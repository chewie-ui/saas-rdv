const router = require("express").Router();
const ctrl = require("../controllers/client.controller");
const isClientAuth = require("../middlewares/isClientAuth");
const isClientOrUserAuth = require("../middlewares/isClientOrUserAuth");
const upload = require("../config/multer");
const { processSingleImage } = require("../middlewares/processImageUpload");
const { google } = require("googleapis");
const { createOAuthClient } = require("../config/googleCalendar");
const Client = require("../db/models/client.model");
const User = require("../db/models/user.model");
const crypto = require("crypto");

function buildClientRedirectUri() {
  const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/auth/google/client/callback`;
}

// En cas d'échec, on ramène le visiteur EXACTEMENT là où il était (sa page de
// réservation) avec un code d'erreur lisible, au lieu de l'éjecter vers /login
// sans explication — il perdait son tunnel et ne savait pas ce qui n'allait pas.
// On ne garde que le chemin interne du returnTo (jamais une URL externe fournie
// par le client) pour éviter toute redirection ouverte.
function backWithAuthError(returnTo, code) {
  const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  try {
    const u = new URL(returnTo, base);
    if (u.origin !== new URL(base).origin) throw new Error("external");
    u.searchParams.set("authError", code);
    return u.pathname + u.search + u.hash;
  } catch (_) {
    return `/login?error=${encodeURIComponent(code)}`;
  }
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
      // Comptes unifiés : une personne = UN compte. Si cet e-mail Google
      // correspond déjà à un compte BranShee (qu'il possède un établissement
      // ou non), on ouvre simplement ce compte au lieu de refuser la connexion
      // sous prétexte qu'il n'existe pas de « compte client » séparé.
      // Google a vérifié la propriété de l'adresse : même niveau de confiance
      // que la connexion Google côté pro.
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        if (!existingUser.googleId) {
          await User.updateOne({ _id: existingUser._id }, { $set: { googleId } });
        }
        return req.logIn(existingUser, (err) => {
          if (err) {
            console.error("Google client OAuth logIn error:", err);
            return res.redirect(backWithAuthError(returnTo, "google"));
          }
          return res.redirect(returnTo);
        });
      }
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
    return res.redirect(backWithAuthError(returnTo, "google"));
  }
});

router.get("/client/register", ctrl.getRegister);
router.post("/client/register", ctrl.postRegister);

// Connexion unifiée — une seule page de login pour tout le monde (cf. plan
// d'unification), qui sait déjà retomber sur un compte Client (cf. /login
// dans routes/auth.js). On garde le POST pour compatibilité (vieux
// favoris/formulaires), mais plus aucun lien dans l'app ne pointe ici.
router.get("/client/login", (req, res) => res.redirect(301, "/login"));
router.post("/client/login", ctrl.postLogin);

// ── Session info (AJAX) ───────────────────────────────────────────────────────
router.get("/client/me", async (req, res) => {
  // Comptes unifiés : un User connecté est un client comme un autre pour la
  // prise de rendez-vous (le tunnel a besoin de ses coordonnées pour
  // pré-remplir). Priorité à req.user, repli sur l'ancien compte Client.
  if (req.user) {
    const parts = (req.user.fullName || "").trim().split(" ");
    return res.json({
      client: {
        firstName:      parts[0] || "",
        lastName:       parts.slice(1).join(" ") || "",
        email:          req.user.email || "",
        phone:          req.user.phone || "",
        profilePicture: req.user.profilePicture || "",
      }
    });
  }
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

// Dual-mode (req.user OU req.session.clientId, cf. plan d'unification) —
// uniquement la lecture des réservations ; les sous-pages /parametres
// restent strictement isClientAuth (écritures Client-only, cf. middleware).
router.get("/espace-client", isClientOrUserAuth, ctrl.getDashboard);

// ─── Settings ────────────────────────────────────────────────────────────────
// Dual-mode (req.user OU req.session.clientId, cf. plan d'unification) — les
// handlers ci-dessous écrivent dans User ou Client selon le cas (cf. controller).
router.get("/espace-client/parametres", isClientOrUserAuth, ctrl.getSettings);
router.post("/espace-client/parametres/profile", isClientOrUserAuth, ctrl.updateProfile);
router.patch("/espace-client/parametres/picture", isClientOrUserAuth, upload.single("profilePicture"), processSingleImage("profilePicture"), ctrl.updateClientPicture);
router.post("/espace-client/parametres/email", isClientOrUserAuth, ctrl.updateClientEmail);
router.post("/espace-client/parametres/password", isClientOrUserAuth, ctrl.updateClientPassword);
router.post("/espace-client/parametres/language", isClientOrUserAuth, ctrl.updateClientLang);

module.exports = router;
