// ── API mobile : paramètres du compte & sécurité ──────────────────────────
// Ces routes concernent le COMPTE (pas un établissement) : elles sont montées
// avant `mobileCompany` et travaillent sur `req.mobileUser`.
//   PATCH /account/profile        { fullName, phone }
//   POST  /account/password       { oldPassword, newPassword }
//   PATCH /account/language       { lang }
//   PATCH /account/notifications  { newBooking, cancellation }
//   POST  /account/photo          (multipart, champ "photo")
//   DELETE /account/photo
//   GET   /account/2fa/status
//   POST  /account/delete/request  → code par email + récapitulatif
//   POST  /account/delete/confirm  { challengeToken, code }
//
// La logique reprend celle du web (controllers/account.controller.js :
// updateAccountInfo, updatePassword, updateLanguage, sendDeleteCode,
// deleteAccount, editProfilePicture, et admin.controller.js :
// saveNotificationSettings).
const bcrypt = require("bcrypt");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pug = require("pug");
const jwt = require("jsonwebtoken");
const User = require("../../db/models/user.model");
const { isSafePlainText } = require("../../utils/validateName");
const { sendEmail } = require("../../utils/mailer");
const { SECRET: CHALLENGE_SECRET } = require("../../utils/mobileJwt");

// Langues proposées par l'interface — identique au web (updateLanguage).
const ALLOWED_LANGS = ["fr", "en", "nl", "de", "es", "it"];

// « Pas de photo » s'écrit ainsi partout dans le projet (défaut du modèle
// User, gabarits Pug, publicProfile de l'API) — jamais une chaîne vide, qui
// afficherait une image cassée sur le site.
const NO_PHOTO = "/images/no-user.webp";

// Même tolérance que le champ "téléphone pro" du web : +32 476 12 34 56,
// 0476123456, (02) 123-45-67…
const PHONE_RE = /^\+?[\d\s\-().]{6,20}$/;

