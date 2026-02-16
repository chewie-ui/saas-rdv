const User = require("../db/models/user.model");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const Company = require("../db/models/company.model");

exports.createUser = async (req, res) => {
  const { fullname, email, password, conformPassword } = req.body;

  if (password.trim() !== conformPassword.trim()) {
    return res.render("auth/register", {
      error: "Passwords do not match",
    });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    await User.create({
      fullName: fullname,
      email,
      password: hashedPassword,
    });

    res.redirect("/panel");
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
