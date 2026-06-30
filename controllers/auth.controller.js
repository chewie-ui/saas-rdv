const User = require("../db/models/user.model");
const Client = require("../db/models/client.model");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const { sendEmail } = require("../utils/mailer");
const { getPlan } = require("../utils/planLimits");
const getServices = require("../utils/services");
const pug = require("pug");
const path = require("path");

/** Génère un code parrainage unique de la forme PRENOM-XXXXXX */
async function generateReferralCode(fullName) {
  const base = (fullName || "USER").trim().split(" ")[0]
    .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
  for (let i = 0; i < 10; i++) {
    const code = `${base}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  return `USER-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

exports.createUser = async (req, res) => {
  const isAjax = req.headers["x-requested-with"] === "fetch";

  function fail(msg) {
    if (isAjax) return res.status(400).json({ error: msg });
    return res.render("auth/register", {
      becomeCoach: true, alwaysSticky: true,
      services: getServices(res.locals.lang), error: msg,
    });
  }

  const { fullname, password, conformPassword, businessType } = req.body;
  const email = (req.body.email || "").toLowerCase().trim();

  // Intention déclarée à l'étape 0 du formulaire — seul "pro" déclenche la
  // création d'un établissement (Company). "client"/"undecided" créent un
  // simple compte, sans métier ni page publique (cf. plan d'unification).
  const ALLOWED_INTENTS = ["pro", "client", "undecided"];
  const accountIntent = ALLOWED_INTENTS.includes(req.body.accountIntent) ? req.body.accountIntent : "undecided";
  // "Rejoindre un établissement" (proMode=join) : pas de Company créée pour
  // ce User — une demande "pending" est créée à la place, à approuver par le
  // propriétaire (cf. CompanyMembership). Seul "create" crée un établissement.
  const proMode = req.body.proMode === "join" ? "join" : "create";
  const wantsCompany = accountIntent === "pro" && proMode === "create";
  const wantsToJoin  = accountIntent === "pro" && proMode === "join";
  const joinCompanyId = (req.body.joinCompanyId || "").trim();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email))
    return fail(res.locals.t?.auth?.error_invalid_email || "Veuillez entrer une adresse email valide.");

  // Validate businessType against the allowed list — seulement pour un pro qui crée
  const allowedServices = getServices(res.locals.lang || "fr");
  if (wantsCompany && (!businessType || !allowedServices.includes(businessType)))
    return fail("Veuillez choisir votre métier dans la liste proposée.");

  // Valider l'établissement à rejoindre — doit exister et son propriétaire
  // doit être en plan Business (seul plan pensé pour plusieurs comptes).
  let joinCompany = null;
  if (wantsToJoin) {
    if (!mongoose.Types.ObjectId.isValid(joinCompanyId)) {
      return fail("Veuillez choisir un établissement dans la liste.");
    }
    joinCompany = await Company.findById(joinCompanyId).populate("owner", "subscription isPremium manualPremium");
    if (!joinCompany || getPlan(joinCompany.owner) !== "business") {
      return fail("Cet établissement n'est plus disponible pour être rejoint.");
    }
  }

  const checkName = await User.findOne({ fullName: fullname }).lean();
  if (checkName)
    return fail(res.locals.t?.auth?.error_name_taken || "Ce nom est déjà utilisé.");

  const checkEmail = await User.findOne({ email }).lean();
  if (checkEmail)
    return fail(res.locals.t?.auth?.error_email_taken || "Cette adresse email est déjà utilisée.");

  // Filet de sécurité tant que l'inscription client (compte séparé) existe
  // encore — sans ça, le même email peut avoir un compte User ET un compte
  // Client, ce qui crée des comptes fantômes (cf. plan d'unification).
  const checkClientEmail = await Client.findOne({ email }).lean();
  if (checkClientEmail)
    return fail(res.locals.t?.auth?.error_email_taken || "Cette adresse email est déjà utilisée.");

  if (password.trim() !== conformPassword.trim())
    return fail(res.locals.t?.auth?.error_pwd_match || "Les mots de passe ne correspondent pas.");

  if (password.trim().length < 8)
    return fail(res.locals.t?.auth?.error_pwd_length || "Le mot de passe doit contenir au moins 8 caractères.");

  if (!/[0-9]/.test(password))
    return fail(res.locals.t?.auth?.error_pwd_number || "Le mot de passe doit contenir au moins un chiffre.");

  if (!/[^a-zA-Z0-9]/.test(password))
    return fail(res.locals.t?.auth?.error_pwd_symbol || "Le mot de passe doit contenir au moins un caractère spécial (ex: !, @, #…).");

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const companyId = wantsCompany ? new mongoose.Types.ObjectId() : undefined;

    // Résoudre le parrain : depuis le formulaire OU depuis la session (lien URL)
    let referrerId = null;
    const refCode = (req.body.refCode || "").trim().toUpperCase() || req.session.pendingRef;
    if (refCode) {
      const referrer = await User.findOne({ referralCode: refCode }).lean();
      if (referrer && String(referrer._id) !== String(req.user?._id)) {
        referrerId = referrer._id;
      }
    }

    const referralCode = await generateReferralCode(fullname);

    const user = await User.create({
      fullName: fullname,
      email,
      password: hashedPassword,
      company: companyId,
      accountIntent,
      businessType: wantsCompany ? businessType : "",
      referralCode,
      referredBy: referrerId,
    });

    // Incrémenter les stats du parrain
    if (referrerId) {
      await User.findByIdAndUpdate(referrerId, { $inc: { "referral.totalInvited": 1 } });
      delete req.session.pendingRef;
    }

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

      // ── Email de bienvenue (pro uniquement) ─────────────────────────────
      try {
        const welcomeHtml = pug.renderFile(
          path.join(__dirname, "../views/templates/emails/welcome-pro.pug"),
          { fullName: user.fullName }
        );
        sendEmail(user.email, "🎉 Bienvenue sur BranShee — Configurez votre agenda", welcomeHtml)
          .catch(() => {}); // Silencieux si échec mail
      } catch (_) {}
    }

    if (wantsToJoin && joinCompany) {
      try {
        await CompanyMembership.create({ company: joinCompany._id, user: user._id, status: "pending" });
      } catch (_) {
        // Index unique (company,user) — déjà demandé, on ignore silencieusement
      }
    }

    req.login(user, (err) => {
      if (err) return fail("Erreur lors de la connexion.");

      if (!wantsCompany) {
        // Pas d'établissement créé maintenant (client/undecided, ou pro qui
        // attend l'approbation pour rejoindre) → direction neutre. La carte
        // "Votre établissement" dans /settings affiche l'état (pending, etc).
        if (isAjax) return res.json({ success: true, redirect: wantsToJoin ? "/settings" : "/" });
        return res.redirect(wantsToJoin ? "/settings" : "/");
      }

      // Si l'utilisateur vient d'un lien d'invitation ou bouton "Essai / Plan"
      const pendingPlan  = req.session.pendingPlan;
      const pendingPromo = req.session.pendingPromo;
      if (pendingPlan || pendingPromo) {
        const plan    = pendingPlan  || "pro";
        const billing = req.session.pendingBilling || "monthly";
        delete req.session.pendingPlan;
        delete req.session.pendingBilling;
        delete req.session.pendingPromo;
        let dest = `/subscription?plan=${plan}&billing=${billing}&autoCheckout=1`;
        if (pendingPromo) dest += `&promo=${encodeURIComponent(pendingPromo)}`;
        if (isAjax) return res.json({ success: true, redirect: dest });
        return res.redirect(dest);
      }
      // Pas de plan en attente → onboarding de bienvenue
      if (isAjax) return res.json({ success: true, redirect: "/welcome?gads_conversion=1" });
      return res.redirect("/welcome?gads_conversion=1");
    });
  } catch (err) {
    console.error(err);
    if (err.code === 11000) return fail(res.locals.t?.auth?.error_email_taken || "Email déjà utilisé.");
    return fail("Une erreur est survenue. Veuillez réessayer.");
  }
};

