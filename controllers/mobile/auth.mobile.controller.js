// ── API mobile : authentification (app pro Branshee) ──────────────────────
// Flux JWT stateless, indépendant de la session Passport de l'app web.
//   POST /api/v1/auth/login    { email, password }  → tokens OU challenge 2FA
//   POST /api/v1/auth/2fa      { challengeToken, code } → tokens
//   POST /api/v1/auth/refresh  { refreshToken }     → nouveaux tokens
//   GET  /api/v1/auth/me                              → profil + établissements
//   POST /api/v1/auth/forgot-password[/verify|/reset] → mot de passe oublié
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const path = require("path");
const pug = require("pug");
const jwt = require("jsonwebtoken");
const speakeasy = require("speakeasy");
const { OAuth2Client } = require("google-auth-library");
const User = require("../../db/models/user.model");
const LoginEvent = require("../../db/models/loginEvent.model");
const { sendEmail } = require("../../utils/mailer");
const { issueTokens, verifyToken, epochMatches, SECRET: TOKEN_SECRET } = require("../../utils/mobileJwt");
const { resolveCompanyContext } = require("../../utils/mobileCompanyContext");
const { verifyAppleIdentityToken } = require("../../utils/appleAuth");
const {
  EMAIL_RE,
  validatePassword,
  emailIsTaken,
  createAccount,
  isSafePlainText,
} = require("./accountCreation");

// ── Google Sign-In ────────────────────────────────────────────────────────
// L'app obtient un idToken côté client ; on le vérifie ici. L'audience doit
// lister TOUS les client IDs susceptibles d'émettre un token pour cette app
// (web pour Expo web, iOS et Android pour les builds natifs).
const googleClient = new OAuth2Client();
const GOOGLE_AUDIENCES = [
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_ID_IOS,
  process.env.GOOGLE_CLIENT_ID_ANDROID,
  process.env.GOOGLE_CLIENT_ID_WEB,
].filter(Boolean);

// Journalise une connexion réussie (même flux d'activité que l'app web).
// `method` respecte l'enum du modèle : "local" (mot de passe) ou "2fa".
function logLogin(user, method) {
  LoginEvent.create({ user: user._id, method }).catch(() => {});
}

// Même secret que les tokens d'accès, mais résolu par utils/mobileJwt : il n'y
// a ainsi qu'UN seul endroit où le secret est lu, et aucune valeur de repli
// littérale ne peut réapparaître ici.
const CHALLENGE_SECRET = TOKEN_SECRET;

// Sérialise le contexte établissement pour l'app : établissement actif
// (résumé), permissions résolues, et liste des établissements accessibles.
// On ne renvoie PAS le document Company brut (schedule, réglages…) — l'app le
// récupérera via des endpoints dédiés si besoin.
function publicContext(ctx) {
  if (!ctx) return null;
  const c = ctx.currentCompany;
  return {
    activeCompany: {
      id: String(c._id),
      name: c.name || "Établissement",
      photo: c.photo || "",
      role: ctx.role,
      isOwner: ctx.isOwner,
      slotTime: c.slotTime || 30,
      // Forfait porté par l'ÉTABLISSEMENT (facturation par établissement) :
      // c'est lui qui fait foi, pas `user.subscription.plan`. Sans ce champ,
      // le profil affichait le forfait du compte connecté — donc « Gratuit »
      // pour un collaborateur travaillant dans un établissement Business.
      plan: ctx.plan,
    },
    permissions: ctx.permissions,
    companies: ctx.companies,
  };
}

// Sérialise le profil renvoyé à l'app (jamais de champs sensibles).
function publicProfile(user) {
  return {
    id: String(user._id),
    fullName: user.fullName || "",
    email: user.email || "",
    phone: user.phone || "",
    profilePicture: user.profilePicture || "/images/no-user.webp",
    businessName: user.businessName || "",
    preferredLang: user.preferredLang || "fr",
    plan: user.subscription?.plan || "basic",
  };
}

