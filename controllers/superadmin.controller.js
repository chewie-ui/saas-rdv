const User = require("../db/models/user.model");
const PromoCode = require("../db/models/promoCode.model");

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

// ── Promo codes ───────────────────────────────────────────────────────────────

exports.promoCodesPage = async (req, res) => {
  const codes = await PromoCode.find({}).sort("-createdAt").lean();
  res.render("superadmin/promo-codes", { codes });
};

exports.createPromoCode = async (req, res) => {
  try {
    const { code, discountType, discountValue, maxUses, expiresAt, applicablePlan } = req.body;
    if (!code || !discountType || !discountValue) {
      return res.status(400).json({ error: "Champs requis manquants." });
    }
    const promo = await PromoCode.create({
      code: code.trim().toUpperCase(),
      discountType,
      discountValue: Number(discountValue),
      maxUses: maxUses !== undefined && maxUses !== "" ? Number(maxUses) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      applicablePlan: applicablePlan || "all",
    });
    res.json({ success: true, promo });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "Ce code existe déjà." });
    console.error(err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.togglePromoCode = async (req, res) => {
  try {
    const { id } = req.params;
    const code = await PromoCode.findById(id);
    if (!code) return res.status(404).json({ error: "Code introuvable." });
    code.active = !code.active;
    await code.save();
    res.json({ success: true, active: code.active });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.deletePromoCode = async (req, res) => {
  try {
    await PromoCode.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Validation promo code (public API pour le checkout) ───────────────────────
exports.validatePromoCode = async (req, res) => {
  try {
    const { code, plan, billing } = req.body;
    if (!code) return res.status(400).json({ error: "Code requis." });

    const promo = await PromoCode.findOne({
      code: code.trim().toUpperCase(),
      active: true,
    });

    if (!promo) return res.json({ valid: false, error: "Code invalide ou inactif." });

    if (promo.expiresAt && new Date() > promo.expiresAt) {
      return res.json({ valid: false, error: "Ce code a expiré." });
    }

    if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) {
      return res.json({ valid: false, error: "Ce code a atteint sa limite d'utilisation." });
    }

    // Vérifier si le code s'applique au plan sélectionné
    if (promo.applicablePlan && promo.applicablePlan !== "all" && plan && billing) {
      const selectedKey = `${plan}_${billing}`; // ex: "premium_monthly"
      if (promo.applicablePlan !== selectedKey) {
        const planLabels = {
          premium_monthly: "Premium Mensuel",
          premium_yearly: "Premium Annuel",
          business_monthly: "Business Mensuel",
          business_yearly: "Business Annuel",
        };
        return res.json({
          valid: false,
          error: `Ce code est réservé au plan ${planLabels[promo.applicablePlan] || promo.applicablePlan}.`,
        });
      }
    }

    res.json({
      valid: true,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      code: promo.code,
      applicablePlan: promo.applicablePlan || "all",
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};
