const User = require("../db/models/user.model");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const Company = require("../db/models/company/company.model");
const { sendEmail } = require("../utils/mailer");

exports.createUser = async (req, res) => {
  const { fullname, email, password, conformPassword } = req.body;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.render("auth/register", {
      error: "Please enter a valid email address.",
    });
  }

  const checkName = await User.findOne({ fullName: fullname }).lean();
  if (checkName) {
    return res.render("auth/register", {
      error: "This name is already in use.",
    });
  }
  // 2. Vérifier si l'email est déjà pris en base de données
  const checkEmail = await User.findOne({ email }).lean();
  if (checkEmail) {
    return res.render("auth/register", {
      error: "This email is already in use.",
    });
  }

  if (password.trim() !== conformPassword.trim()) {
    return res.render("auth/register", {
      error: "Passwords do not match",
    });
  }

  if (password.trim().length < 8) {
    return res.render("auth/register", {
      error: "Password must be at least 8 characters long.",
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
      `Your verification code: ${code}`,
      `<html>
    <body style="font-family: Arial, sans-serif;">
      <h2>Bonjour,</h2>
      <p>Voici votre code de vérification pour changer votre mot de passe :</p>
      <div style="font-size: 24px; font-weight: bold; color: #ff4757; padding: 10px; border: 1px solid #ddd; display: inline-block;">
        ${code}
      </div>
      <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
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
