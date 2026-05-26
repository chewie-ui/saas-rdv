const crypto     = require("crypto");
const User       = require("../db/models/user.model");
const PromoCode  = require("../db/models/promoCode.model");
const AccessLink = require("../db/models/accessLink.model");

exports.loginPage = (req, res) => {
  if (req.session.isSuperAdmin) return res.redirect("/superadmin");
  res.render("superadmin/login", { error: null });
};

exports.login = (req, res) => {
  const isAjax = req.headers["x-requested-with"] === "fetch";
  const { secret } = req.body;
  if (secret && secret === process.env.SUPERADMIN_SECRET) {
    req.session.isSuperAdmin = true;
    if (isAjax) return res.json({ success: true, redirect: "/superadmin" });
    return res.redirect("/superadmin");
  }
  if (isAjax) return res.status(400).json({ error: "Mot de passe incorrect." });
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
    .select("fullName email isPremium manualPremium manualPremiumExpiry subscription createdAt")
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
      manualPremiumExpiry: null,   // reset l'expiry au toggle
    });
    res.json({ success: true, manualPremium: val });
  } catch (err) {
    console.error("toggleManualPremium error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.setPlan = async (req, res) => {
  try {
    const { userId } = req.params;
    const { plan } = req.body; // "free" | "pro" | "business"

    const validPlans = ["free", "pro", "business"];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({ error: "Plan invalide." });
    }

    const isFree = plan === "free";
    const update = {
      manualPremium: !isFree,
      isPremium: !isFree,
      manualPremiumExpiry: null,        // reset l'expiry à chaque changement de plan
      "subscription.plan": isFree ? "basic" : plan,
      "subscription.status": isFree ? "inactive" : "active",
    };

    await User.findByIdAndUpdate(userId, update);
    res.json({ success: true, plan });
  } catch (err) {
    console.error("setPlan error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.setTrialDuration = async (req, res) => {
  try {
    const { userId }   = req.params;
    const { duration } = req.body; // "1d" | "7d" | "30d" | "90d" | "infinite"

    const daysMap = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };
    let expiry = null;

    if (duration !== "infinite") {
      const days = daysMap[duration];
      if (!days) return res.status(400).json({ error: "Durée invalide." });
      expiry = new Date();
      expiry.setDate(expiry.getDate() + days);
    }

    await User.findByIdAndUpdate(userId, { manualPremiumExpiry: expiry });
    res.json({ success: true, expiry });
  } catch (err) {
    console.error("setTrialDuration error:", err);
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

// ── Access Links ──────────────────────────────────────────────────────────────

exports.accessLinksPage = async (req, res) => {
  const links = await AccessLink.find({}).sort("-createdAt").lean();
  res.render("superadmin/access-links", { links });
};

exports.createAccessLink = async (req, res) => {
  try {
    const { label, plan, durationDays, maxUses, expiresAt } = req.body;
    if (!plan || !["pro", "business"].includes(plan)) {
      return res.status(400).json({ error: "Plan invalide (pro ou business)." });
    }
    const code = crypto.randomBytes(5).toString("hex").toUpperCase(); // 10-char hex code
    const link = await AccessLink.create({
      code,
      label:       label ? label.trim() : "",
      plan,
      durationDays: durationDays ? Number(durationDays) : 30,
      maxUses:      maxUses !== undefined && maxUses !== "" ? Number(maxUses) : 1,
      expiresAt:    expiresAt ? new Date(expiresAt) : null,
    });
    res.json({ success: true, link });
  } catch (err) {
    console.error("createAccessLink error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.toggleAccessLink = async (req, res) => {
  try {
    const link = await AccessLink.findById(req.params.id);
    if (!link) return res.status(404).json({ error: "Lien introuvable." });
    link.isActive = !link.isActive;
    await link.save();
    res.json({ success: true, isActive: link.isActive });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.deleteAccessLink = async (req, res) => {
  try {
    await AccessLink.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Public redemption (GET /access/:code) ────────────────────────────────────
exports.redeemAccessLink = async (req, res) => {
  const code = (req.params.code || "").toUpperCase();
  try {
    const link = await AccessLink.findOne({ code, isActive: true });

    if (!link) {
      return res.status(404).render("superadmin/access-error", {
        message: "Ce lien d'accès est invalide ou a été désactivé.",
      });
    }
    if (link.expiresAt && new Date() > link.expiresAt) {
      return res.status(410).render("superadmin/access-error", {
        message: "Ce lien d'accès a expiré.",
      });
    }
    if (link.maxUses !== null && link.usedCount >= link.maxUses) {
      return res.status(410).render("superadmin/access-error", {
        message: "Ce lien d'accès a déjà été utilisé le nombre maximum de fois.",
      });
    }

    // Not logged in → save code in session and redirect to login
    if (!req.isAuthenticated()) {
      req.session.pendingAccessCode = code;
      return res.redirect("/login");
    }

    // Already used by this user?
    const alreadyUsed = link.uses.some(
      (u) => u.userId && String(u.userId) === String(req.user._id)
    );
    if (alreadyUsed) {
      return res.redirect("/appointment?accessAlreadyUsed=1");
    }

    // Apply plan
    const expiry = new Date(Date.now() + link.durationDays * 24 * 60 * 60 * 1000);
    await User.findByIdAndUpdate(req.user._id, {
      manualPremium:       true,
      isPremium:           true,
      manualPremiumExpiry: expiry,
      "subscription.plan":   link.plan,
      "subscription.status": "active",
    });

    // Record use
    link.usedCount += 1;
    link.uses.push({
      userId: req.user._id,
      email:  req.user.email || "",
      ip:     req.ip || "",
      usedAt: new Date(),
    });
    await link.save();

    return res.redirect("/appointment?accessGranted=1");
  } catch (err) {
    console.error("redeemAccessLink error:", err);
    res.status(500).send("Erreur serveur.");
  }
};
