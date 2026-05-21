const User = require("../db/models/user.model");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const Company = require("../db/models/company/company.model");
const { sendEmail } = require("../utils/mailer");
const getServices = require("../utils/services");
const pug = require("pug");
const path = require("path");

exports.createUser = async (req, res) => {
  const isAjax = req.headers["x-requested-with"] === "fetch";

  function fail(msg) {
    if (isAjax) return res.status(400).json({ error: msg });
    return res.render("auth/register", {
      becomeCoach: true, alwaysSticky: true,
      services: getServices(res.locals.lang), error: msg,
    });
  }

  const { fullname, email, password, conformPassword, businessType } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email))
    return fail(res.locals.t?.auth?.error_invalid_email || "Veuillez entrer une adresse email valide.");

  // Validate businessType against the allowed list
  const allowedServices = getServices(res.locals.lang || "fr");
  if (!businessType || !allowedServices.includes(businessType))
    return fail("Veuillez choisir votre métier dans la liste proposée.");

  const checkName = await User.findOne({ fullName: fullname }).lean();
  if (checkName)
    return fail(res.locals.t?.auth?.error_name_taken || "Ce nom est déjà utilisé.");

  const checkEmail = await User.findOne({ email }).lean();
  if (checkEmail)
    return fail(res.locals.t?.auth?.error_email_taken || "Cette adresse email est déjà utilisée.");

  if (password.trim() !== conformPassword.trim())
    return fail(res.locals.t?.auth?.error_pwd_match || "Les mots de passe ne correspondent pas.");

  if (password.trim().length < 8)
    return fail(res.locals.t?.auth?.error_pwd_length || "Le mot de passe doit contenir au moins 8 caractères.");

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const companyId = new mongoose.Types.ObjectId();

    const user = await User.create({
      fullName: fullname,
      email,
      password: hashedPassword,
      company: companyId,
      businessType: businessType || "",
    });
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

    req.login(user, (err) => {
      if (err) return fail("Erreur lors de la connexion.");
      if (isAjax) return res.json({ success: true, redirect: "/appointment" });
      return res.redirect("/appointment");
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
