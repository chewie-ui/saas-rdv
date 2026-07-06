const crypto     = require("crypto");
const User       = require("../db/models/user.model");
const Company    = require("../db/models/company/company.model");
const PromoCode  = require("../db/models/promoCode.model");
const AccessLink = require("../db/models/accessLink.model");
const FeatureFlag = require("../db/models/featureFlag.model");
const Booking   = require("../db/models/book.model");
const Service   = require("../db/models/company/service.model");
const Employee  = require("../db/models/company/employee.model");
const DaysOff   = require("../db/models/company/daysOff.model");
const Form      = require("../db/models/form.model");
const Review    = require("../db/models/review.model");
const Client    = require("../db/models/client.model");
const LoginEvent = require("../db/models/loginEvent.model");
const { FEATURES, ADMIN_FEATURES, invalidateFeatureFlagCache } = require("../middlewares/featureFlag");
const { extractNavLinks } = require("../utils/navLinks");

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

exports.establishmentsPage = async (req, res) => {
  const { search } = req.query;
  let query = {};
  if (search) {
    const regex = { $regex: search, $options: "i" };
    query = { $or: [{ name: regex }, { slug: regex }, { businessType: regex }] };
  }
  const [companies, totalBookings] = await Promise.all([
    Company.find(query)
      .populate("owner", "fullName email isPremium manualPremium subscription businessName businessPicture")
      .select("name slug businessType createdAt isPaused photo description")
      .sort("-createdAt")
      .lean(),
    Booking.countDocuments({}),
  ]);
  // Ajouter le nb de RDV par company
  const bookingCounts = await Booking.aggregate([
    { $group: { _id: "$company", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(bookingCounts.map((b) => [String(b._id), b.count]));
  companies.forEach((c) => { c.bookingCount = countMap.get(String(c._id)) || 0; });
  res.render("superadmin/establishments", { companies, search: search || "", totalBookings });
};

exports.usersPage = async (req, res) => {
  const { search } = req.query;
  let query = {};
  if (search) {
    const regex = { $regex: search, $options: "i" };
    query = { $or: [{ fullName: regex }, { email: regex }] };
  }
  const PageView = require("../db/models/pageView.model");
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [users, totalViews, uniqueVisitors, totalClients, clientsToday, adminsToday, topSources] = await Promise.all([
    User.find(query)
      .select("fullName email isPremium manualPremium manualPremiumExpiry subscription createdAt isDisabled")
      .sort("-createdAt")
      .lean(),
    PageView.countDocuments({}),
    PageView.distinct("visitorId"),
    Client.countDocuments({}),
    Client.countDocuments({ createdAt: { $gte: startOfDay } }),
    User.countDocuments({ createdAt: { $gte: startOfDay } }),
    PageView.aggregate([
      { $group: { _id: { $ifNull: ["$source", "direct"] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
  ]);
  res.render("superadmin/users", {
    users,
    search: search || "",
    topSources,
    totalViews,
    uniqueViews: uniqueVisitors.length,
    totalClients,
    clientsToday,
    adminsToday,
  });
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

    const validPlans = ["free", "essentiel", "pro", "business"];
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

// ── Gestion plan par établissement ──────────────────────────────────────────
// Le plan vit sur le User (owner). Changer le plan d'un établissement =
// changer le plan de son propriétaire (qui peut posséder plusieurs établissements,
// mais le plan s'applique à toute l'activité du compte).
exports.setPlanForCompany = async (req, res) => {
  try {
    const company = await Company.findById(req.params.companyId).select("owner").lean();
    if (!company) return res.status(404).json({ error: "Établissement introuvable." });

    const { plan } = req.body; // "free" | "pro" | "business"
    const validPlans = ["free", "essentiel", "pro", "business"];
    if (!validPlans.includes(plan)) return res.status(400).json({ error: "Plan invalide." });

    const isFree = plan === "free";
    const update = {
      manualPremium: !isFree,
      isPremium: !isFree,
      manualPremiumExpiry: null,
      "subscription.plan": isFree ? "basic" : plan,
      "subscription.status": isFree ? "inactive" : "active",
    };
    const userId = String(company.owner);
    await User.findByIdAndUpdate(userId, update);
    const { enforcePlanLimits } = require("./account.controller");
    enforcePlanLimits(userId, isFree ? "basic" : plan).catch(() => {});
    res.json({ success: true, plan });
  } catch (err) {
    console.error("setPlanForCompany error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Modifier les infos d'un établissement (nom, métier, photo) ───────────────
// multer + processSingleImage appliqués AVANT dans la route — ici on lit juste
// req.file.filename (déjà converti en JPEG sur disque) si présent.
exports.updateCompanyInfo = async (req, res) => {
  try {
    const company = await Company.findById(req.params.companyId).select("_id").lean();
    if (!company) return res.status(404).json({ error: "Établissement introuvable." });

    const update = {};
    if (req.body.name !== undefined) update.name = String(req.body.name).trim().slice(0, 120);
    if (req.body.businessType !== undefined) update.businessType = String(req.body.businessType).trim().slice(0, 80);
    if (req.file && req.file.filename) update.photo = `/uploads/profiles/${req.file.filename}`;

    await Company.findByIdAndUpdate(company._id, update);
    res.json({ success: true, update });
  } catch (err) {
    console.error("updateCompanyInfo error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.setTrialDuration = async (req, res) => {
  try {
    const { userId }   = req.params;
    const { duration, customDays } = req.body; // "1d" | "7d" | "30d" | "90d" | "custom" | "infinite"

    const daysMap = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };
    let expiry = null;

    if (duration === "custom") {
      const days = Number(customDays);
      if (!Number.isFinite(days) || days <= 0 || days > 3650) {
        return res.status(400).json({ error: "Nombre de jours invalide (1 à 3650)." });
      }
      expiry = new Date();
      expiry.setDate(expiry.getDate() + days);
    } else if (duration !== "infinite") {
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
      .select("fullName email isPremium subscription createdAt referralPaidCounted")
      .lean();
    return { ...u, filleuls };
  }));

  res.render("superadmin/referrals", { users: referrersWithFilleuls });
};

// ── Logs (activité globale) ───────────────────────────────────────────────────

exports.logsPage = async (req, res) => {
  const limit = 200;

  const [recentUsers, recentBookings, recentLogins] = await Promise.all([
    User.find({})
      .select("fullName email isPremium subscription createdAt referredBy")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Booking.find({})
      .select("name surname email date startTime status company service isGroup createdAt")
      .populate("company", "slug owner")
      .populate("service", "name")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    LoginEvent.find({})
      .populate("user", "fullName email")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
  ]);

  // Merge and sort by createdAt desc
  const events = [];

  recentUsers.forEach((u) => {
    events.push({
      type: "register",
      date: u.createdAt,
      label: `${u.fullName || u.email} s'est inscrit${u.isPremium ? ' (payant)' : ''}`,
      detail: u.email,
      plan: u.subscription?.plan || (u.isPremium ? 'pro' : 'basic'),
      icon: "👤",
    });
  });

  const METHOD_LABEL = { local: "mot de passe", "2fa": "code 2FA", google: "Google" };
  recentLogins.forEach((l) => {
    if (!l.user) return; // utilisateur supprimé depuis
    events.push({
      type: "login",
      date: l.createdAt,
      label: `${l.user.fullName || l.user.email} s'est connecté`,
      detail: `${l.user.email} · ${METHOD_LABEL[l.method] || l.method}`,
      icon: "🔑",
    });
  });

  recentBookings.forEach((b) => {
    const serviceName = b.service?.name || "Service";
    const slug = b.company?.slug || "?";
    events.push({
      type: "booking",
      date: b.createdAt,
      label: `${b.name || ''} ${b.surname || ''} → ${serviceName} chez ${slug}`,
      detail: b.email || "",
      status: b.status,
      icon: b.isGroup ? "👥" : "📅",
    });
  });

  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.render("superadmin/logs", { events: events.slice(0, 300) });
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

// ── Suppression définitive d'un compte (+ toutes ses données) ────────────────
exports.deleteUserAccount = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select("_id");
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });

    const company = await Company.findOne({ owner: userId }).select("_id").lean();
    if (company) {
      const companyId = company._id;
      await Promise.all([
        Service.deleteMany({ company: companyId }),
        Employee.deleteMany({ company: companyId }),
        DaysOff.deleteMany({ company: companyId }),
        Form.deleteMany({ company: companyId }),
        Review.deleteMany({ company: companyId }),
      ]);
      await Company.deleteOne({ _id: companyId });
    }

    await Booking.deleteMany({ company: userId });
    await User.deleteOne({ _id: userId });

    res.json({ success: true });
  } catch (err) {
    console.error("deleteUserAccount error:", err);
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

  const smsNotificationsEnabled = byKey["sms_notifications"]?.status === "active";

  // Fonctionnalités admin (sidebar/sections) activées par défaut, désactivables
  // par le superadmin pour faciliter les tests.
  const adminFeatures = ADMIN_FEATURES.map((f) => ({
    key: f.key,
    label: f.label,
    enabled: byKey[f.key]?.status !== "disabled",
  }));

  // Navigation du sidebar admin — détectée automatiquement depuis
  // sidebar.pug (voir utils/navLinks.js). Aucune liste à maintenir : un
  // nouveau lien ajouté dans la sidebar apparaît ici tout seul, regroupé
  // par section comme dans le sidebar lui-même.
  const navLinks = extractNavLinks().map((l) => ({
    ...l,
    enabled: byKey[l.key]?.status !== "disabled",
  }));
  const navSections = [];
  navLinks.forEach((l) => {
    let group = navSections.find((s) => s.label === l.section);
    if (!group) { group = { label: l.section, links: [] }; navSections.push(group); }
    group.links.push(l);
  });

  res.render("superadmin/features", { features, smsNotificationsEnabled, adminFeatures, navSections });
};

// Toggle d'un lien de nav auto-détecté (voir extractNavLinks). La clé est
// validée contre la liste RÉELLEMENT présente dans sidebar.pug à cet instant
// — pas une liste statique à maintenir à la main.
exports.toggleNavLink = async (req, res) => {
  try {
    const { key } = req.params;
    const link = extractNavLinks().find((l) => l.key === key);
    if (!link) {
      return res.status(404).json({ error: "Lien de navigation inconnu." });
    }

    const { enabled } = req.body;
    await FeatureFlag.findOneAndUpdate(
      { key },
      { key, label: link.label, status: enabled ? "active" : "disabled" },
      { upsert: true }
    );

    invalidateFeatureFlagCache();
    res.json({ success: true, enabled: !!enabled });
  } catch (err) {
    console.error("toggleNavLink error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// Toggle générique on/off pour des fonctionnalités cachées (ex: SMS) ou des
// fonctionnalités admin activées par défaut (ex: Cours collectifs, Tampon).
exports.toggleHiddenFeature = async (req, res) => {
  try {
    const { key } = req.params;
    const ALLOWED_KEYS = ["sms_notifications", ...ADMIN_FEATURES.map((f) => f.key)];
    if (!ALLOWED_KEYS.includes(key)) {
      return res.status(404).json({ error: "Fonctionnalité inconnue." });
    }

    const { enabled } = req.body;
    await FeatureFlag.findOneAndUpdate(
      { key },
      { key, status: enabled ? "active" : "disabled" },
      { upsert: true }
    );

    invalidateFeatureFlagCache();
    res.json({ success: true, enabled: !!enabled });
  } catch (err) {
    console.error("toggleHiddenFeature error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
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

// ── Support content editor ────────────────────────────────────────────────────
const SupportContent = require("../db/models/supportContent.model");

async function getOrCreateSupportContent() {
  let doc = await SupportContent.findOne();
  if (!doc) doc = await SupportContent.create({ sections: [] });
  return doc;
}

// ── Chat support (founder) ──────────────────────────────────────────────────
exports.supportChatPage = async (req, res) => {
  try {
    const SupportChat = require("../db/models/supportChat.model");
    const chats = await SupportChat.find({}).sort({ lastMessageAt: -1 }).lean();
    res.render("superadmin/support-chat", { saPage: "chat", chats });
  } catch (err) {
    console.error("supportChatPage error:", err);
    res.status(500).send("Erreur serveur.");
  }
};

exports.getSupportChatThread = async (req, res) => {
  try {
    const SupportChat = require("../db/models/supportChat.model");
    const chat = await SupportChat.findOneAndUpdate(
      { user: req.params.userId },
      { unreadByAdmin: 0 },
      { new: true }
    ).lean();
    if (!chat) return res.status(404).json({ error: "Conversation introuvable." });
    res.json({ success: true, chat });
  } catch (err) {
    console.error("getSupportChatThread error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.replySupportChat = async (req, res) => {
  try {
    const text = (req.body.text || "").trim();
    if (!text) return res.status(400).json({ error: "Message vide." });
    const SupportChat = require("../db/models/supportChat.model");
    const chat = await SupportChat.findOneAndUpdate(
      { user: req.params.userId },
      {
        $push: { messages: { sender: "admin", text } },
        $inc: { unreadByUser: 1 },
        $set: { lastMessageAt: new Date() },
      },
      { new: true }
    );
    if (!chat) return res.status(404).json({ error: "Conversation introuvable." });
    const io = req.app.get("io");
    if (io) {
      const lastMsg = chat.messages[chat.messages.length - 1];
      io.to(`user:${req.params.userId}`).emit("support:newMessage", {
        sender: "admin",
        text: lastMsg.text,
        createdAt: lastMsg.createdAt,
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("replySupportChat error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// Fermer une conversation = la supprimer (pas d'archivage — on ne garde pas
// l'historique pour économiser la base). Si l'utilisateur réécrit ensuite,
// un nouveau fil est recréé automatiquement (cf. getSupportChat côté user).
exports.deleteSupportChat = async (req, res) => {
  try {
    const SupportChat = require("../db/models/supportChat.model");
    await SupportChat.deleteOne({ user: req.params.userId });
    const io = req.app.get("io");
    if (io) io.to(`user:${req.params.userId}`).emit("support:chatClosed");
    res.json({ success: true });
  } catch (err) {
    console.error("deleteSupportChat error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.getSupportChatUnreadTotal = async (req, res) => {
  try {
    const SupportChat = require("../db/models/supportChat.model");
    const result = await SupportChat.aggregate([
      { $group: { _id: null, total: { $sum: "$unreadByAdmin" } } },
    ]);
    res.json({ success: true, unread: result[0]?.total || 0 });
  } catch (err) {
    res.json({ success: true, unread: 0 });
  }
};

exports.supportEditorPage = async (req, res) => {
  try {
    const doc = await getOrCreateSupportContent();
    const sections = doc.sections.slice().sort((a, b) => a.order - b.order);
    res.render("superadmin/support-editor", { saPage: "support", sections });
  } catch (err) {
    console.error("supportEditorPage error:", err);
    res.status(500).send("Erreur serveur.");
  }
};

exports.addSection = async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: "Titre requis." });
    const doc = await getOrCreateSupportContent();
    const order = doc.sections.length;
    doc.sections.push({ title, order, videos: [], faqs: [] });
    await doc.save();
    const section = doc.sections[doc.sections.length - 1];
    res.json({ success: true, section });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.updateSection = async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { title, order } = req.body;
    const doc = await getOrCreateSupportContent();
    const section = doc.sections.id(sectionId);
    if (!section) return res.status(404).json({ error: "Section introuvable." });
    if (title !== undefined) section.title = title;
    if (order !== undefined) section.order = Number(order);
    await doc.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.deleteSection = async (req, res) => {
  try {
    const { sectionId } = req.params;
    const doc = await getOrCreateSupportContent();
    doc.sections.pull({ _id: sectionId });
    await doc.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.reorderSections = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: "IDs requis." });
    const doc = await getOrCreateSupportContent();
    ids.forEach((id, index) => {
      const section = doc.sections.id(id);
      if (section) section.order = index;
    });
    await doc.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.addVideo = async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { title, url, duration } = req.body;
    const doc = await getOrCreateSupportContent();
    const section = doc.sections.id(sectionId);
    if (!section) return res.status(404).json({ error: "Section introuvable." });
    section.videos.push({ title: title || "Nouvelle vidéo", url: url || "", duration: duration || "" });
    await doc.save();
    const video = section.videos[section.videos.length - 1];
    res.json({ success: true, video });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.updateVideo = async (req, res) => {
  try {
    const { sectionId, videoId } = req.params;
    const { title, url, duration } = req.body;
    const doc = await getOrCreateSupportContent();
    const section = doc.sections.id(sectionId);
    if (!section) return res.status(404).json({ error: "Section introuvable." });
    const video = section.videos.id(videoId);
    if (!video) return res.status(404).json({ error: "Vidéo introuvable." });
    if (title !== undefined) video.title = title;
    if (url !== undefined) video.url = url;
    if (duration !== undefined) video.duration = duration;
    await doc.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.deleteVideo = async (req, res) => {
  try {
    const { sectionId, videoId } = req.params;
    const doc = await getOrCreateSupportContent();
    const section = doc.sections.id(sectionId);
    if (!section) return res.status(404).json({ error: "Section introuvable." });
    section.videos.pull({ _id: videoId });
    await doc.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.addFaq = async (req, res) => {
  try {
    const { sectionId } = req.params;
    const { question, answer } = req.body;
    if (!question || !answer) return res.status(400).json({ error: "Question et réponse requises." });
    const doc = await getOrCreateSupportContent();
    const section = doc.sections.id(sectionId);
    if (!section) return res.status(404).json({ error: "Section introuvable." });
    section.faqs.push({ question, answer });
    await doc.save();
    const faq = section.faqs[section.faqs.length - 1];
    res.json({ success: true, faq });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.updateFaq = async (req, res) => {
  try {
    const { sectionId, faqId } = req.params;
    const { question, answer } = req.body;
    const doc = await getOrCreateSupportContent();
    const section = doc.sections.id(sectionId);
    if (!section) return res.status(404).json({ error: "Section introuvable." });
    const faq = section.faqs.id(faqId);
    if (!faq) return res.status(404).json({ error: "FAQ introuvable." });
    if (question !== undefined) faq.question = question;
    if (answer !== undefined) faq.answer = answer;
    await doc.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.deleteFaq = async (req, res) => {
  try {
    const { sectionId, faqId } = req.params;
    const doc = await getOrCreateSupportContent();
    const section = doc.sections.id(sectionId);
    if (!section) return res.status(404).json({ error: "Section introuvable." });
    section.faqs.pull({ _id: faqId });
    await doc.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Impersonation & Supervision ───────────────────────────────────────────────
// In-memory store: token → { userId, expiresAt, accepted }
const pendingSupervisions = new Map();
const { activeSupervisions } = require("../utils/supervisionState");

exports.impersonate = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) return res.status(404).send("Utilisateur introuvable");

    req.logIn(user, (err) => {
      if (err) return res.status(500).send(err.message);
      req.session.superadminBackup = true;
      req.session.isImpersonating = {
        mode: "discrete",
        userId: String(user._id),
        userEmail: user.email,
        since: new Date().toISOString(),
      };
      res.redirect("/panel");
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
};

exports.exitImpersonation = (req, res) => {
  const impersonating = req.session.isImpersonating;
  req.logout((err) => {
    if (err) console.error("logout error:", err);
    // Si supervision active : notifier l'utilisateur et nettoyer l'état
    if (impersonating && impersonating.mode === "supervised" && impersonating.userId) {
      activeSupervisions.delete(impersonating.userId);
      req.app.get("io").to(`user:${impersonating.userId}`).emit("supervision:ended");
    }
    req.session.isSuperAdmin = true;
    req.session.superadminBackup = null;
    req.session.isImpersonating = null;
    req.session.save((saveErr) => {
      if (saveErr) console.error("session save error:", saveErr);
      res.redirect("/superadmin/establishments");
    });
  });
};

exports.supervisionRequest = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select("email").lean();
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    const token = crypto.randomBytes(24).toString("hex");
    pendingSupervisions.set(token, {
      userId,
      expiresAt: Date.now() + 5 * 60 * 1000,
      accepted: false,
    });
    setTimeout(() => pendingSupervisions.delete(token), 5 * 60 * 1000);

    const io = req.app.get("io");
    io.to(`user:${userId}`).emit("supervision:request", { token, adminName: "BranShee Admin" });

    res.json({ success: true, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.supervisionRespond = async (req, res) => {
  try {
    const { token, action } = req.body;
    const pending = pendingSupervisions.get(token);
    if (!pending || Date.now() > pending.expiresAt) {
      return res.json({ success: false, error: "Token expiré ou invalide" });
    }

    const io = req.app.get("io");
    if (action === "accept") {
      pending.accepted = true;
      io.to("superadmin").emit("supervision:accepted", { token, userId: pending.userId });
    } else {
      pendingSupervisions.delete(token);
      io.to("superadmin").emit("supervision:declined", { token });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.supervisionImpersonate = async (req, res) => {
  try {
    const { token } = req.params;
    const pending = pendingSupervisions.get(token);
    if (!pending || !pending.accepted || Date.now() > pending.expiresAt) {
      return res.status(403).send("Token invalide ou expiré");
    }
    pendingSupervisions.delete(token);

    const user = await User.findById(pending.userId);
    if (!user) return res.status(404).send("Utilisateur introuvable");

    req.logIn(user, (err) => {
      if (err) return res.status(500).send(err.message);
      const userId = String(user._id);
      req.session.superadminBackup = true;
      req.session.isImpersonating = {
        mode: "supervised",
        userId,
        userEmail: user.email,
        since: new Date().toISOString(),
      };
      activeSupervisions.set(userId, { since: new Date().toISOString() });
      req.app.get("io").to(`user:${userId}`).emit("supervision:started");
      res.redirect("/panel");
    });
  } catch (err) {
    res.status(500).send(err.message);
  }
};

exports.supervisionClose = async (req, res) => {
  try {
    const userId = req.user ? String(req.user._id) : null;
    if (!userId) return res.status(401).json({ error: "Non authentifié" });
    activeSupervisions.delete(userId);
    req.app.get("io").to("superadmin").emit("supervision:closed-by-user", { userId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
