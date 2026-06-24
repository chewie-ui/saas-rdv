const router = require("express").Router();
const _routeEnv = require(`../environment/${process.env.NODE_ENV || "development"}`);

const { getCompanyIfExist } = require("../controllers/auth.controller");
const User = require("../db/models/user.model");
const Companies = require("../db/models/company/company.model");
const Review = require("../db/models/review.model");
const pug = require("pug");
const path = require("path");
const { sendEmail } = require("../utils/mailer");
const getServices = require("../utils/services");
const { requireFeatureActive } = require("../middlewares/featureFlag");

router.use(require("./ical"));
router.use(require("./auth"));
router.use(require("./client-auth"));
router.use(require("./company"));
router.use(require("./admin"));
router.use(require("./booking"));
router.use("/api", require("./api"));
router.use("/reviews", require("./reviews"));
router.use("/account", require("./user/account"));
router.use(require("./superadmin"));
router.use(require("./services"));
router.use(require("./employees"));

// Échappe les caractères spéciaux regex — la catégorie/nom/ville viennent de
// l'utilisateur (champ de recherche ou clic sidebar), jamais d'une liste figée
// côté serveur, donc toujours traiter ça comme une regex non fiable.
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ── Catégories dynamiques depuis la base ────────────────────────────────── */
// Ne compte que les utilisateurs ayant RÉELLEMENT un établissement créé (et
// non désactivé) — sinon une inscription jamais terminée (pas de Company,
// cf. injectCompany qui redirige vers /register tant qu'il n'y en a pas)
// fait apparaître une catégorie dans la sidebar qui renvoie ensuite "0
// professionnels trouvés" au clic, puisque /search ne liste que des Companies.
async function getDynamicCategories() {
  const counts = await User.aggregate([
    {
      $match: {
        businessType: { $exists: true, $ne: "" },
        $or: [{ isDisabled: false }, { isDisabled: { $exists: false } }],
      },
    },
    { $lookup: { from: "companies", localField: "_id", foreignField: "owner", as: "company" } },
    { $match: { "company.0": { $exists: true } } },
    // Regroupe par valeur normalisée (espaces + casse) pour fusionner les
    // doublons type "Développeur freelance" / "développeur freelance " qui
    // apparaissaient sinon comme deux catégories distinctes dans la sidebar.
    { $project: { businessType: 1, _norm: { $toLower: { $trim: { input: "$businessType" } } } } },
    { $group: { _id: "$_norm", name: { $first: "$businessType" }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return counts.map(c => ({ name: (c.name || "").trim(), count: c.count }));
}

/* ── Tri des établissements : Business > Pro > Gratuit, puis par boost, puis par note ── */
function planPriority(plan, isPremium) {
  if (plan === "business") return 3;
  if (plan === "pro")      return 2;
  if (isPremium)           return 1; // premium sans plan précis
  return 0;                          // gratuit
}

function sortEstablishments(a, b) {
  // 1. Boostés en premier (position 1 avant 2)
  const aBoost = a.boostPosition > 0;
  const bBoost = b.boostPosition > 0;
  if (aBoost !== bBoost) return aBoost ? -1 : 1;
  if (aBoost && bBoost)  return a.boostPosition - b.boostPosition;
  // 2. Business > Pro > Gratuit
  const aPlan = planPriority(a.plan, a.owner?.isPremium || a.featured);
  const bPlan = planPriority(b.plan, b.owner?.isPremium || b.featured);
  if (aPlan !== bPlan) return bPlan - aPlan;
  // 3. Par note puis nb d'avis
  return b.avgRating - a.avgRating || b.reviewCount - a.reviewCount;
}

/* ── Sitemap ──────────────────────────────────────────────────────── */
router.get("/sitemap.xml", async (req, res) => {
  const BASE  = "https://www.branshee.com";
  const today = new Date().toISOString().split("T")[0];

  // Tous les pros (premium ET gratuits) — slug en priorité, fallback sur _id
  let companyUrls = "";
  try {
    const companies = await Companies.find({})
      .select("_id slug updatedAt owner")
      .populate("owner", "_id")
      .lean();
    companies
      .filter((c) => c.owner)
      .forEach((c) => {
        const loc     = `${BASE}/${c.slug || c._id}`;
        const lastmod = c.updatedAt
          ? new Date(c.updatedAt).toISOString().split("T")[0]
          : today;
        companyUrls += `
  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
      });
  } catch (_) {}

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
  <url>
    <loc>${BASE}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${BASE}/search</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${BASE}/s-inscrire</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${BASE}/contact</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${BASE}/confidentialite</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${BASE}/conditions-utilisation</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>${companyUrls}
</urlset>`;

  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(xml);
});

// router.get("/", async (req, res) => {
//   const coachs = await Companies.find({})
//     .populate({
//       path: "owner",
//       match: { isPremium: true },
//     })
//     .limit(10);

//   console.log({ coachs });

//   const validCoachs = coachs.filter((c) => c.isPremium === true);

//   res.render("client/landing-page", {
//     title: `BranShee — Prenez rendez-vous en ligne simplement`,
//     metaDescription: "Trouvez et réservez en ligne un coach sportif, un coiffeur, un thérapeute ou tout autre professionnel près de chez vous. Prise de rendez-vous gratuite et instantanée avec BranShee.",
//     canonical: "https://www.branshee.com/",
//     coachs: validCoachs,
//     services: getServices(res.locals.lang),
//   });
// });

// ── Page d'accueil ──────────────────────────────────────────────────────────
// NB : la home a été repensée pour optimiser la conversion des PROFESSIONNELS
// (cible payante prioritaire) — elle reprend désormais le contenu de l'ex-page
// "/manage-business". La découverte d'établissements pour les clients (recherche,
// filtres, cartes) vit maintenant entièrement sur "/search", et un bouton
// "Prendre rendez-vous" sur la home renvoie vers cette page de recherche pour
// les visiteurs qui cherchent un professionnel plutôt qu'à en devenir un.
router.get("/", requireFeatureActive("home"), (req, res) => {
  res.render("client/manage-business", {
    title: `BranShee — Agenda en ligne gratuit | Prise de rendez-vous pour professionnels`,
    metaDescription: "BranShee : créez votre agenda en ligne gratuit en 5 minutes et recevez des réservations 24h/24 sans appel téléphonique. Logiciel de prise de rendez-vous pour coiffeurs, coaches, thérapeutes et indépendants. 1 mois offert, sans carte bancaire.",
    canonical: "https://www.branshee.com/",
    becomeCoach: true,
  });
});

router.get("/search", requireFeatureActive("search"), async (req, res) => {
  try {
    const { name, location, category } = req.query;
    let userQuery = {};
    const conditions = [];

    if (name) {
      // Recherche sur le nom complet OU le type de service/métier
      const flexibleName = escapeRegex(name.trim()).replace(/[\s\-\']/g, ".*");
      conditions.push({
        $or: [{ fullName: { $regex: flexibleName, $options: "i" } }, { businessType: { $regex: flexibleName, $options: "i" } }],
      });
    }

    if (location) {
      const flexibleLocation = escapeRegex(location.trim()).replace(/[\s\-\']/g, ".*");
      const locationFilters = [{ "location.city": { $regex: flexibleLocation, $options: "i" } }, { "location.address": { $regex: flexibleLocation, $options: "i" } }];
      const zipValue = parseInt(location);
      if (!isNaN(zipValue)) locationFilters.push({ "location.zip": zipValue });
      conditions.push({ $or: locationFilters });
    }

    // Filtre par catégorie (optionnel) — valeur exacte (insensible à la
    // casse) plutôt qu'une regex partielle : la catégorie vient du clic sur
    // un nom déjà connu (sidebar/onglets), pas d'une saisie libre, donc on
    // évite tout faux positif par sous-chaîne entre deux métiers différents.
    if (category && category.trim()) {
      // \s* en bordure : tolère un éventuel espace résiduel en base (cf.
      // normalisation faite dans getDynamicCategories pour fusionner les
      // doublons "Développeur freelance" / "développeur freelance ").
      conditions.push({ businessType: { $regex: `^\\s*${escapeRegex(category.trim())}\\s*$`, $options: "i" } });
    }

    // PAS de filtre isPremium — tous les établissements, gratuits ET premium
    // Mais on exclut les comptes désactivés par le superadmin
    const disabledFilter = { $or: [{ isDisabled: false }, { isDisabled: { $exists: false } }] };
    if (conditions.length === 0) {
      userQuery = disabledFilter;
    } else if (conditions.length === 1) {
      userQuery = { $and: [conditions[0], disabledFilter] };
    } else {
      userQuery = { $and: [...conditions, disabledFilter] };
    }

    const matchingUsers = await User.find(userQuery).select("_id isPremium manualPremium subscription").lean();
    const matchingIds   = matchingUsers.map((u) => u._id);
    const premiumSet    = new Set(matchingUsers.filter(u => u.isPremium || u.manualPremium).map(u => String(u._id)));

    const filteredCoachs = await Companies.find({ owner: { $in: matchingIds } })
      .populate("owner", "_id fullName businessName businessType businessPicture profilePicture description location verified subscription isPremium manualPremium")
      .select("_id owner slug boostPosition")
      .limit(100)
      .lean();

    const filteredIds = filteredCoachs.map(c => c._id);
    const filteredRatings = await Review.aggregate([
      { $match: { company: { $in: filteredIds } } },
      { $group: { _id: "$company", avgRating: { $avg: "$rating" }, reviewCount: { $sum: 1 } } }
    ]);
    const filteredRatingMap = {};
    filteredRatings.forEach(r => { filteredRatingMap[r._id.toString()] = r; });

    const { getPlan } = require("../utils/planLimits");
    const coachsWithRating = filteredCoachs
      .filter(c => c.owner)
      .map(c => {
        const plan     = getPlan(c.owner);
        const featured = plan === "pro" || plan === "business" || c.owner.isPremium;
        return {
          ...c,
          avgRating:    filteredRatingMap[c._id.toString()]?.avgRating   || 0,
          reviewCount:  filteredRatingMap[c._id.toString()]?.reviewCount || 0,
          featured,
          plan,
          boostPosition: c.boostPosition || 0,
        };
      })
      .sort(sortEstablishments);

    const allCategories = await getDynamicCategories();

    res.render("client/search", {
      title: `Recherche — BranShee`,
      coachs: coachsWithRating,
      searchName: name || "",
      searchLocation: location || "",
      searchCategory: category || "",
      allCategories,
      services: getServices(res.locals.lang),
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

router.get("/contact", (req, res) => {
  res.render("client/contact", { title: "Contact — BranShee", alwaysSticky: true });
});

router.post("/contact", async (req, res) => {
  const { name, surname, email, subject, message } = req.body;

  if (!name || !surname || !email || !subject || !message) {
    return res.render("client/contact", {
      title: "Contact — BranShee",
      error: "Veuillez remplir tous les champs.",
      formData: req.body,
    });
  }

  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const html = pug.renderFile(path.join(__dirname, "../views/templates/emails/contact.pug"), { name, surname, email, subject, message });

    await sendEmail(adminEmail, `[Contact BranShee] ${subject}`, html);

    return res.render("client/contact", {
      title: "Contact — BranShee",
      success: true,
    });
  } catch (err) {
    console.error(err);
    return res.render("client/contact", {
      title: "Contact — BranShee",
      error: "Une erreur est survenue. Veuillez réessayer.",
      formData: req.body,
    });
  }
});

router.get("/confidentialite", (req, res) => {
  res.render("client/confidentialite", {
    title: "Politique de confidentialité — BranShee",
    alwaysSticky: true,
  });
});

router.get("/conditions-utilisation", (req, res) => {
  res.render("client/conditions-utilisation", {
    title: "Conditions d'utilisation — BranShee",
    alwaysSticky: true,
  });
});

// Le contenu "pro" vit désormais directement sur la home ("/") afin de
// maximiser la conversion des visiteurs en professionnels payants — on
// redirige donc en 301 (permanent) pour préserver le référencement et les
// liens existants pointant vers /manage-business.
router.get("/manage-business", (req, res) => {
  res.redirect(301, "/");
});

// ── Landing page dédiée Google Ads ──────────────────────────────────────────
router.get("/pro", (req, res) => {
  res.render("client/lp-pro", {
    title: "Agenda en ligne gratuit pour professionnels — BranShee",
    metaDescription: "Créez votre agenda en ligne en 5 minutes. Vos clients réservent 24h/24 sans vous appeler. 1 mois offert, sans carte bancaire.",
    canonical: "https://www.branshee.com/pro",
    becomeCoach: true,
    services: getServices(res.locals.lang),
  });
});

router.get("/s-inscrire", (req, res) => {
  res.render("auth/choose-account", {
    title: "Créer un compte — BranShee",
    alwaysSticky: true,
  });
});

const AMENITY_OPTIONS = {
  cleanliness: [
    'Gel hydroalcoolique disponible',
    'Salle désinfectée entre les séances',
    'Filtre à air en service',
    'Masques disponibles sur demande',
    'Stérilisation UV',
    'Serviettes à usage unique',
  ],
  comfort: [
    'Table chauffante',
    'Zone calme',
    'Musique personnalisable',
    'Thé / infusion offert(e)',
    'Options aromathérapie',
    'Lumière naturelle',
  ],
  practical: [
    'Parking gratuit',
    'Accès fauteuil roulant',
    'Espèces acceptées',
    'Carte / Bancontact accepté',
    'LGBTQIA+ friendly',
    'Chargeur disponible',
  ],
};

const BADGE_OPTIONS = [
  'Vérifié',
  'LGBTQIA+ friendly',
  'Accès fauteuil roulant',
  'Parking gratuit',
  'Top rated 2024',
  'Carte acceptée',
];

router.get("/:company", requireFeatureActive("booking_page"), async (req, res) => {
  const company = await getCompanyIfExist(req.params.company);

  if (!company) {
    return res.status(404).render("client/404");
  }

  const ID = company.owner;
  const coach = await User.findById(ID);

  // Compte désactivé par le superadmin → page de blocage
  if (coach && coach.isDisabled) {
    return res.status(403).render("client/account-disabled");
  }

  const Service = require("../db/models/company/service.model");
  const Employee = require("../db/models/company/employee.model");

  const services = await Service.find({ company: company._id, active: true }).populate("employees", "firstName lastName profilePicture age description").sort("order").lean();

  const activeEmployees = await Employee.find({ company: company._id, active: true }).lean();

  // Pre-serialize services to avoid Pug interpolation issues with nested braces
  const servicesJson = JSON.stringify(
    services.map(function (s) {
      return {
        _id: String(s._id),
        name: s.name,
        description: s.description || "",
        price: s.price,
        duration: s.duration,
        durationMax: s.durationMax || null,
        category: s.category || "",
        answerVisibility: s.answerVisibility || "all",
        // type/capacity/location manquaient ici — STATE.service.type retombait
        // TOUJOURS sur "individual" côté client (cf. public/js/layouts/index.js),
        // rendant tout le code "collectif" déjà écrit (saut étape employé,
        // places restantes) inerte en production.
        type: s.type || "individual",
        capacity: s.capacity || null,
        location: s.location || "",
        employees: (s.employees || []).map(function (e) {
          return {
            _id: String(e._id),
            firstName: e.firstName || "",
            lastName: e.lastName || "",
            profilePicture: e.profilePicture || "/images/no-user.webp",
            age: e.age || null,
            description: e.description || "",
          };
        }),
      };
    }),
  );

  const employeesJson = JSON.stringify(
    activeEmployees.map(function (e) {
      return {
        _id: String(e._id),
        firstName: e.firstName || "",
        lastName: e.lastName || "",
        profilePicture: e.profilePicture || "/images/no-user.webp",
        age: e.age || null,
        description: e.description || "",
      };
    }),
  );

  // ── Is the business open today? ─────────────────────────────────────────
  let isOpenToday = false;
  try {
    const DaysOff = require("../db/models/company/daysOff.model");
    const now        = new Date();
    const todayDow   = now.getDay();                            // 0=Sun … 6=Sat
    const todayIso   = now.toISOString().split("T")[0];

    // Base: regular weekly schedule
    const schedEntry = company.schedule
      ? company.schedule.find((d) => d.weekdayIndex === todayDow)
      : null;
    isOpenToday = !!(schedEntry && !schedEntry.dayOff &&
                     schedEntry.workingHours && schedEntry.workingHours.length > 0);

    // Override: specific date exception (affects all employees)
    const daysOffDoc = await DaysOff.findOne({ company: company._id }).lean();
    if (daysOffDoc && daysOffDoc.dates) {
      const exc = daysOffDoc.dates.find((d) => {
        const excIso = new Date(d.date).toISOString().split("T")[0];
        return excIso === todayIso && (!d.employees || d.employees.length === 0);
      });
      if (exc) {
        // Exception with hours → open with custom hours; without → closed
        isOpenToday = !!(exc.workingHours && exc.workingHours.length > 0 && exc.workingHours[0].start);
      }
    }
  } catch (_) { isOpenToday = false; }

  // Client connecté → pré-remplir le formulaire + vérifier doublon avis
  let clientUser    = null;
  let clientSession = null;
  let hasReviewed   = false;
  if (req.session && req.session.clientId) {
    try {
      const Client = require("../db/models/client.model");
      const client = await Client.findById(req.session.clientId).lean();
      if (client) {
        const parts = (client.fullName || "").trim().split(" ");
        clientUser = {
          firstName: parts[0] || "",
          lastName: parts.slice(1).join(" ") || "",
          email: client.email || "",
          phone: client.phone || "",
        };
        clientSession = {
          _id:            String(client._id),
          fullName:       client.fullName || "",
          profilePicture: client.profilePicture || "/images/no-user.webp",
        };
        // Vérifier si cet utilisateur a déjà posté un avis
        const Review = require("../db/models/review.model");
        const existingReview = await Review.findOne({ company: company._id, client: client._id }).lean();
        hasReviewed = !!existingReview;
      }
    } catch (_) {}
  }

  // ── Avis ──────────────────────────────────────────────────────────────────
  let reviews = [], avgRating = 0, reviewCount = 0;
  try {
    const Review = require("../db/models/review.model");
    reviews = await Review.find({ company: company._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    reviewCount = reviews.length;
    if (reviewCount > 0) {
      avgRating = Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviewCount) * 10) / 10;
    }
  } catch (_) {}

  const profileTitle = `${coach.businessName || coach.fullName} — Réserver en ligne | BranShee`;
  const profileDesc = coach.description ? `${coach.description.slice(0, 150)}…` : `Réservez en ligne avec ${coach.businessName || coach.fullName}. Prise de rendez-vous rapide et gratuite sur BranShee.`;

  const cs = coach.calendarSettings || {};

  // Stripe Connect réellement opérationnel ?
  const _stripeActive = company.stripeConnect?.status === "active" && !!(company.stripeConnect?.accountId);

  const prepaymentConfig = {
    // "enabled" ne doit JAMAIS forcer une étape de paiement si Stripe n'est
    // pas réellement connecté — sinon le client tombe sur une étape de
    // paiement vide (aucune méthode disponible) et reste bloqué. Filet de
    // sécurité ici même si le réglage admin est, par erreur, resté coché.
    enabled:  !!(company.prepayment?.enabled) && _stripeActive,
    required: !!(company.prepayment?.required) && _stripeActive,
    // Stripe Connect disponible ?
    stripeActive: _stripeActive,
    // Autres modes de paiement
    cash:         !!(company.acceptedPayments?.cash),
    cardOnSite:   !!(company.acceptedPayments?.cardOnSite),
    bankTransfer: !!(company.acceptedPayments?.bankTransfer?.enabled),
    bankDetails: {
      iban:     company.acceptedPayments?.bankTransfer?.iban     || "",
      bic:      company.acceptedPayments?.bankTransfer?.bic      || "",
      bankName: company.acceptedPayments?.bankTransfer?.bankName || "",
      note:     company.acceptedPayments?.bankTransfer?.note     || "",
    },
    // PayPal
    paypal:       !!(company.acceptedPayments?.paypal?.enabled),
    paypalMe:     company.acceptedPayments?.paypal?.paypalMe || "",
    cancellationRule: company.cancellationPolicy?.rule || "free",
  };

  // Detect whether the visitor is an authenticated admin user
  const visitorIsAdmin = !!(req.isAuthenticated && req.isAuthenticated() && req.user);

  res.render("client/index", {
    title: profileTitle,
    metaDescription: profileDesc,
    ogType: "profile",
    ogImage: coach.businessPicture || coach.profilePicture || "https://www.branshee.com/images/og-cover.jpg",
    canonical: `https://www.branshee.com/${company.slug || company._id}`,
    company,
    coach,
    services,
    activeEmployees,
    servicesJson,
    employeesJson,
    clientUser,
    clientSession,
    hasReviewed,
    reviews,
    avgRating,
    reviewCount,
    isOpenToday,
    cs,
    gallery:   cs.gallery   || [],
    equipment: cs.equipment || [],
    amenityOptions: AMENITY_OPTIONS,
    badgeOptions: BADGE_OPTIONS,
    prepaymentConfig,
    stripePublishableKey: _routeEnv.stripePublishableKey || process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY_LOCAL || "",
    visitorIsAdmin,
    alwaysSticky: true,
    clientAuth: true,
  });
});

module.exports = router;
