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

// Comparaison à temps constant : un `===` classique s'arrête au premier
// caractère différent, ce qui laisse fuir la longueur/le préfixe du secret par
// mesure de timing. On hashe les deux côtés (longueur fixe) avant de comparer.
function secretMatches(provided) {
  const expected = process.env.SUPERADMIN_SECRET;
  if (!expected || !provided) return false; // jamais de login si secret non défini
  const a = crypto.createHash("sha256").update(String(provided)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

exports.login = (req, res) => {
  const isAjax = req.headers["x-requested-with"] === "fetch";
  const { secret } = req.body;
  if (secretMatches(secret)) {
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
  const [companiesRaw, totalBookings] = await Promise.all([
    Company.find(query)
      .populate("owner", "fullName email isPremium manualPremium subscription businessName businessPicture")
      .select("name slug businessType createdAt isPaused photo description")
      .sort("-createdAt")
      .lean(),
    Booking.countDocuments({}),
  ]);

  // Ne lister que les VRAIS établissements : ceux qui ont un nom affichable.
  // Un compte pro inscrit mais jamais configuré crée une Company vide (name ""),
  // affichée « — / — » — on l'exclut (même critère que l'affichage dans la vue).
  const companies = companiesRaw.filter((c) => {
    const displayName = (c.name || (c.owner && c.owner.businessName) || "").trim();
    return displayName !== "";
  });

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
  const [users, totalViews, uniqueVisitors, totalClients, clientsToday, adminsToday, disabledCount, topSources] = await Promise.all([
    User.find(query)
      .select("fullName email isPremium manualPremium manualPremiumExpiry subscription createdAt isDisabled lastLoginAt")
      .sort("-createdAt")
      .lean(),
    PageView.countDocuments({}),
    PageView.distinct("visitorId"),
    Client.countDocuments({}),
    Client.countDocuments({ createdAt: { $gte: startOfDay } }),
    User.countDocuments({ createdAt: { $gte: startOfDay } }),
    User.countDocuments({ isDisabled: true }),
    PageView.aggregate([
      { $group: { _id: { $ifNull: ["$source", "direct"] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
  ]);

  // ── Rattacher les établissements à chaque propriétaire ────────────────────
  // Un utilisateur n'a plus de "plan" (il vit sur l'établissement) : ici on
  // liste juste les établissements qu'il possède, avec leur plan effectif
  // hérité de lui, pour l'afficher dans la nouvelle page centrée sur la personne.
  const companies = await Company.find({ owner: { $in: users.map((u) => u._id) } })
    .select("name slug owner isPaused")
    .lean();
  const companiesByOwner = new Map();
  companies.forEach((c) => {
    const key = String(c.owner);
    if (!companiesByOwner.has(key)) companiesByOwner.set(key, []);
    companiesByOwner.get(key).push(c);
  });
  const PLAN_LABEL = { basic: "Free", essentiel: "Essentiel", pro: "Pro", business: "Business" };
  users.forEach((u) => {
    u.establishments = companiesByOwner.get(String(u._id)) || [];
    const rawPlan = (u.manualPremium || u.isPremium)
      ? (u.subscription?.plan && u.subscription.plan !== "basic" ? u.subscription.plan : "pro")
      : (u.subscription?.status === "active" ? (u.subscription.plan || "basic") : "basic");
    u.planKey = rawPlan === "premium" ? "pro" : rawPlan;
    u.planLabel = PLAN_LABEL[u.planKey] || "Free";
  });

  res.render("superadmin/users", {
    users,
    search: search || "",
    topSources,
    totalViews,
    uniqueViews: uniqueVisitors.length,
    totalClients,
    clientsToday,
    adminsToday,
    disabledCount,
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
  const Subscription = require("../db/models/subscription.model");

  const [recentUsers, recentBookings, recentLogins, recentSubs, recentPayments, accessLinks] = await Promise.all([
    User.find({})
      .select("fullName email isPremium subscription createdAt referredBy")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Booking.find({})
      .select("name surname email date startTime status company service isGroup createdAt")
      .populate({
        path: "company",
        select: "name owner",
        populate: { path: "owner", select: "businessName fullName" },
      })
      .populate("service", "name")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    LoginEvent.find({})
      .populate("user", "fullName email")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    // Abonnements pros (achats BranShee) — statut actif = passage à un plan payant.
    Subscription.find({ status: "active", plan: { $ne: "basic" } })
      .populate("user", "fullName email")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
    // Paiements clients (RDV réglés en ligne).
    Booking.find({ "payment.status": "paid" })
      .select("name surname serviceName payment company")
      .populate({
        path: "company",
        select: "name owner",
        populate: { path: "owner", select: "businessName fullName" },
      })
      .sort({ "payment.paidAt": -1 })
      .limit(100)
      .lean(),
    // Activations de liens d'accès (offerts par le fondateur).
    AccessLink.find({ "uses.0": { $exists: true } })
      .select("label plan uses")
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

  const companyLabel = (company) =>
    company?.name || company?.owner?.businessName || company?.owner?.fullName || "établissement supprimé";

  recentBookings.forEach((b) => {
    const serviceName = b.service?.name || "Service";
    events.push({
      type: "booking",
      date: b.createdAt,
      label: `${b.name || ''} ${b.surname || ''} → ${serviceName} chez ${companyLabel(b.company)}`,
      detail: b.email || "",
      status: b.status,
      icon: b.isGroup ? "👥" : "📅",
    });
  });

  const PLAN_NICE = { essentiel: "Essentiel", pro: "Pro", business: "Business", premium: "Pro" };
  recentSubs.forEach((s) => {
    if (!s.user) return;
    events.push({
      type: "subscription",
      date: s.createdAt,
      label: `${s.user.fullName || s.user.email} est passé au plan ${PLAN_NICE[s.plan] || s.plan}`,
      detail: s.user.email,
      plan: s.plan,
      icon: "⭐",
    });
  });

  recentPayments.forEach((p) => {
    const amount = p.payment?.amount ? `${p.payment.amount}€` : "";
    events.push({
      type: "payment",
      date: p.payment?.paidAt || p.createdAt,
      label: `${p.name || ''} ${p.surname || ''} a payé ${amount} — ${p.serviceName || 'prestation'} chez ${companyLabel(p.company)}`.replace(/\s+/g, " ").trim(),
      detail: "",
      icon: "💰",
    });
  });

  accessLinks.forEach((link) => {
    (link.uses || []).forEach((u) => {
      events.push({
        type: "access",
        date: u.usedAt,
        label: `Accès ${(link.plan || "").toUpperCase()} activé${link.label ? ` (${link.label})` : ""}`,
        detail: u.email || "",
        icon: "🎟",
      });
    });
  });

  events.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.render("superadmin/logs", { events: events.slice(0, 400) });
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

    const CompanyMembership = require("../db/models/company/companyMembership.model");
    const Subscription = require("../db/models/subscription.model");

    // Un utilisateur peut posséder PLUSIEURS établissements (cf. "Gérer mes
    // établissements") — { owner: userId } seul (sans .find) n'en trouvait
    // qu'un, et le champ utilisé plus bas pour purger les réservations était
    // `userId` au lieu de l'ID de chaque établissement (les Booking
    // référencent `company`, jamais l'utilisateur) : les réservations
    // n'étaient donc jamais réellement supprimées, laissées orphelines après
    // coup — et selon les données, ça pouvait faire échouer le reste de
    // l'opération de façon imprévisible.
    const companies = await Company.find({ owner: userId }).select("_id").lean();
    const companyIds = companies.map((c) => c._id);
    if (companyIds.length > 0) {
      await Promise.all([
        Service.deleteMany({ company: { $in: companyIds } }),
        Employee.deleteMany({ company: { $in: companyIds } }),
        DaysOff.deleteMany({ company: { $in: companyIds } }),
        Form.deleteMany({ company: { $in: companyIds } }),
        Review.deleteMany({ company: { $in: companyIds } }),
        Booking.deleteMany({ company: { $in: companyIds } }),
        CompanyMembership.deleteMany({ company: { $in: companyIds } }),
      ]);
      await Company.deleteMany({ _id: { $in: companyIds } });
    }

    // Adhésions de CET utilisateur comme collaborateur d'AUTRES établissements
    // (pas les siens) + son historique de connexions/abonnements — sinon
    // laissés orphelins, référençant un User qui n'existe plus.
    await Promise.all([
      CompanyMembership.deleteMany({ user: userId }),
      LoginEvent.deleteMany({ user: userId }),
      Subscription.deleteMany({ user: userId }),
    ]);

    await User.deleteOne({ _id: userId });

    res.json({ success: true });
  } catch (err) {
    console.error("deleteUserAccount error:", err);
    res.status(500).json({ error: err.message || "Erreur serveur." });
  }
};

// ── Suppression d'UN établissement (superadmin) ─────────────────────────────
// Hard delete de la Company + toutes ses données liées (services, employés,
// réservations, avis, formulaires, jours off, adhésions, grades). Le compte
// propriétaire, lui, est CONSERVÉ (il peut être client ou avoir d'autres
// établissements) — on détache juste l'établissement s'il y pointait.
exports.deleteEstablishment = async (req, res) => {
  try {
    const { companyId } = req.params;
    const company = await Company.findById(companyId).select("_id owner name").lean();
    if (!company) return res.status(404).json({ error: "Établissement introuvable." });

    const CompanyMembership = require("../db/models/company/companyMembership.model");
    const CompanyGrade = require("../db/models/company/companyGrade.model");

    await Promise.all([
      Service.deleteMany({ company: companyId }),
      Employee.deleteMany({ company: companyId }),
      DaysOff.deleteMany({ company: companyId }),
      Form.deleteMany({ company: companyId }),
      Review.deleteMany({ company: companyId }),
      Booking.deleteMany({ company: companyId }),
      CompanyMembership.deleteMany({ company: companyId }),
      CompanyGrade.deleteMany({ company: companyId }),
    ]);
    await Company.deleteOne({ _id: companyId });

    // Détache l'établissement de son propriétaire s'il y faisait référence.
    if (company.owner) {
      await User.updateOne(
        { _id: company.owner, company: companyId },
        { $unset: { company: "" } },
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("deleteEstablishment (superadmin) error:", err);
    return res.status(500).json({ error: err.message || "Erreur serveur." });
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
  // Certaines pages sont déjà pilotées comme "fonctionnalités admin"
  // (ex: Cours collectifs = group_sessions) : on les retire de la détection
  // sidebar pour ne pas les afficher DEUX fois sur cette page.
  const adminFeatureKeys = new Set(ADMIN_FEATURES.map((f) => f.key));
  const navLinks = extractNavLinks()
    .filter((l) => !adminFeatureKeys.has(l.key.replace(/^nav_/, "")))
    .map((l) => ({
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
  // ── FAILLE CRITIQUE CORRIGÉE ──────────────────────────────────────────────
  // Avant, cette route n'avait AUCUN garde et posait `isSuperAdmin = true`
  // sans condition → n'importe quel visiteur anonyme qui ouvrait cette URL
  // devenait superadmin. On ne restaure le statut QUE si la session porte
  // bien la preuve d'une usurpation en cours (`superadminBackup`, posé
  // uniquement par impersonate()/supervisionImpersonate() côté superadmin
  // authentifié). Sans backup → pas d'élévation, on renvoie vers l'accueil.
  const hadBackup = req.session.superadminBackup === true;
  if (!hadBackup) {
    return res.redirect("/");
  }

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

// ── Messagerie fondateur → utilisateurs pros ──────────────────────────────────
const AdminMessage = require("../db/models/adminMessage.model");
const MSG_TYPES = ["info", "warning", "security", "success", "tip"];

// Page de gestion : composer + historique des messages envoyés.
exports.messagesPage = async (req, res) => {
  const [messages, totalUsers, userList] = await Promise.all([
    AdminMessage.find({})
      .populate("recipient", "fullName email")
      .sort("-createdAt")
      .limit(200)
      .lean(),
    User.countDocuments({}),
    User.find({}).select("fullName email").sort("fullName").lean(),
  ]);
  messages.forEach((m) => { m.readCount = (m.dismissedBy || []).length; });
  res.render("superadmin/messages", { messages, totalUsers, userList });
};

// Envoi d'un message ciblé (recipientId) ou en diffusion (broadcast=true).
exports.sendMessage = async (req, res) => {
  try {
    const { recipientId, broadcast, title, body, type, ctaLabel, ctaUrl } = req.body;

    const cleanTitle = (title || "").toString().trim();
    const cleanBody = (body || "").toString().trim();
    if (!cleanTitle || !cleanBody) {
      return res.status(400).json({ error: "Titre et message requis." });
    }
    const msgType = MSG_TYPES.includes(type) ? type : "info";
    const isBroadcast = broadcast === true || broadcast === "true" || broadcast === "1";

    let recipient = null;
    if (!isBroadcast) {
      let user = null;
      if (recipientId) {
        user = await User.findById(recipientId).select("_id").lean();
      } else if (req.body.recipientEmail) {
        const email = String(req.body.recipientEmail).trim().toLowerCase();
        user = await User.findOne({ email }).select("_id").lean();
      }
      if (!user) return res.status(404).json({ error: "Destinataire introuvable (vérifiez l'email)." });
      recipient = user._id;
    }

    const msg = await AdminMessage.create({
      recipient,
      broadcast: isBroadcast,
      title: cleanTitle.slice(0, 140),
      body: cleanBody.slice(0, 4000),
      type: msgType,
      ctaLabel: (ctaLabel || "").toString().trim().slice(0, 60),
      ctaUrl: (ctaUrl || "").toString().trim().slice(0, 500),
    });

    // Notification temps réel : on émet globalement, chaque client recharge
    // SES propres messages via /api/my-messages (scopé par req.user). Évite de
    // dépendre du nom exact de la room par utilisateur.
    try {
      const io = req.app.get("io");
      if (io) io.emit("adminMessage:new");
    } catch (_) {}

    res.json({ success: true, id: msg._id });
  } catch (err) {
    console.error("sendMessage error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.deleteMessage = async (req, res) => {
  try {
    await AdminMessage.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};
