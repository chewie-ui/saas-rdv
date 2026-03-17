const User = require("../db/models/user.model");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const Company = require("../db/models/company/company.model");
const { sendEmail } = require("../utils/mailer");

exports.createUser = async (req, res) => {
  const { fullname, email, password, conformPassword } = req.body;

  if (password.trim() !== conformPassword.trim()) {
    return res.render("auth/register", {
      error: "Passwords do not match",
    });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
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
    req.session.forgotPwdCode = code;
    await sendEmail(value, "SUBJECT", String(code));
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ err });
  }
};
