// ── Création de compte pour l'API mobile ──────────────────────────────────
// Reproduit exactement les règles de controllers/auth.controller.js#createUser
// (mêmes validations, même Company par défaut, même code de parrainage, même
// email de bienvenue) — factorisé ici parce que deux chemins mobiles y mènent :
// l'inscription par mot de passe et l'inscription via Google.
const mongoose = require("mongoose");
const pug = require("pug");
const path = require("path");
const User = require("../../db/models/user.model");
const Client = require("../../db/models/client.model");
const Company = require("../../db/models/company/company.model");
const { sendEmail } = require("../../utils/mailer");
const { generateReferralCode } = require("../../utils/referralCode");
const { isSafePlainText } = require("../../utils/validateName");

const ALLOWED_INTENTS = ["pro", "client", "undecided"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Horaires par défaut d'un établissement : lundi→vendredi 9h-18h, week-end
// fermé. Identique à l'inscription web.
function defaultSchedule() {
  return [
    { weekdayIndex: 1, workingHours: [{ start: "09:00", end: "18:00" }] },
    { weekdayIndex: 2, workingHours: [{ start: "09:00", end: "18:00" }] },
    { weekdayIndex: 3, workingHours: [{ start: "09:00", end: "18:00" }] },
    { weekdayIndex: 4, workingHours: [{ start: "09:00", end: "18:00" }] },
    { weekdayIndex: 5, workingHours: [{ start: "09:00", end: "18:00" }] },
    { weekdayIndex: 6, dayOff: true },
    { weekdayIndex: 0, dayOff: true },
  ];
}

// Valide le mot de passe selon la politique du web : 8 caractères minimum,
// au moins un chiffre et un caractère spécial.
function validatePassword(password) {
  const p = String(password || "").trim();
  if (p.length < 8) return "Le mot de passe doit contenir au moins 8 caractères.";
  if (!/[0-9]/.test(p)) return "Le mot de passe doit contenir au moins un chiffre.";
  if (!/[^a-zA-Z0-9]/.test(p)) return "Le mot de passe doit contenir au moins un caractère spécial (ex: !, @, #…).";
  return null;
}

// Vérifie que l'email est libre dans User ET dans Client (comptes clients
// historiques) — sans ça, un même email peut avoir deux comptes fantômes.
async function emailIsTaken(email) {
  const [inUsers, inClients] = await Promise.all([
    User.exists({ email }),
    Client.exists({ email }),
  ]);
  return Boolean(inUsers || inClients);
}

// Crée le User (+ Company si le compte est un pro qui crée son établissement),
// génère le code de parrainage et envoie l'email de bienvenue.
// `password` est déjà haché par l'appelant (ou aléatoire pour Google).
async function createAccount({ fullName, email, hashedPassword, accountIntent, businessType, googleId, appleId, profilePicture }) {
  const intent = ALLOWED_INTENTS.includes(accountIntent) ? accountIntent : "undecided";
  const wantsCompany = intent === "pro";
  const companyId = wantsCompany ? new mongoose.Types.ObjectId() : undefined;
  const referralCode = await generateReferralCode(fullName);

  const user = await User.create({
    fullName,
    email,
    password: hashedPassword,
    company: companyId,
    accountIntent: intent,
    businessType: wantsCompany ? businessType || "" : "",
    referralCode,
    ...(googleId ? { googleId } : {}),
    ...(appleId ? { appleId } : {}),
    ...(profilePicture ? { profilePicture } : {}),
  });

  if (wantsCompany) {
    await Company.create({ _id: companyId, owner: user._id, schedule: defaultSchedule() });

    // Email de bienvenue (pro uniquement) — best-effort, ne bloque jamais.
    try {
      const html = pug.renderFile(
        path.join(__dirname, "../../views/templates/emails/welcome-pro.pug"),
        { fullName: user.fullName },
      );
      sendEmail(user.email, "🎉 Bienvenue sur BranShee — Configurez votre agenda", html).catch(() => {});
    } catch (_) {
      /* template indisponible : on n'empêche pas l'inscription */
    }
  }

  return user;
}

module.exports = {
  ALLOWED_INTENTS,
  EMAIL_RE,
  validatePassword,
  emailIsTaken,
  createAccount,
  isSafePlainText,
};