// POST /api/v1/auth/login
exports.login = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) {
      return res.status(400).json({ error: "missing_credentials", message: "Email et mot de passe requis." });
    }

    const user = await User.findOne({ email });
    // Message volontairement identique (compte inexistant / mauvais mdp) pour
    // ne pas révéler quels emails existent.
    const invalid = () =>
      res.status(401).json({ error: "invalid_credentials", message: "Email ou mot de passe incorrect." });

    if (!user || !user.password) return invalid(); // pas de mdp = compte Google
    const match = await bcrypt.compare(password, user.password);
    if (!match) return invalid();
    if (user.isDisabled) {
      return res.status(403).json({ error: "account_disabled", message: "Ce compte a été désactivé." });
    }

    // 2FA activée → on n'émet pas les tokens tout de suite : on renvoie un
    // challenge court (5 min) que l'app rejoue avec le code TOTP.
    if (user.twoFA?.enabled) {
      // `jti` généré ici (donc infalsifiable) : il sert de clé au compteur de
      // tentatives de /auth/2fa. Sans lui, le challenge serait rejouable à
      // l'infini et les 10^6 codes TOTP se testeraient tranquillement.
      const challengeToken = jwt.sign(
        { sub: String(user._id), typ: "2fa", jti: crypto.randomUUID() },
        CHALLENGE_SECRET,
        { expiresIn: "5m" },
      );
      return res.json({ twoFactorRequired: true, challengeToken });
    }

    const tokens = issueTokens(user._id, user.tokenEpoch);
    user.lastLoginAt = new Date();
    await user.save();
    logLogin(user, "local");

    const context = await resolveCompanyContext(user);
    res.json({ ...tokens, user: publicProfile(user), context: publicContext(context) });
  } catch (err) {
    console.error("[mobile login]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/auth/register
// Inscription par mot de passe. Applique exactement les mêmes règles que
// l'inscription web (nom sûr, email libre dans User ET Client, politique de
// mot de passe), puis connecte directement en renvoyant les tokens.
exports.register = async (req, res) => {
  try {
    const fullName = String(req.body.fullName || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirmPassword ?? password);
    const accountIntent = req.body.accountIntent;
    const businessType = String(req.body.businessType || "").trim();

    const bad = (message, error = "invalid_input") => res.status(400).json({ error, message });

    if (!fullName || !isSafePlainText(fullName)) {
      return bad("Le nom ne peut pas contenir les caractères < ou >.");
    }
    if (!EMAIL_RE.test(email)) {
      return bad("Veuillez entrer une adresse email valide.");
    }
    if (password.trim() !== confirmPassword.trim()) {
      return bad("Les mots de passe ne correspondent pas.");
    }
    const pwdError = validatePassword(password);
    if (pwdError) return bad(pwdError);

    // Un pro qui crée son établissement doit indiquer son métier.
    if (accountIntent === "pro" && !businessType) {
      return bad("Veuillez indiquer votre métier.");
    }

    if (await emailIsTaken(email)) {
      return res.status(409).json({ error: "email_taken", message: "Cette adresse email est déjà utilisée." });
    }

    const hashedPassword = await bcrypt.hash(password.trim(), 10);
    const user = await createAccount({ fullName, email, hashedPassword, accountIntent, businessType });

    const tokens = issueTokens(user._id, user.tokenEpoch);
    logLogin(user, "local");

    const context = await resolveCompanyContext(user);
    res.status(201).json({ ...tokens, user: publicProfile(user), context: publicContext(context) });
  } catch (err) {
    // Course entre deux inscriptions simultanées sur le même email.
    if (err && err.code === 11000) {
      return res.status(409).json({ error: "email_taken", message: "Cette adresse email est déjà utilisée." });
    }
    console.error("[mobile register]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/auth/google
// Connexion ET inscription via Google. L'app obtient un idToken auprès de
// Google, on le vérifie ici (signature + audience) puis on rattache ou crée
// le compte. Sert les deux cas : « Continuer avec Google » et « S'inscrire
// avec Google » — c'est le même flux, seul le résultat diffère.
exports.google = async (req, res) => {
  try {
    const idToken = String(req.body.idToken || "");
    if (!idToken) {
      return res.status(400).json({ error: "missing_token", message: "Jeton Google manquant." });
    }
    if (!GOOGLE_AUDIENCES.length) {
      return res.status(503).json({
        error: "google_not_configured",
        message: "La connexion Google n'est pas configurée sur le serveur.",
      });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_AUDIENCES });
      payload = ticket.getPayload();
    } catch (_) {
      return res.status(401).json({ error: "invalid_google_token", message: "Jeton Google invalide ou expiré." });
    }

    // Google garantit email_verified pour les comptes Gmail/Workspace ; on
    // refuse un email non vérifié, sinon n'importe qui pourrait revendiquer
    // l'adresse d'un compte existant.
    if (!payload?.email || payload.email_verified === false) {
      return res.status(401).json({ error: "email_not_verified", message: "Adresse Google non vérifiée." });
    }

    const email = String(payload.email).toLowerCase().trim();
    const googleId = payload.sub;

    // Compte existant : par googleId (déjà lié) ou par email (on lie alors le
    // googleId au passage), même logique que l'OAuth web.
    let user = await User.findOne({ $or: [{ googleId }, { email }] });

    if (user) {
      if (user.isDisabled) {
        return res.status(403).json({ error: "account_disabled", message: "Ce compte a été désactivé." });
      }
      let touched = false;
      if (!user.googleId) { user.googleId = googleId; touched = true; }
      if ((!user.profilePicture || user.profilePicture === "/images/no-user.webp") && payload.picture) {
        user.profilePicture = payload.picture; touched = true;
      }
      user.lastLoginAt = new Date();
      await user.save();
      if (touched) { /* googleId/photo rattachés */ }

      const tokens = issueTokens(user._id, user.tokenEpoch);
      logLogin(user, "google");
      const context = await resolveCompanyContext(user);
      return res.json({ ...tokens, user: publicProfile(user), context: publicContext(context), created: false });
    }

    // Un compte Client historique existe avec cet email → on refuse plutôt que
    // de créer un doublon (même garde que l'inscription par mot de passe).
    if (await emailIsTaken(email)) {
      return res.status(409).json({
        error: "email_taken",
        message: "Un compte existe déjà avec cette adresse. Connectez-vous avec votre mot de passe.",
      });
    }

    // Nouveau compte : mot de passe aléatoire (jamais utilisé, l'accès se fait
    // par Google) — même convention que l'inscription Google du web.
    const randomPassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
    const fullName = String(payload.name || email.split("@")[0]).replace(/[<>]/g, "").trim() || "Utilisateur";

    user = await createAccount({
      fullName,
      email,
      hashedPassword: randomPassword,
      accountIntent: req.body.accountIntent,
      businessType: String(req.body.businessType || "").trim(),
      googleId,
      profilePicture: payload.picture || undefined,
    });

    const tokens = issueTokens(user._id, user.tokenEpoch);
    logLogin(user, "google");
    const context = await resolveCompanyContext(user);
    res.status(201).json({ ...tokens, user: publicProfile(user), context: publicContext(context), created: true });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: "email_taken", message: "Cette adresse email est déjà utilisée." });
    }
    console.error("[mobile google]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/auth/apple
// Connexion ET inscription via « Se connecter avec Apple ». Même contrat que
// /auth/google ci-dessus (rattachement par identifiant puis par email, création
// sinon) — imposé par la règle App Store 4.8 dès lors qu'une connexion tierce
// est proposée.
//
// DEUX PARTICULARITÉS APPLE, qui expliquent tout ce qui diffère de Google :
//   • Le NOM n'est transmis QU'À LA TOUTE PREMIÈRE connexion, et jamais dans le
//     jeton : il arrive dans le corps de la requête. On ne s'en sert donc que
//     si le compte est créé — sur une connexion suivante il est absent, et
//     l'écraser par une valeur vide effacerait le nom du compte.
//   • L'EMAIL peut être un relais privé (@privaterelay.appleid.com) si
//     l'utilisateur a choisi de masquer son adresse. C'est une adresse valide
//     qui relaie bien les emails : on l'accepte telle quelle.
exports.apple = async (req, res) => {
  try {
    const identityToken = String(req.body.identityToken || "");
    if (!identityToken) {
      return res.status(400).json({ error: "missing_token", message: "Jeton Apple manquant." });
    }

    let payload;
    try {
      payload = await verifyAppleIdentityToken(identityToken);
    } catch (err) {
      // Panne réseau côté Apple (clés injoignables) → 503, pas 401 : ce n'est
      // pas la faute du jeton, et l'app doit pouvoir proposer de réessayer.
      const msg = String(err?.message || "");
      if (msg.startsWith("apple_keys_") || err?.name === "TimeoutError") {
        console.error("[mobile apple] clés Apple injoignables :", msg);
        return res.status(503).json({
          error: "apple_unavailable",
          message: "La connexion Apple est momentanément indisponible. Réessayez.",
        });
      }
      return res.status(401).json({ error: "invalid_apple_token", message: "Jeton Apple invalide ou expiré." });
    }

    const appleId = payload.sub;
    if (!appleId) {
      return res.status(401).json({ error: "invalid_apple_token", message: "Jeton Apple invalide." });
    }

    // Apple sérialise parfois les booléens en chaînes ("true"/"false").
    const emailVerified = payload.email_verified === true || payload.email_verified === "true";
    const email = payload.email ? String(payload.email).toLowerCase().trim() : "";
    if (email && !emailVerified) {
      return res.status(401).json({ error: "email_not_verified", message: "Adresse Apple non vérifiée." });
    }

    // Compte existant : par appleId (déjà lié) ou par email (on lie alors
    // l'appleId au passage), exactement comme le flux Google.
    // Sans email dans le jeton (connexions suivantes avec relais privé sur
    // certains comptes), seul l'appleId permet de retrouver le compte.
    let user = await User.findOne(email ? { $or: [{ appleId }, { email }] } : { appleId });

    if (user) {
      if (user.isDisabled) {
        return res.status(403).json({ error: "account_disabled", message: "Ce compte a été désactivé." });
      }
      if (!user.appleId) user.appleId = appleId;
      user.lastLoginAt = new Date();
      await user.save();

      const tokens = issueTokens(user._id, user.tokenEpoch);
      logLogin(user, "apple");
      const context = await resolveCompanyContext(user);
      return res.json({ ...tokens, user: publicProfile(user), context: publicContext(context), created: false });
    }

    // Aucun compte et aucun email exploitable : impossible d'en créer un. Se
    // produit si l'utilisateur a déjà autorisé l'app puis supprimé son compte
    // Branshee ; il doit alors retirer l'app dans Réglages > Apple ID pour
    // qu'Apple renvoie de nouveau son adresse.
    if (!email) {
      return res.status(400).json({
        error: "apple_email_missing",
        message:
          "Apple n'a pas transmis votre adresse email. Dans Réglages > votre nom > Connexion et sécurité, retirez Branshee Pro puis réessayez.",
      });
    }

    // Un compte Client historique existe avec cet email → même garde que Google.
    if (await emailIsTaken(email)) {
      return res.status(409).json({
        error: "email_taken",
        message: "Un compte existe déjà avec cette adresse. Connectez-vous avec votre mot de passe.",
      });
    }

    // Le nom : uniquement à la création, et seulement s'il est exploitable.
    const rawName =
      typeof req.body.fullName === "string"
        ? req.body.fullName
        : [req.body.fullName?.givenName, req.body.fullName?.familyName].filter(Boolean).join(" ");
    const fullName = String(rawName || "").replace(/[<>]/g, "").trim() || email.split("@")[0] || "Utilisateur";

    // Mot de passe aléatoire, jamais utilisé (l'accès se fait par Apple) —
    // même convention que l'inscription Google.
    const randomPassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

    user = await createAccount({
      fullName,
      email,
      hashedPassword: randomPassword,
      accountIntent: req.body.accountIntent,
      businessType: String(req.body.businessType || "").trim(),
      appleId,
    });

    const tokens = issueTokens(user._id, user.tokenEpoch);
    logLogin(user, "apple");
    const context = await resolveCompanyContext(user);
    res.status(201).json({ ...tokens, user: publicProfile(user), context: publicContext(context), created: true });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: "email_taken", message: "Cette adresse email est déjà utilisée." });
    }
    console.error("[mobile apple]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/auth/2fa
exports.verify2fa = async (req, res) => {
  try {
    const { challengeToken, code } = req.body || {};
    if (!challengeToken || !code) {
      return res.status(400).json({ error: "missing_fields", message: "Challenge et code requis." });
    }
    let payload;
    try {
      payload = jwt.verify(challengeToken, CHALLENGE_SECRET);
    } catch (_) {
      return res.status(401).json({ error: "challenge_expired", message: "Challenge expiré, reconnectez-vous." });
    }
    if (payload.typ !== "2fa" || !payload.jti) {
      // Pas de `jti` = challenge émis avant la mise en place du compteur : on
      // le refuse plutôt que de laisser une porte sans limite de tentatives
      // (le challenge ne vit que 5 minutes, l'impact est nul).
      return res.status(401).json({ error: "invalid_challenge", message: "Challenge invalide." });
    }

    // Le second facteur ne protège plus rien s'il est brute-forçable :
    // `window: 1` rend 3 codes valides sur 10^6, et le challenge se rejoue
    // autant de fois qu'on veut. Même mécanisme que le mot de passe oublié.
    const attempts = bumpAttempts(payload.jti);
    if (attempts > TWO_FA_MAX_ATTEMPTS) {
      return res.status(429).json({
        error: "too_many_attempts",
        message: "Trop de tentatives. Reconnectez-vous pour obtenir un nouveau code.",
      });
    }

    const user = await User.findById(payload.sub);
    if (!user || !user.twoFA?.enabled) {
      return res.status(401).json({ error: "invalid_challenge", message: "Challenge invalide." });
    }

    const ok = speakeasy.totp.verify({
      secret: user.twoFA.secret,
      encoding: "base32",
      token: String(code).trim(),
      window: 1,
    });
    if (!ok) return res.status(401).json({ error: "invalid_code", message: "Code incorrect." });

    const tokens = issueTokens(user._id, user.tokenEpoch);
    user.lastLoginAt = new Date();
    await user.save();
    logLogin(user, "2fa");

    const context = await resolveCompanyContext(user);
    res.json({ ...tokens, user: publicProfile(user), context: publicContext(context) });
  } catch (err) {
    console.error("[mobile 2fa]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/auth/refresh
exports.refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ error: "missing_token", message: "Refresh token requis." });

    let payload;
    try {
      payload = verifyToken(refreshToken);
    } catch (_) {
      return res.status(401).json({ error: "invalid_refresh", message: "Session expirée, reconnectez-vous." });
    }
    if (payload.typ !== "refresh") {
      return res.status(401).json({ error: "invalid_refresh", message: "Token invalide." });
    }

    const user = await User.findById(payload.sub).select("_id isDisabled tokenEpoch");
    if (!user || user.isDisabled) {
      return res.status(401).json({ error: "invalid_refresh", message: "Session invalide." });
    }
    // Refresh émis avant le dernier changement de mot de passe → refusé, sinon
    // un jeton volé se renouvellerait indéfiniment malgré le changement.
    if (!epochMatches(payload, user)) {
      return res.status(401).json({ error: "invalid_refresh", message: "Session expirée, reconnectez-vous." });
    }

    res.json(issueTokens(user._id, user.tokenEpoch));
  } catch (err) {
    console.error("[mobile refresh]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── Mot de passe oublié ───────────────────────────────────────────────────
// Réplique controllers/auth.controller.js (forgotPasswordVerifyCode,
// checkCodePwd, newPwd) : code à 6 chiffres par email via crypto.randomInt,
// expiration 15 minutes, 6 tentatives maximum, usage unique, et surtout
// anti-énumération (on répond toujours « succès », même si l'email est inconnu).
//
// DIFFÉRENCE ASSUMÉE : l'API mobile est SANS SESSION. Là où le web garde
// l'état dans req.session.forgotPwd, on transporte ici un jeton signé (même
// approche que le challenge 2FA ci-dessus) :
//   1. /forgot-password        → resetToken { typ:"pwdreset",   email, ch, jti }
//   2. /forgot-password/verify → resetToken { typ:"pwdresetok", email, pv }
//   3. /forgot-password/reset  → consomme ce dernier jeton
//
// `ch` est un HMAC du code avec le secret serveur : le jeton est lisible par
// le client (un JWT n'est pas chiffré), mais sans le secret il est impossible
// de retrouver le code à 6 chiffres à partir du HMAC — sinon un simple
// « j'ai oublié mon mot de passe » sur l'email d'un tiers aurait suffi à le
// deviner hors ligne, sans jamais accéder à sa boîte mail.
//
// `pv` est une empreinte du mot de passe ACTUEL : dès que le mot de passe
// change, elle ne correspond plus, ce qui rend le jeton inutilisable une
// seconde fois. C'est l'équivalent stateless du `delete req.session.forgotPwd`.
const RESET_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 6;
// Codes TOTP : surface bien plus étroite (6 chiffres, 3 codes valides à la
// fois avec window:1) → plafond plus strict que le code envoyé par email.
const TWO_FA_MAX_ATTEMPTS = 5;

// Plafond d'ENVOIS par adresse email (le plafond ci-dessus ne borne que les
// tentatives de saisie d'un code déjà émis). Sans lui, une boucle sur
// /forgot-password inonde la boîte mail de la victime et abîme la réputation
// d'expéditeur du domaine.
const RESET_SEND_MAX = 3;
const resetSends = new Map(); // email → { count, expiresAt }

// Retourne true si l'envoi est autorisé, false si le plafond est atteint.
function allowResetSend(email) {
  const now = Date.now();
  for (const [key, entry] of resetSends) {
    if (entry.expiresAt <= now) resetSends.delete(key);
  }
  const entry = resetSends.get(email) || { count: 0, expiresAt: now + RESET_TTL_MS };
  if (entry.count >= RESET_SEND_MAX) return false;
  entry.count += 1;
  resetSends.set(email, entry);
  return true;
}

// Compteur de tentatives, côté serveur, indexé par le `jti` du jeton (généré
// ici, donc infalsifiable). Un compteur porté PAR le jeton serait inefficace :
// il suffirait de rejouer indéfiniment le premier jeton pour tester les 10^6
// codes. La mémoire suffit — les codes ne vivent que 15 minutes, et un
// redémarrage ne fait qu'invalider des tentatives en cours.
const resetAttempts = new Map(); // jti → { count, expiresAt }

function bumpAttempts(jti) {
  const now = Date.now();
  // Purge à la volée : la table ne peut pas grossir indéfiniment.
  for (const [key, entry] of resetAttempts) {
    if (entry.expiresAt <= now) resetAttempts.delete(key);
  }
  const entry = resetAttempts.get(jti) || { count: 0, expiresAt: now + RESET_TTL_MS };
  entry.count += 1;
  resetAttempts.set(jti, entry);
  return entry.count;
}

function codeFingerprint(email, code) {
  return crypto.createHmac("sha256", CHALLENGE_SECRET).update(`${email}:${code}`).digest("hex");
}

function passwordFingerprint(hashedPassword) {
  return crypto.createHash("sha256").update(String(hashedPassword || "")).digest("hex").slice(0, 32);
}

// Comparaison à temps constant (les deux empreintes ont toujours la même taille).
function sameDigest(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// POST /api/v1/auth/forgot-password  { email }
exports.forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase().trim();
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "invalid_email", message: "Veuillez entrer une adresse email valide." });
    }

    // Plafond par ADRESSE, appliqué avant toute lecture en base : la réponse
    // est identique pour un compte existant ou non, l'anti-énumération reste
    // donc intacte.
    if (!allowResetSend(email)) {
      return res.status(429).json({
        error: "too_many_requests",
        message: "Trop de demandes pour cette adresse. Réessayez dans quelques minutes.",
      });
    }

    const user = await User.findOne({ email }).select("_id").lean();

    // Le code n'est généré et envoyé que si le compte existe. Sinon on émet
    // quand même un jeton, mais adossé à une empreinte aléatoire : la suite du
    // parcours est identique côté client, et aucune tentative ne pourra
    // aboutir. Impossible de savoir si l'adresse est inscrite.
    let fingerprint;
    if (user) {
      const code = crypto.randomInt(100000, 1000000);
      fingerprint = codeFingerprint(email, String(code));
      const resetHtml = pug.renderFile(
        path.join(__dirname, "../../views/templates/emails/reset-password.pug"),
        { code },
      );
      await sendEmail(
        email,
        "Code de réinitialisation de votre mot de passe — BranShee",
        resetHtml,
      ).catch((e) => console.error("[mobile reset email]", e.message));
    } else {
      fingerprint = crypto.randomBytes(32).toString("hex");
    }

    const expSeconds = Math.floor((Date.now() + RESET_TTL_MS) / 1000);
    const resetToken = jwt.sign(
      { typ: "pwdreset", email, ch: fingerprint, jti: crypto.randomUUID(), exp: expSeconds },
      CHALLENGE_SECRET,
    );

    res.json({ ok: true, resetToken, expiresIn: RESET_TTL_MS / 1000 });
  } catch (err) {
    console.error("[mobile forgot-password]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/auth/forgot-password/verify  { resetToken, code }
// Le même jeton se rejoue à chaque essai : c'est le compteur serveur, indexé
// par son `jti`, qui applique la limite de 6 tentatives du web.
exports.forgotPasswordVerify = async (req, res) => {
  try {
    const { resetToken, code } = req.body || {};
    if (!resetToken || !code) {
      return res.status(400).json({ error: "missing_fields", message: "Jeton et code requis." });
    }

    let payload;
    try {
      payload = jwt.verify(resetToken, CHALLENGE_SECRET);
    } catch (_) {
      return res.status(401).json({
        error: "reset_expired",
        message: "Le code a expiré. Recommencez la procédure.",
      });
    }
    if (payload.typ !== "pwdreset") {
      return res.status(401).json({ error: "invalid_token", message: "Jeton invalide." });
    }

    const attempts = bumpAttempts(payload.jti);
    if (attempts > RESET_MAX_ATTEMPTS) {
      return res.status(429).json({
        error: "too_many_attempts",
        message: "Trop de tentatives. Recommencez la procédure.",
      });
    }

    const submitted = String(code).trim();
    if (!/^\d{6}$/.test(submitted) || !sameDigest(codeFingerprint(payload.email, submitted), payload.ch)) {
      return res.status(401).json({
        error: "invalid_code",
        message: "Code incorrect.",
        attemptsLeft: RESET_MAX_ATTEMPTS - attempts,
      });
    }

    // Code bon : on émet le jeton de l'étape finale, lié au mot de passe
    // actuel pour qu'il ne serve qu'une fois.
    const user = await User.findOne({ email: payload.email }).select("password").lean();
    if (!user) {
      // Ne devrait pas arriver (le code n'est envoyé qu'aux comptes existants),
      // mais on reste muet sur l'existence du compte.
      return res.status(401).json({ error: "invalid_code", message: "Code incorrect." });
    }

    const verifiedToken = jwt.sign(
      { typ: "pwdresetok", email: payload.email, pv: passwordFingerprint(user.password), exp: payload.exp },
      CHALLENGE_SECRET,
    );

    res.json({ ok: true, resetToken: verifiedToken });
  } catch (err) {
    console.error("[mobile forgot-password verify]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/auth/forgot-password/reset  { resetToken, password }
exports.forgotPasswordReset = async (req, res) => {
  try {
    const { resetToken } = req.body || {};
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirmPassword ?? password);

    if (!resetToken) {
      return res.status(400).json({ error: "missing_token", message: "Jeton requis." });
    }

    let payload;
    try {
      payload = jwt.verify(resetToken, CHALLENGE_SECRET);
    } catch (_) {
      return res.status(401).json({
        error: "reset_expired",
        message: "Le code a expiré. Recommencez la procédure.",
      });
    }
    if (payload.typ !== "pwdresetok") {
      return res.status(401).json({ error: "invalid_token", message: "Jeton invalide." });
    }

    if (password.trim() !== confirmPassword.trim()) {
      return res.status(400).json({ error: "invalid_input", message: "Les mots de passe ne correspondent pas." });
    }
    const pwdError = validatePassword(password);
    if (pwdError) return res.status(400).json({ error: "weak_password", message: pwdError });

    const user = await User.findOne({ email: payload.email }).select("password tokenEpoch");
    if (!user) {
      return res.status(401).json({ error: "invalid_token", message: "Jeton invalide." });
    }
    // Usage unique : l'empreinte du mot de passe a changé → le jeton a déjà
    // servi (ou le mot de passe a été modifié entre-temps).
    if (!sameDigest(passwordFingerprint(user.password), payload.pv)) {
      return res.status(401).json({
        error: "token_used",
        message: "Ce lien de réinitialisation a déjà été utilisé. Recommencez la procédure.",
      });
    }

    user.password = await bcrypt.hash(password.trim(), 10);
    // Réinitialiser son mot de passe doit couper l'accès des appareils déjà
    // connectés : c'est le geste que fait une victime dont le téléphone (ou
    // le refresh token) a été volé.
    user.tokenEpoch = (user.tokenEpoch || 0) + 1;
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    console.error("[mobile forgot-password reset]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// GET /api/v1/auth/me
exports.me = async (req, res) => {
  try {
    const user = req.mobileUser;
    const requestedCompanyId = req.query.companyId || req.headers["x-company-id"];
    const context = await resolveCompanyContext(user, requestedCompanyId);
    res.json({ user: publicProfile(user), context: publicContext(context) });
  } catch (err) {
    console.error("[mobile me]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
