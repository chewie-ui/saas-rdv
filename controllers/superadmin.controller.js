const User = require("../db/models/user.model");

exports.loginPage = (req, res) => {
  if (req.session.isSuperAdmin) return res.redirect("/superadmin");
  res.render("superadmin/login", { error: null });
};

exports.login = (req, res) => {
  const { secret } = req.body;
  if (secret && secret === process.env.SUPERADMIN_SECRET) {
    req.session.isSuperAdmin = true;
    return res.redirect("/superadmin");
  }
  res.render("superadmin/login", { error: "Mot de passe incorrect." });
};

exports.logout = (req, res) => {
  req.session.isSuperAdmin = false;
  res.redirect("/superadmin/login");
};

exports.usersPage = async (req, res) => {
  const { search } = req.query;
  let query = {};
  if (search) {
    const regex = { $regex: search, $options: "i" };
    query = { $or: [{ fullName: regex }, { email: regex }] };
  }
  const users = await User.find(query)
    .select("fullName email isPremium manualPremium createdAt")
    .sort("-createdAt")
    .lean();
  res.render("superadmin/users", { users, search: search || "" });
};

exports.toggleManualPremium = async (req, res) => {
  try {
    const { userId } = req.params;
    const { manualPremium } = req.body;
    const val = !!manualPremium;
    await User.findByIdAndUpdate(userId, {
      manualPremium: val,
      isPremium: val,
    });
    res.json({ success: true, manualPremium: val });
  } catch (err) {
    console.error("toggleManualPremium error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};