// PATCH /api/v1/account/profile
exports.updateProfile = async (req, res) => {
  try {
    const user = req.mobileUser;
    const updates = {};

    if (req.body.fullName !== undefined) {
      const fullName = String(req.body.fullName || "").trim();
      if (!fullName) {
        return res.status(400).json({ error: "missing_name", message: "Indiquez votre nom." });
      }
      if (!isSafePlainText(fullName)) {
        return res.status(400).json({
          error: "invalid_name",
          message: "Le nom ne peut pas contenir les caractères < ou >.",
        });
      }
      updates.fullName = fullName;
    }

    if (req.body.phone !== undefined) {
      const phone = String(req.body.phone || "").trim();
      if (phone && !PHONE_RE.test(phone)) {
        return res.status(400).json({
          error: "invalid_phone",
          message: "Numéro invalide. Exemple : +32 476 12 34 56.",
        });
      }
      updates.phone = phone;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: "nothing_to_update", message: "Aucune modification envoyée." });
    }

    await User.updateOne({ _id: user._id }, { $set: updates });

    res.json({
      ok: true,
      profile: {
        fullName: updates.fullName !== undefined ? updates.fullName : user.fullName || "",
        phone: updates.phone !== undefined ? updates.phone : user.phone || "",
      },
    });
  } catch (err) {
    console.error("[mobile account profile]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/account/password
// Mêmes règles que l'inscription : 8 caractères, 1 chiffre, 1 caractère
// spécial ; le mot de passe actuel est toujours exigé.
exports.updatePassword = async (req, res) => {
  try {
    const oldPassword = String(req.body.oldPassword || "");
    const newPassword = String(req.body.newPassword || "");

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: "missing_fields", message: "Mot de passe actuel et nouveau requis." });
    }

    const trimmed = newPassword.trim();
    if (trimmed.length < 8) {
      return res.status(400).json({
        error: "weak_password",
        message: "Le mot de passe doit contenir au moins 8 caractères.",
      });
    }
    if (!/[0-9]/.test(trimmed)) {
      return res.status(400).json({
        error: "weak_password",
        message: "Le mot de passe doit contenir au moins un chiffre.",
      });
    }
    if (!/[^a-zA-Z0-9]/.test(trimmed)) {
      return res.status(400).json({
        error: "weak_password",
        message: "Le mot de passe doit contenir au moins un caractère spécial (ex: !, @, #…).",
      });
    }

    // `req.mobileUser` est chargé sans le mot de passe : on le relit ici.
    const user = await User.findById(req.mobileUser._id).select("password tokenEpoch");
    if (!user) {
      return res.status(404).json({ error: "user_not_found", message: "Compte introuvable." });
    }
    if (!user.password) {
      return res.status(400).json({
        error: "no_password",
        message: "Ce compte se connecte avec Google : il n'a pas de mot de passe à modifier.",
      });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "wrong_password", message: "Mot de passe actuel incorrect." });
    }

    user.password = await bcrypt.hash(trimmed, 10);
    // Change de mot de passe = révocation de tous les jetons mobiles déjà
    // émis (y compris le refresh, qui vit 60 jours). L'appareil courant se
    // reconnectera à la prochaine requête.
    user.tokenEpoch = (user.tokenEpoch || 0) + 1;
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    console.error("[mobile account password]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PATCH /api/v1/account/language
exports.updateLanguage = async (req, res) => {
  try {
    const lang = String(req.body.lang || "").trim().toLowerCase();
    if (!ALLOWED_LANGS.includes(lang)) {
      return res.status(400).json({ error: "unsupported_language", message: "Langue non supportée." });
    }

    await User.updateOne({ _id: req.mobileUser._id }, { $set: { preferredLang: lang } });
    res.json({ ok: true, lang });
  } catch (err) {
    console.error("[mobile account language]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PATCH /api/v1/account/notifications
// Emails envoyés au professionnel : nouvelle réservation / annulation.
exports.updateNotifications = async (req, res) => {
  try {
    const current = req.mobileUser.notifications || {};
    const newBooking =
      req.body.newBooking === undefined ? current.newBooking !== false : !!req.body.newBooking;
    const cancellation =
      req.body.cancellation === undefined ? current.cancellation !== false : !!req.body.cancellation;

    await User.updateOne(
      { _id: req.mobileUser._id },
      { $set: { "notifications.newBooking": newBooking, "notifications.cancellation": cancellation } },
    );

    res.json({ ok: true, notifications: { newBooking, cancellation } });
  } catch (err) {
    console.error("[mobile account notifications]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// GET /api/v1/account/2fa/status
// Lecture seule : activer ou désactiver la double authentification passe par
// un QR code / un code TOTP, ce qui reste sur le site.
exports.twoFactorStatus = async (req, res) => {
  try {
    res.json({
      enabled: !!(req.mobileUser.twoFA && req.mobileUser.twoFA.enabled),
      manageUrl: "https://www.branshee.com/settings#securite",
    });
  } catch (err) {
    console.error("[mobile account 2fa status]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// GET /api/v1/account/settings
// État complet lu par l'écran « Paramètres du compte » (une seule requête).
exports.getSettings = async (req, res) => {
  try {
    const user = req.mobileUser;
    const notif = user.notifications || {};
    // `req.mobileUser` est chargé sans le mot de passe : on vérifie à part si
    // le compte en a un (les comptes Google n'en ont pas).
    const creds = await User.findById(user._id).select("password").lean();
    const picture = user.profilePicture || NO_PHOTO;
    res.json({
      profile: {
        fullName: user.fullName || "",
        phone: user.phone || "",
        email: user.email || "",
        // Un compte créé via Google n'a pas de mot de passe à changer.
        hasPassword: !!(creds && creds.password),
        profilePicture: picture,
        // Le placeholder n'est PAS une photo : sans ce drapeau, l'app
        // proposerait « Retirer la photo » alors qu'il n'y en a aucune.
        hasPhoto: picture !== NO_PHOTO,
      },
      lang: user.preferredLang || "fr",
      notifications: {
        newBooking: notif.newBooking !== false,
        cancellation: notif.cancellation !== false,
      },
      twoFactor: {
        enabled: !!(user.twoFA && user.twoFA.enabled),
        manageUrl: "https://www.branshee.com/settings#securite",
      },
    });
  } catch (err) {
    console.error("[mobile account settings]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── Photo de profil ───────────────────────────────────────────────────────
// Même chaîne que le site (routes/user/account.js → PATCH
// /account/profile-picture) : multer EN MÉMOIRE, puis
// middlewares/processImageUpload qui valide réellement l'image avec sharp,
// corrige l'orientation EXIF, redimensionne (1600 px max) et écrit un JPEG
// dans public/uploads/profiles. Le filtre de type ci-dessous n'est qu'un
// premier tri : c'est sharp qui fait foi. Le chemin enregistré est identique à
// celui du web (`/uploads/profiles/<fichier>`), donc la photo choisie depuis
// l'app apparaît telle quelle sur le site, et inversement.
const PHOTO_MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_MIME = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  // Photos prises avec un iPhone : le fichier arrive en HEIC/HEIF et est
  // converti en JPEG par processImageUpload.
  "image/heic",
  "image/heif",
];

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(String(file.mimetype).toLowerCase())) return cb(null, true);
    const err = new Error("unsupported_type");
    err.code = "UNSUPPORTED_TYPE";
    cb(err);
  },
}).single("photo");

// Sans ce relais, une image trop lourde ou d'un mauvais type sortait par le
// gestionnaire d'erreurs d'Express — donc en HTML, illisible pour l'app.
exports.photoUploadMiddleware = function photoUploadMiddleware(req, res, next) {
  photoUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "file_too_large",
        message: "Cette image est trop lourde (12 Mo maximum).",
      });
    }
    if (err.code === "UNSUPPORTED_TYPE") {
      return res.status(400).json({
        error: "unsupported_type",
        message: "Format non pris en charge. Envoyez une image JPG, PNG ou WEBP.",
      });
    }
    console.error("[mobile account photo upload]", err.message);
    return res.status(400).json({ error: "upload_failed", message: "Envoi de l'image impossible." });
  });
};

// POST /api/v1/account/photo   (multipart, champ "photo")
exports.setPhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "missing_file", message: "Aucune image reçue." });
    }
    const profilePicture = `/uploads/profiles/${req.file.filename}`;
    // Écriture filtrée sur le compte connecté, jamais sur un autre.
    await User.updateOne({ _id: req.mobileUser._id }, { $set: { profilePicture } });
    res.json({ ok: true, profilePicture, hasPhoto: true });
  } catch (err) {
    console.error("[mobile account photo set]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// DELETE /api/v1/account/photo
// On repose le placeholder du site plutôt qu'une chaîne vide : le modèle User
// en fait son défaut, et les gabarits l'affichent tel quel.
exports.deletePhoto = async (req, res) => {
  try {
    await User.updateOne({ _id: req.mobileUser._id }, { $set: { profilePicture: NO_PHOTO } });
    res.json({ ok: true, profilePicture: NO_PHOTO, hasPhoto: false });
  } catch (err) {
    console.error("[mobile account photo delete]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── Suppression du compte ─────────────────────────────────────────────────
// Exigence Apple 5.1.1(v) : une app qui permet de CRÉER un compte doit
// permettre de le SUPPRIMER depuis l'app. On réplique le flux du web
// (sendDeleteCode / deleteAccount) : code à 6 chiffres envoyé par email, puis
// suppression.
//
// DIFFÉRENCE ASSUMÉE : l'API mobile est SANS SESSION. Là où le web garde le
// code dans req.session.deleteAccount, on transporte ici un jeton signé —
// même approche que le challenge 2FA et que le mot de passe oublié
// (auth.mobile.controller.js) : jwt { typ:"acctdel", sub, ch, jti }, 15 min.
// `ch` est un HMAC du code avec le secret serveur : le JWT est lisible par le
// client, mais le code à 6 chiffres ne s'en déduit pas. `jti` (généré ici,
// donc infalsifiable) sert de clé au compteur de tentatives — sans lui, le
// même jeton se rejouerait à l'infini jusqu'à trouver le code.
//
// La suppression va PLUS LOIN que le web, qui laissait derrière lui les
// services, employés, formulaires, avis, dossiers clients (et leurs PDF sur
// disque), événements de connexion et jetons push, et ne traitait qu'UNE
// Company alors qu'un compte peut en posséder plusieurs.
const DELETE_TTL_MS = 15 * 60 * 1000;
const DELETE_MAX_ATTEMPTS = 5;

// Compteur de tentatives côté serveur, indexé par le `jti` du jeton. La
// mémoire suffit : les codes ne vivent que 15 minutes, et un redémarrage ne
// fait qu'annuler des tentatives en cours.
const deleteAttempts = new Map(); // jti → { count, expiresAt }

function bumpDeleteAttempts(jti) {
  const now = Date.now();
  for (const [key, entry] of deleteAttempts) {
    if (entry.expiresAt <= now) deleteAttempts.delete(key);
  }
  const entry = deleteAttempts.get(jti) || { count: 0, expiresAt: now + DELETE_TTL_MS };
  entry.count += 1;
  deleteAttempts.set(jti, entry);
  return entry.count;
}

function deleteCodeFingerprint(userId, code) {
  return crypto.createHmac("sha256", CHALLENGE_SECRET).update(`del:${userId}:${code}`).digest("hex");
}

// Comparaison à temps constant (les deux empreintes ont toujours la même taille).
function sameDigest(a, b) {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Racine des PDF de dossiers clients — même chemin que le web
// (admin.controller.js : _dossierRoot), les fichiers vivent hors de public/.
const dossierRoot = () => path.join(__dirname, "..", "..", "private_uploads");

// Ce que la suppression détruira, pour que l'app puisse le montrer AVANT.
async function deletionSummary(userId) {
  const Company = require("../../db/models/company/company.model");
  const Booking = require("../../db/models/book.model");

  const companies = await Company.find({ owner: userId }).select("_id name").lean();
  const companyIds = companies.map((c) => c._id);

  let bookings = 0;
  let clients = 0;
  if (companyIds.length) {
    bookings = await Booking.countDocuments({ company: { $in: companyIds } });
    const emails = await Booking.distinct("email", { company: { $in: companyIds } });
    clients = emails.filter((e) => e && String(e).trim()).length;
  }

  return {
    establishments: companies.length,
    establishmentNames: companies.map((c) => c.name || "Établissement"),
    bookings,
    clients,
  };
}

// POST /api/v1/account/delete/request
// Envoie le code et renvoie le récapitulatif. Le code n'est JAMAIS renvoyé.
exports.requestDeletion = async (req, res) => {
  try {
    const user = await User.findById(req.mobileUser._id).select("email").lean();
    if (!user) {
      return res.status(404).json({ error: "user_not_found", message: "Compte introuvable." });
    }

    const summary = await deletionSummary(req.mobileUser._id);

    const code = crypto.randomInt(100000, 1000000);
    const html = pug.renderFile(
      path.join(__dirname, "../../views/templates/emails/verification-code.pug"),
      {
        code,
        subject: "Suppression de compte — Confirmation",
        body: "Voici votre code de confirmation pour supprimer définitivement votre compte BranShee :",
      },
    );
    await sendEmail(user.email, "Suppression de compte — Code de confirmation BranShee", html);

    const challengeToken = jwt.sign(
      {
        typ: "acctdel",
        sub: String(req.mobileUser._id),
        ch: deleteCodeFingerprint(req.mobileUser._id, String(code)),
        jti: crypto.randomUUID(),
      },
      CHALLENGE_SECRET,
      { expiresIn: "15m" },
    );

    res.json({
      ok: true,
      challengeToken,
      expiresIn: DELETE_TTL_MS / 1000,
      email: user.email,
      summary,
    });
  } catch (err) {
    console.error("[mobile account delete request]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// Supprime tout ce qui appartient au compte. Chaque écriture est filtrée par
// établissement possédé ou par utilisateur — jamais de deleteMany({}).
async function purgeAccount(userId) {
  const Company = require("../../db/models/company/company.model");
  const Booking = require("../../db/models/book.model");
  const DaysOff = require("../../db/models/company/daysOff.model");
  const Service = require("../../db/models/company/service.model");
  const Employee = require("../../db/models/company/employee.model");
  const Form = require("../../db/models/form.model");
  const Review = require("../../db/models/review.model");
  const ReviewReport = require("../../db/models/review-report.model");
  const ClientDossier = require("../../db/models/clientDossier.model");
  const Site = require("../../db/models/site.model");
  const ActivityLog = require("../../db/models/activityLog.model");
  const CompanyGrade = require("../../db/models/company/companyGrade.model");
  const CompanyMembership = require("../../db/models/company/companyMembership.model");
  const Subscription = require("../../db/models/subscription.model");
  const LoginEvent = require("../../db/models/loginEvent.model");
  const PushToken = require("../../db/models/pushToken.model");
  const AdminMessage = require("../../db/models/adminMessage.model");
  const PromoCode = require("../../db/models/promoCode.model");

  // ── 1. Tous les établissements POSSÉDÉS (le web n'en traitait qu'un) ────
  const companies = await Company.find({ owner: userId }).select("_id").lean();
  const companyIds = companies.map((c) => c._id);

  if (companyIds.length) {
    // Les PDF des dossiers clients vivent sur le disque : supprimer les
    // lignes Mongo sans eux laisserait des données de santé orphelines.
    const dossiers = await ClientDossier.find({ company: { $in: companyIds } })
      .select("entries.attachment.path")
      .lean();
    const root = dossierRoot();
    for (const dossier of dossiers) {
      for (const entry of dossier.entries || []) {
        const rel = entry && entry.attachment && entry.attachment.path;
        if (!rel) continue;
        try {
          const full = path.join(root, rel);
          if (full.startsWith(root) && fs.existsSync(full)) fs.unlinkSync(full);
        } catch (_) {
          /* un fichier déjà absent ne doit pas bloquer la suppression */
        }
      }
    }

    await ClientDossier.deleteMany({ company: { $in: companyIds } });
    await Booking.deleteMany({ company: { $in: companyIds } });
    await DaysOff.deleteMany({ company: { $in: companyIds } });
    await Service.deleteMany({ company: { $in: companyIds } });
    await Employee.deleteMany({ company: { $in: companyIds } });
    await Form.deleteMany({ company: { $in: companyIds } });
    await ReviewReport.deleteMany({ company: { $in: companyIds } });
    await Review.deleteMany({ company: { $in: companyIds } });
    await Site.deleteMany({ company: { $in: companyIds } });
    await ActivityLog.deleteMany({ company: { $in: companyIds } });
    await CompanyGrade.deleteMany({ company: { $in: companyIds } });
    await CompanyMembership.deleteMany({ company: { $in: companyIds } });
    await Company.deleteMany({ _id: { $in: companyIds }, owner: userId });
  }

  // ── 2. Traces dans les établissements des AUTRES ───────────────────────
  // Le compte disparaît, ses collaborations aussi. Les rendez-vous déjà pris
  // chez un autre patron ne sont PAS touchés : ils lui appartiennent, et
  // `employeeName` y est stocké en clair — c'est exactement l'état d'un
  // ex-collaborateur retiré de l'équipe. (Les vider serait d'ailleurs
  // impossible sans risque : l'index unique (company, date, startTime,
  // employee) refuserait deux créneaux devenus « non assignés ».)
  // Les congés, eux, ne doivent plus désigner un compte fantôme.
  await CompanyMembership.deleteMany({ user: userId });
  await DaysOff.updateMany(
    { "dates.employees": userId },
    { $pull: { "dates.$[].employees": userId } },
  );
  // L'historique d'activité de l'autre établissement reste lisible : seul le
  // lien vers le compte est coupé (`userName` est déjà stocké à part).
  await ActivityLog.updateMany({ user: userId }, { $set: { user: null } });

  // ── 3. Données strictement personnelles ────────────────────────────────
  await Subscription.deleteMany({ user: userId });
  await LoginEvent.deleteMany({ user: userId });
  await PushToken.deleteMany({ user: userId });
  await AdminMessage.deleteMany({ recipient: userId });
  await AdminMessage.updateMany({ dismissedBy: userId }, { $pull: { dismissedBy: userId } });
  await PromoCode.updateMany({ usedByUsers: userId }, { $pull: { usedByUsers: userId } });
  // Parrainage : les filleuls restent, mais ne référencent plus un compte
  // supprimé (sinon leur page Parrainage plante).
  await User.updateMany({ referredBy: userId }, { $set: { referredBy: null } });

  await User.deleteOne({ _id: userId });
}

// POST /api/v1/account/delete/confirm  { challengeToken, code }
exports.confirmDeletion = async (req, res) => {
  try {
    const { challengeToken, code } = req.body || {};
    if (!challengeToken || !code) {
      return res.status(400).json({ error: "missing_fields", message: "Jeton et code requis." });
    }

    let payload;
    try {
      payload = jwt.verify(challengeToken, CHALLENGE_SECRET);
    } catch (_) {
      return res.status(401).json({
        error: "challenge_expired",
        message: "Le code a expiré. Recommencez la procédure.",
      });
    }
    if (payload.typ !== "acctdel" || !payload.jti) {
      return res.status(401).json({ error: "invalid_challenge", message: "Jeton invalide." });
    }
    // Le jeton doit appartenir au compte authentifié : sans cette garde, un
    // jeton obtenu pour SON compte servirait à supprimer celui d'un autre.
    if (String(payload.sub) !== String(req.mobileUser._id)) {
      return res.status(401).json({ error: "invalid_challenge", message: "Jeton invalide." });
    }

    const attempts = bumpDeleteAttempts(payload.jti);
    if (attempts > DELETE_MAX_ATTEMPTS) {
      return res.status(429).json({
        error: "too_many_attempts",
        message: "Trop de tentatives. Recommencez la procédure.",
      });
    }

    const submitted = String(code).trim();
    if (
      !/^\d{6}$/.test(submitted) ||
      !sameDigest(deleteCodeFingerprint(req.mobileUser._id, submitted), payload.ch)
    ) {
      return res.status(401).json({
        error: "invalid_code",
        message: "Code incorrect.",
        attemptsLeft: Math.max(0, DELETE_MAX_ATTEMPTS - attempts),
      });
    }

    await purgeAccount(req.mobileUser._id);
    deleteAttempts.delete(payload.jti);

    res.json({ ok: true });
  } catch (err) {
    console.error("[mobile account delete confirm]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
