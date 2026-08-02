const User = require("../db/models/user.model");
const Client = require("../db/models/client.model");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const { sendEmail } = require("../utils/mailer");
const { getCompanyPlan } = require("../utils/planLimits");
const getServices = require("../utils/services");
const { isSafePlainText } = require("../utils/validateName");
const { readFirstTouch } = require("../utils/attribution");
const pug = require("pug");
const path = require("path");

// Génère un code parrainage unique de la forme PRENOM-XXXXXX.
// Déplacé dans utils/referralCode.js pour être partagé avec l'inscription
// depuis l'app mobile (même format de code des deux côtés).
const { generateReferralCode } = require("../utils/referralCode");

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

  if (!fullname || !isSafePlainText(fullname))
    return fail(res.locals.t?.auth?.error_invalid_name || "Le nom ne peut pas contenir les caractères < ou >.");

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email))
    return fail(res.locals.t?.auth?.error_invalid_email || "Veuillez entrer une adresse email valide.");

  // Un métier hors liste conseillée est accepté (signalé en orange côté profil,
  // cf. customize.pug) — seul un champ vide bloque, pour un pro qui crée.
  if (wantsCompany && !businessType)
    return fail("Veuillez indiquer votre métier.");

  // Valider l'établissement à rejoindre — doit exister et son propriétaire
  // doit être en plan Business (seul plan pensé pour plusieurs comptes).
  let joinCompany = null;
  if (wantsToJoin) {
    if (!mongoose.Types.ObjectId.isValid(joinCompanyId)) {
      return fail("Veuillez choisir un établissement dans la liste.");
    }
    // « Rejoignable » = l'ÉTABLISSEMENT est Business (company.plan), pas le
    // compte de son patron — le forfait appartient à l'établissement.
    joinCompany = await Company.findOne({ _id: joinCompanyId, isDeleted: { $ne: true } })
      .populate("owner", "subscription isPremium manualPremium");
    if (!joinCompany || getCompanyPlan(joinCompany, joinCompany.owner) !== "business") {
      return fail("Cet établissement n'est plus disponible pour être rejoint.");
    }
  }

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

    // Attribution « premier contact » : figée à la création, jamais recalculée.
    // Sans ça, un inscrit venu d'une pub est indiscernable d'un inscrit venu
    // du bouche-à-oreille, et le budget Ads se pilote à l'aveugle.
    const acquisition = readFirstTouch(req) || undefined;

    const user = await User.create({
      fullName: fullname,
      email,
      password: hashedPassword,
      company: companyId,
      accountIntent,
      businessType: wantsCompany ? businessType : "",
      referralCode,
      referredBy: referrerId,
      acquisition,
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

      // Conversion Google Ads ("Inscription") : à chaque compte créé avec
      // succès, quel que soit le chemin de redirection ensuite (rejoindre un
      // établissement, client/undecided, plan payant en attente, ou
      // onboarding gratuit). Avant, seul le dernier cas ci-dessous trackait —
      // les 3 autres redirections partaient sans jamais déclencher le tag,
      // ce qui sous-comptait fortement les conversions réelles.
      if (!wantsCompany) {
        // Pas d'établissement créé maintenant (client/undecided, ou pro qui
        // attend l'approbation pour rejoindre) → direction neutre. La carte
        // "Votre établissement" dans /settings affiche l'état (pending, etc).
        const dest = wantsToJoin ? "/settings?gads_conversion=1" : "/?gads_conversion=1";
        if (isAjax) return res.json({ success: true, redirect: dest });
        return res.redirect(dest);
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
        let dest = `/subscription?plan=${plan}&billing=${billing}&autoCheckout=1&gads_conversion=1`;
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
  // Un établissement supprimé (soft delete) ne doit plus être servi sur son
  // URL publique — l'appelant rend alors un 404.
  // 1. Essayer par slug d'abord
  const bySlug = await Company.findOne({ slug: identifier, isDeleted: { $ne: true } });
  if (bySlug) return bySlug;
  // 2. Fallback sur ObjectId
  if (!mongoose.Types.ObjectId.isValid(identifier)) return null;
  return await Company.findOne({ _id: identifier, isDeleted: { $ne: true } });
};

exports.forgotPasswordVerifyCode = async (req, res) => {
  try {
    const email = (req.body.value || "").toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ success: false });
    }

    // Anti-énumération : on répond TOUJOURS "success" pour ne pas révéler si
    // l'email est inscrit (avant, le front affichait "Aucun compte trouvé",
    // ce qui permettait de sonder quels emails existent). On ne génère et
    // n'envoie un code que si le compte existe réellement.
    // Les anciens comptes Client séparés n'ont pas encore été fusionnés
    // (cf. scripts/migrate-merge-client-into-user.js) : sans ce repli, un
    // Client sans User homonyme recevait la réponse anti-énumération mais
    // AUCUN code — donc aucun moyen de récupérer son compte.
    const compte =
      (await User.findOne({ email }).select("_id").lean()) ||
      (await Client.findOne({ email }).select("_id").lean());
    if (compte) {
      // Code cryptographiquement sûr (avant : Math.random, prévisible), lié à
      // l'email, avec expiration et limite de tentatives — voir checkCodePwd.
      const code = crypto.randomInt(100000, 1000000);
      req.session.forgotPwd = {
        code: String(code),
        email,
        expiresAt: Date.now() + 15 * 60 * 1000,
        attempts: 0,
        verified: false,
      };
      const resetHtml = pug.renderFile(
        path.join(__dirname, "../views/templates/emails/reset-password.pug"),
        { code },
      );
      await sendEmail(
        email,
        `Code de réinitialisation de votre mot de passe — BranShee`,
        resetHtml,
      ).catch((e) => console.error("reset email error:", e.message));
    } else {
      // Purge un éventuel état résiduel lié à un autre email.
      delete req.session.forgotPwd;
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("forgotPasswordVerifyCode error:", err.message);
    return res.status(500).json({ success: false });
  }
};