exports.logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.redirect("/login");
    });
  });
};

exports.getCompanyIfExist = async (identifier) => {
  // 1. Essayer par slug d'abord
  const bySlug = await Company.findOne({ slug: identifier });
  if (bySlug) return bySlug;
  // 2. Fallback sur ObjectId
  if (!mongoose.Types.ObjectId.isValid(identifier)) return null;
  return await Company.findById(identifier);
};

exports.forgotPasswordVerifyCode = async (req, res) => {
  try {
    const { value } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000);
    console.log(code);

    req.session.forgotPwdCode = code;
    const resetHtml = pug.renderFile(
      path.join(__dirname, "../views/templates/emails/reset-password.pug"),
      { code }
    );
    const isSent = await sendEmail(
      value,
      `Code de réinitialisation de votre mot de passe — BranShee`,
      resetHtml,
    );
    console.log(isSent);
    if (isSent) {
      return res.json({ success: true });
    } else {
      return res.json({ success: false });
    }
  } catch (err) {
    console.error(err);
    return res.json({ err });
  }
};

exports.checkCodePwd = (req, res) => {
  const codeA = req.session.forgotPwdCode;
  const { code } = req.body;

  if (Number(codeA) === Number(code)) {
    return res.json({ success: true });
  }

  return res.json({ success: false, error: "code doesn' match" });
};

exports.newPwd = async (req, res) => {
  const { email, password } = req.body;
  console.log(password);
  console.log(email);

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = await User.findOneAndUpdate(
    { email },
    { password: hashedPassword },
    { new: true }, // renvoie le user mis a jour
  );

  console.log(user);

  if (!user || user == null || user == "null") {
    return res.json({ error: 404, success: false, message: "User not found" });
  }

  res.json({ success: true });
};
