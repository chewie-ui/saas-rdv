const User = require("../db/models/user.model");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const Company = require("../db/models/company/company.model");
const { sendEmail } = require("../utils/mailer");
const SERVICES = require("../utils/services");

exports.createUser = async (req, res) => {
  const { fullname, email, password, conformPassword, businessType } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.render("auth/register", {
      becomeCoach: true,
      alwaysSticky: true,
      services: SERVICES,
      error: res.locals.t?.auth?.error_invalid_email || "Veuillez entrer une adresse email valide.",
    });
  }

  const checkName = await User.findOne({ fullName: fullname }).lean();
  if (checkName) {
    return res.render("auth/register", {
      becomeCoach: true,
      alwaysSticky: true,
      services: SERVICES,
      error: res.locals.t?.auth?.error_name_taken || "Ce nom est déjà utilisé.",
    });
  }
  const checkEmail = await User.findOne({ email }).lean();
  if (checkEmail) {
    return res.render("auth/register", {
      becomeCoach: true,
      alwaysSticky: true,
      services: SERVICES,
      error: res.locals.t?.auth?.error_email_taken || "Cette adresse email est déjà utilisée.",
    });
  }

  if (password.trim() !== conformPassword.trim()) {
    return res.render("auth/register", {
      becomeCoach: true,
      alwaysSticky: true,
      services: SERVICES,
      error: res.locals.t?.auth?.error_pwd_match || "Les mots de passe ne correspondent pas.",
    });
  }

  if (password.trim().length < 8) {
    return res.render("auth/register", {
      becomeCoach: true,
      alwaysSticky: true,
      services: SERVICES,
      error: res.locals.t?.auth?.error_pwd_length || "Le mot de passe doit contenir au moins 8 caractères.",
    });
  }

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
        { weekdayIndex: 6, dayOff: true }, // Samedi off
        { weekdayIndex: 0, dayOff: true }, // Dimanche off
      ],
    });

    req.login(user, (err) => {
      console.error(err);
      return res.redirect("/appointment");
    });
  } catch (err) {
    console.log(err);

    if (err.code === 11000) {
      return res.render("auth/register", {
        error: "Email already in use",
      });
    }
    return res.render("auth/register", {
      becomeCoach: true,
      alwaysSticky: true,
      services: SERVICES,
      error: err,
    });
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

exports.getCompanyIfExist = async (companyId) => {
  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    return null;
  }
  return await Company.findById(companyId);
};

exports.forgotPasswordVerifyCode = async (req, res) => {
  try {
    const { value } = req.body;
    const code = Math.floor(100000 + Math.random() * 900000);
    console.log(code);

    req.session.forgotPwdCode = code;
    const isSent = await sendEmail(
      value,
      `Code de réinitialisation de votre mot de passe`,
      `<html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #1e272e;">Bonjour,</h2>
      <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
      <p>Voici votre code de vérification à 6 chiffres :</p>
      <div style="font-size: 32px; font-weight: bold; color: #ff4757; padding: 15px 25px; border: 2px solid #ff4757; display: inline-block; border-radius: 8px; letter-spacing: 6px; margin: 10px 0;">
        ${code}
      </div>
      <p>Merci de saisir ce code sur le site pour poursuivre la procédure.</p>
      <p>Ce code est valable pendant une durée limitée. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email en toute sécurité.</p>
      <p>Pour des raisons de sécurité, ne partagez jamais ce code avec qui que ce soit.</p>
      <p>Si vous avez besoin d'aide, n'hésitez pas à nous contacter.</p>
      <p>Cordialement,<br><strong>L'équipe SayMiro</strong></p>
    </body>
  </html>`,
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
