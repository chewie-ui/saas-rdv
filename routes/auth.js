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
const Client = require("../db/models/client.model");
const Company = require("../db/models/company/company.model");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { requireFeatureActive } = require("../middlewares/featureFlag");
const isAuth = require("../middlewares/isAuth");
const LoginEvent = require("../db/models/loginEvent.model");

// Fire-and-forget : ne doit jamais faire échouer une connexion si l'écriture
// du log rate (DB lente, etc.) — c'est juste un historique pour le superadmin.
function logLoginEvent(user, method) {
  LoginEvent.create({ user: user._id, method }).catch((err) => {
    console.error("LoginEvent create error:", err.message);
  });
}

function buildUserRedirectUri() {
  const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}/auth/google/callback`;
}

// Code promo « bienvenue » (1 mois d'essai gratuit, voir scripts/create-welcome-promo.js).
// La page d'inscription affiche « 1 mois gratuit inclus » dès qu'un plan payant est
// présélectionné (cf. auth-plan-badge dans register.pug) — pour que cette promesse
// soit toujours honorée au moment du paiement (et pas seulement quand le lien marketing
// pense à ajouter `&promo=BIENVENUE`), on l'applique automatiquement par défaut.
const WELCOME_TRIAL_PROMO = "BIENVENUE";

router.get("/register", requireFeatureActive("register"), (req, res) => {
  const allowedPlans = ["pro", "business"];
  const plan    = req.query.plan    && allowedPlans.includes(req.query.plan) ? req.query.plan : null;
  const billing = req.query.billing || "monthly";
  const promo   = req.query.promo ? req.query.promo.trim().toUpperCase() : null;
  const ref     = req.query.ref   ? req.query.ref.trim().toUpperCase()   : null;

  // Si un plan payant est sélectionné sans code promo explicite, on applique le
  // code de bienvenue (essai gratuit) par défaut — voir WELCOME_TRIAL_PROMO ci-dessus.
  const effectivePromo = promo || (plan ? WELCOME_TRIAL_PROMO : null);

  // Stocker en session pour après inscription
  if (plan)           { req.session.pendingPlan = plan; req.session.pendingBilling = billing; }
  if (effectivePromo) req.session.pendingPromo  = effectivePromo;
  if (ref)            req.session.pendingRef    = ref;

  // ── Déjà connecté → checkout direct ──────────────────────────────────────
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    if (plan || effectivePromo) {
      let dest = `/subscription?autoCheckout=1`;
      if (plan)           dest += `&plan=${plan}&billing=${billing}`;
      if (effectivePromo) dest += `&promo=${encodeURIComponent(effectivePromo)}`;
      return res.redirect(dest);
    }
    return res.redirect("/appointment");
  }

  res.render("auth/register", {
    becomeCoach: true,
    alwaysSticky: true,
    services: getServices(res.locals.lang),
    pendingPlan:  plan  || req.session.pendingPlan  || null,
    pendingPromo: effectivePromo || req.session.pendingPromo || null,
  });
});

router.get("/login", requireFeatureActive("login"), (req, res) => {
  const error = req.query.error === "google" ? "La connexion avec Google a échoué. Veuillez réessayer."
    : req.query.error === "google_email_taken" ? "Cette adresse email est déjà utilisée par un autre compte. Connectez-vous avec votre mot de passe."
    : null;

  // Conserver promo/plan si on vient d'un lien d'invitation
  const allowedPlans = ["pro", "business"];
  const loginPlan = (req.query.plan && allowedPlans.includes(req.query.plan)) ? req.query.plan : null;
  if (loginPlan) {
    req.session.pendingPlan    = loginPlan;
    req.session.pendingBilling = req.query.billing || "monthly";
  }
  if (req.query.promo) {
    req.session.pendingPromo = req.query.promo.trim().toUpperCase();
  } else if (loginPlan && !req.session.pendingPromo) {
    // Même logique qu'à l'inscription : honorer la promesse « 1 mois gratuit »
    // par défaut quand un plan payant est sélectionné sans code promo explicite.
    req.session.pendingPromo = WELCOME_TRIAL_PROMO;
  }

  // Déjà connecté
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    const plan  = req.session.pendingPlan;
    const promo = req.session.pendingPromo;
    if (plan || promo) {
      let dest = `/subscription?autoCheckout=1`;
      if (plan)  dest += `&plan=${plan}&billing=${req.session.pendingBilling || "monthly"}`;
      if (promo) dest += `&promo=${encodeURIComponent(promo)}`;
      return res.redirect(dest);
    }
    return res.redirect("/appointment");
  }

  res.render("auth/login", { becomeCoach: true, alwaysSticky: true, error });
});

// ── Mémorise le plan/promo en session avant register ou login via popup ─────
router.post("/set-pending", (req, res) => {
  const allowed = ["pro", "business"];
  const billingOk = ["monthly", "yearly", "sixmonths"];
  const { plan, billing, promo } = req.body;
  if (plan && allowed.includes(plan))           req.session.pendingPlan    = plan;
  if (billing && billingOk.includes(billing))   req.session.pendingBilling = billing;
  if (promo && typeof promo === "string")        req.session.pendingPromo   = promo.trim().toUpperCase();
  res.json({ ok: true });
});

router.post("/register", createUser);

// ── Liste des métiers pour le formulaire d'inscription (utilisée par le
// client desktop — le site web la passe directement au template Pug) ───────
router.get("/api/business-types", (req, res) => {
  res.json({ businessTypes: getServices(res.locals.lang || "fr") });
});

router.post("/login", (req, res, next) => {
  const isAjax = req.headers["x-requested-with"] === "fetch";
  passport.authenticate("local", async (err, user, info) => {
    if (err) return next(err);

    if (!user) {
      // Filet de compatibilité tant que des comptes Client séparés existent
      // encore (cf. scripts/migrate-merge-client-into-user.js) — UNE seule
      // page/formulaire de connexion pour tout le monde : si ce n'est pas un
      // User, on essaie l'ancien compte Client avant de déclarer l'échec.
      try {
        const bcrypt = require("bcrypt");
        const email = (req.body.email || "").toLowerCase().trim();
        const client = await Client.findOne({ email });
        if (client && (await bcrypt.compare(req.body.password || "", client.password))) {
          req.session.clientId = client._id.toString();
          if (isAjax) return res.json({ success: true, redirect: "/espace-client" });
          return res.redirect("/espace-client");
        }
      } catch (_) {
        // Si la vérification Client échoue pour une raison quelconque, on
        // retombe sur le message d'erreur générique ci-dessous.
      }
      if (isAjax) return res.status(400).json({ error: "Email ou mot de passe incorrect." });
      return res.render("auth/login", {
        error: "Email ou mot de passe incorrect.",
        becomeCoach: true,
        alwaysSticky: true,
      });
    }

    // 2FA : si activée, stocker le userId en session et rediriger vers la vérification
    if (user.twoFA && user.twoFA.enabled) {
      req.session.pending2FAUserId = String(user._id);
      if (isAjax) return res.json({ success: true, redirect: "/login/2fa" });
      return res.redirect("/login/2fa");
    }

    req.logIn(user, (err) => {
      if (err) return next(err);
      logLoginEvent(user, "local");

      // 1. Access link
      const pendingCode = req.session.pendingAccessCode;
      if (pendingCode) {
        delete req.session.pendingAccessCode;
        const dest = `/access/${pendingCode}`;
        if (isAjax) return res.json({ success: true, redirect: dest });
        return res.redirect(dest);
      }

      // 2. Promo / plan en attente (venu d'un lien d'invitation)
      const pendingPlan  = req.session.pendingPlan;
      const pendingPromo = req.session.pendingPromo;
      if (pendingPlan || pendingPromo) {
        const billing = req.session.pendingBilling || "monthly";
        delete req.session.pendingPlan;
        delete req.session.pendingBilling;
        delete req.session.pendingPromo;
        let dest = `/subscription?autoCheckout=1`;
        if (pendingPlan)  dest += `&plan=${pendingPlan}&billing=${billing}`;
        if (pendingPromo) dest += `&promo=${encodeURIComponent(pendingPromo)}`;
        if (isAjax) return res.json({ success: true, redirect: dest });
        return res.redirect(dest);
      }

      if (isAjax) return res.json({ success: true, redirect: "/appointment" });
      return res.redirect("/appointment");
    });
  })(req, res, next);
});

// ── 2FA verification page ────────────────────────────────────────────────────
router.get("/login/2fa", (req, res) => {
  if (!req.session.pending2FAUserId) return res.redirect("/login");
  const error = req.query.error ? "Code incorrect. Vérifiez votre application." : null;
  res.render("auth/login-2fa", { becomeCoach: true, alwaysSticky: true, error });
});

router.post("/login/2fa", async (req, res) => {
  const isAjax = req.headers["x-requested-with"] === "fetch";
  const { pending2FAUserId } = req.session;
  if (!pending2FAUserId) {
    if (isAjax) return res.status(400).json({ error: "Session expirée, veuillez vous reconnecter." });
    return res.redirect("/login");
  }

  const { code } = req.body;
  try {
    const speakeasy = require("speakeasy");
    const user = await User.findById(pending2FAUserId);
    if (!user) {
      if (isAjax) return res.status(400).json({ error: "Session expirée, veuillez vous reconnecter." });
      return res.redirect("/login");
    }

    const isValid = speakeasy.totp.verify({
      secret: user.twoFA.secret,
      encoding: "base32",
      token: String(code).replace(/\s/g, ""),
      window: 1,
    });
    if (!isValid) {
      if (isAjax) return res.status(400).json({ error: "Code incorrect. Vérifiez votre application." });
      return res.redirect("/login/2fa?error=1");
    }

    delete req.session.pending2FAUserId;
    req.logIn(user, (err) => {
      if (err) {
        if (isAjax) return res.status(500).json({ error: "Erreur serveur." });
        return res.redirect("/login");
      }
      logLoginEvent(user, "2fa");

      // Access link
      const pendingCode = req.session.pendingAccessCode;
      if (pendingCode) {
        delete req.session.pendingAccessCode;
        const dest = `/access/${pendingCode}`;
        if (isAjax) return res.json({ success: true, redirect: dest });
        return res.redirect(dest);
      }
      // Promo / plan
      const pp = req.session.pendingPlan;
      const pr = req.session.pendingPromo;
      if (pp || pr) {
        const bl = req.session.pendingBilling || "monthly";
        delete req.session.pendingPlan; delete req.session.pendingBilling; delete req.session.pendingPromo;
        let dest = `/subscription?autoCheckout=1`;
        if (pp) dest += `&plan=${pp}&billing=${bl}`;
        if (pr) dest += `&promo=${encodeURIComponent(pr)}`;
        if (isAjax) return res.json({ success: true, redirect: dest });
        return res.redirect(dest);
      }
      if (isAjax) return res.json({ success: true, redirect: "/appointment" });
      return res.redirect("/appointment");
    });
  } catch (err) {
    console.error("2FA login error:", err.message);
    if (isAjax) return res.status(500).json({ error: "Erreur serveur." });
    return res.redirect("/login/2fa?error=1");
  }
});

router.get("/logout", logout);

// ── Identité de l'utilisateur connecté (consommé par le client desktop) ──────
router.get("/me", isAuth, (req, res) => {
  res.json({
    fullName: req.user.fullName,
    email: req.user.email,
    businessName: req.user.businessName || "",
    profilePicture: req.user.profilePicture || "",
  });
});

// ─── Google OAuth for users (admin/pro) ─────────────────────────────────────

router.get("/auth/google", (req, res) => {
  // Intention choisie à l'étape 0 du formulaire d'inscription (avant le bouton
  // Google) — on la garde en session pour la retrouver après l'aller-retour
  // OAuth, même mécanisme que pendingPlan/pendingPromo/pendingRef ci-dessous.
  const ALLOWED_INTENTS = ["pro", "client", "undecided"];
  if (ALLOWED_INTENTS.includes(req.query.intent)) {
    req.session.pendingAccountIntent = req.query.intent;
  }

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

    let isNewUser = false;
    if (user) {
      // Link googleId if not already set
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
    } else {
      // Filet de sécurité tant que l'inscription client (compte séparé)
      // existe encore — sans ça, le même email peut avoir un compte Client
      // ET un compte User créés indépendamment (cf. plan d'unification).
      const existingClient = await Client.findOne({ email });
      if (existingClient) {
        return res.redirect("/login?error=google_email_taken");
      }

      isNewUser = true;
      const accountIntent = req.session.pendingAccountIntent || "undecided";
      delete req.session.pendingAccountIntent;
      const wantsCompany = accountIntent === "pro";
      const companyId = wantsCompany ? new mongoose.Types.ObjectId() : undefined;

      user = await User.create({
        fullName: name,
        email,
        password: crypto.randomBytes(32).toString("hex"),
        googleId,
        accountIntent,
        company: companyId,
      });

      if (wantsCompany) {
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
    }

    req.login(user, (err) => {
      if (err) return res.redirect("/login?error=google");
      logLoginEvent(user, "google");
      if (isNewUser && user.accountIntent !== "pro") return res.redirect("/");
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
