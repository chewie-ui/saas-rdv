const crypto     = require("crypto");
const User       = require("../db/models/user.model");
const Company    = require("../db/models/company/company.model");
const PromoCode  = require("../db/models/promoCode.model");
const AccessLink = require("../db/models/accessLink.model");
const FeatureFlag = require("../db/models/featureFlag.model");
const { FEATURES, invalidateFeatureFlagCache } = require("../middlewares/featureFlag");

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
    .select("fullName email isPremium manualPremium manualPremiumExpiry subscription createdAt isDisabled")
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
    // Appliquer les limites du nouveau plan (désactive/supprime le contenu excédentaire)
    const effectivePlan = isFree ? "basic" : plan;
    const { enforcePlanLimits } = require("./account.controller");
    enforcePlanLimits(userId, effectivePlan).catch(() => {});
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
    const { code, discountType, discountValue, trialDays, maxUses, expiresAt, applicablePlan } = req.body;
    if (!code || !discountType) {
      return res.status(400).json({ error: "Champs requis manquants." });
    }
    if (discountType !== "trial" && !discountValue) {
      return res.status(400).json({ error: "La valeur est requise pour ce type de réduction." });
    }
    const validTypes = ["percent", "fixed", "trial"];
    if (!validTypes.includes(discountType)) {
      return res.status(400).json({ error: "Type invalide." });
    }
    const promo = await PromoCode.create({
      code: code.trim().toUpperCase(),
      discountType,
      discountValue: discountType === "trial" ? 0 : Number(discountValue),
      trialDays:     discountType === "trial" ? (Number(trialDays) || 30) : 0,
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

exports.togglePromoOffer = async (req, res) => {
  try {
    const { id } = req.params;
    const code = await PromoCode.findById(id);
    if (!code) return res.status(404).json({ error: "Code introuvable." });

    const willBeOffer = !code.isDefaultOffer;

    // Si on active cette offre, désactiver toutes les autres offres par défaut
    // (un seul code actif à la fois en offre par défaut).
    if (willBeOffer) {
      await PromoCode.updateMany(
        { _id: { $ne: id }, isDefaultOffer: true },
        { $set: { isDefaultOffer: false } }
      );
    }

    code.isDefaultOffer = willBeOffer;
    await code.save();
    res.json({ success: true, isDefaultOffer: code.isDefaultOffer, applicablePlan: code.applicablePlan });
  } catch (err) {
    console.error(err);
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

    // Vérifier utilisation unique par utilisateur connecté
    if (req.user && req.user._id) {
      const alreadyUsed = promo.usedByUsers.some(
        (uid) => String(uid) === String(req.user._id)
      );
      if (alreadyUsed) {
        return res.json({ valid: false, error: "Vous avez déjà utilisé ce code promo." });
      }
    }

    // Vérifier si le code s'applique au plan sélectionné
    if (promo.applicablePlan && promo.applicablePlan !== "all" && plan && billing) {
      const selectedKey = `${plan}_${billing}`;
      if (promo.applicablePlan !== selectedKey) {
        const planLabels = {
          premium_monthly:  "Pro Mensuel",
          premium_yearly:   "Pro Annuel",
          business_monthly: "Business Mensuel",
          business_yearly:  "Business Annuel",
        };
        return res.json({
          valid: false,
          error: `Ce code est réservé au plan ${planLabels[promo.applicablePlan] || promo.applicablePlan}.`,
        });
      }
    }

    res.json({
      valid:          true,
      discountType:   promo.discountType,
      discountValue:  promo.discountValue,
      trialDays:      promo.trialDays || 30,
      code:           promo.code,
      applicablePlan: promo.applicablePlan || "all",
    });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Parrainage ────────────────────────────────────────────────────────────────

exports.referralsPage = async (req, res) => {
  const users = await User.find({ "referral.totalInvited": { $gt: 0 } })
    .select("fullName email referralCode referral subscription isPremium createdAt")
    .sort({ "referral.totalPaying": -1 })
    .lean();

  // Enrichir avec les filleuls
  const referrersWithFilleuls = await Promise.all(users.map(async (u) => {
    const filleuls = await User.find({ referredBy: u._id })
      .select("fullName email isPremium subscription createdAt")
      .lean();
    return { ...u, filleuls };
  }));

  res.render("superadmin/referrals", { users: referrersWithFilleuls });
};

// ── Boost (mise en avant homepage) ───────────────────────────────────────────

exports.boostPage = async (req, res) => {
  const companies = await Company.find({})
    .select("_id slug boostPosition owner")
    .populate("owner", "fullName businessName businessType location profilePicture businessPicture")
    .sort({ boostPosition: -1, "owner.businessName": 1 })
    .lean();
  res.render("superadmin/boost", { companies });
};

exports.setBoost = async (req, res) => {
  try {
    const { companyId } = req.params;
    const position = Math.max(0, parseInt(req.body.position) || 0);
    await Company.findByIdAndUpdate(companyId, { boostPosition: position });
    res.json({ success: true, position });
  } catch (err) {
    console.error("setBoost error:", err);
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

// ── Toggle account status (actif / désactivé) ─────────────────────────────────
exports.toggleAccountStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select("isDisabled fullName");
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
    user.isDisabled = !user.isDisabled;
    await user.save();
    res.json({ success: true, isDisabled: user.isDisabled });
  } catch (err) {
    console.error("toggleAccountStatus error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Pages / fonctionnalités (maintenance, erreur, désactivation) ─────────────
exports.featuresPage = async (req, res) => {
  const docs = await FeatureFlag.find({}).lean();
  const byKey = {};
  docs.forEach((d) => { byKey[d.key] = d; });

  const features = FEATURES.map((f) => ({
    key: f.key,
    label: f.label,
    status: byKey[f.key]?.status || "active",
    message: byKey[f.key]?.message || "",
  }));

  res.render("superadmin/features", { features });
};

exports.setFeatureStatus = async (req, res) => {
  try {
    const { key } = req.params;
    const { status, message } = req.body;

    if (!FEATURES.some((f) => f.key === key)) {
      return res.status(404).json({ error: "Fonctionnalité inconnue." });
    }
    if (!["active", "maintenance", "error", "disabled"].includes(status)) {
      return res.status(400).json({ error: "Statut invalide." });
    }

    await FeatureFlag.findOneAndUpdate(
      { key },
      { key, status, message: (message || "").toString().trim() },
      { upsert: true }
    );

    invalidateFeatureFlagCache();
    res.json({ success: true });
  } catch (err) {
    console.error("setFeatureStatus error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};