exports.checkCodePwd = (req, res) => {
  const fp = req.session.forgotPwd;
  const { code } = req.body;

  if (!fp || !fp.code || !fp.expiresAt || Date.now() > fp.expiresAt) {
    return res.json({ success: false, error: "expired" });
  }
  // Limite de tentatives — empêche le brute-force d'un code à 6 chiffres.
  fp.attempts = (fp.attempts || 0) + 1;
  if (fp.attempts > 6) {
    delete req.session.forgotPwd;
    return res.json({ success: false, error: "too_many" });
  }
  if (Number(code) === Number(fp.code)) {
    fp.verified = true;
    return res.json({ success: true });
  }
  return res.json({ success: false, error: "invalid" });
};

exports.newPwd = async (req, res) => {
  try {
    const email = (req.body.email || "").toLowerCase().trim();
    const { password } = req.body;
    const fp = req.session.forgotPwd;

    // ── FAILLE CRITIQUE CORRIGÉE ──────────────────────────────────────────
    // Avant, ce handler changeait le mot de passe pour un email SANS jamais
    // vérifier le code de réinitialisation (checkCodePwd était totalement
    // découplé) → prise de contrôle de n'importe quel compte via un simple
    // appel API. On exige désormais qu'un code ait bien été VÉRIFIÉ en session
    // pour CE MÊME email, non expiré, et à usage unique (purgé ensuite).
    if (!fp || fp.verified !== true || Date.now() > fp.expiresAt || fp.email !== email) {
      return res.status(403).json({
        success: false,
        message: "Session de réinitialisation invalide ou expirée. Recommencez.",
      });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Le mot de passe doit contenir au moins 8 caractères.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    // `$inc: tokenEpoch` révoque les jetons de l'app mobile déjà émis pour ce
    // compte : une réinitialisation doit couper l'accès des appareils encore
    // connectés (leur refresh vit sinon 60 jours).
    let compte = await User.findOneAndUpdate(
      { email },
      { $set: { password: hashedPassword }, $inc: { tokenEpoch: 1 } },
    );

    // Repli sur l'ancien compte Client séparé, pour rester cohérent avec
    // forgotPasswordVerifyCode qui accepte aussi ces comptes. On priorise le
    // User quand les deux existent : c'est lui que passport tente en premier
    // dans POST /login, le repli Client n'y est atteint qu'après son échec.
    // Pas de `$inc: tokenEpoch` ici — ce champ n'existe pas sur le schéma
    // Client, et Mongoose ignorerait la mise à jour EN SILENCE.
    if (!compte) {
      compte = await Client.findOneAndUpdate(
        { email },
        { $set: { password: hashedPassword } },
      );
    }

    // Usage unique : on purge la session quel que soit le résultat.
    delete req.session.forgotPwd;

    if (!compte) {
      return res.json({ success: false, message: "Utilisateur introuvable." });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("newPwd error:", err.message);
    return res.status(500).json({ success: false, message: "Erreur serveur." });
  }
};
