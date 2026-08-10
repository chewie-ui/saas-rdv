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
const ReviewReport = require("../db/models/review-report.model");
const Client    = require("../db/models/client.model");
// Le forfait affiché est celui de l'ÉTABLISSEMENT, pas celui du compte.
const { getCompanyPlan } = require("../utils/planLimits");
const LoginEvent = require("../db/models/loginEvent.model");
const { FEATURES, ADMIN_FEATURES, invalidateFeatureFlagCache } = require("../middlewares/featureFlag");
const { extractNavLinks } = require("../utils/navLinks");
const { identityFor } = require("../utils/establishmentIdentity");

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

// Tarifs mensuels affichés sur /subscription — sert à estimer le revenu
// récurrent. C'est une estimation à partir des plans, pas un chiffre Stripe.
const PRIX_MENSUEL = { basic: 0, essentiel: 9, pro: 19, business: 49 };

const ETABS_PAR_PAGE = 25;

// Temps restant d'un octroi, lisible d'un coup d'œil : « 12 min », « 3 h »,
// « 49 j ». Un octroi peut désormais durer moins d'une journée.
function formatTempsRestant(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "expiré";
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return minutes + " min";
  const heures = Math.ceil(ms / 3600000);
  if (heures < 48) return heures + " h";
  return Math.ceil(ms / 86400000) + " j";
}

exports.establishmentsPage = async (req, res) => {
  const filtres = {
    search: req.query.search || "",
    plan: req.query.plan || "tous",
    statut: req.query.statut || "tous",
    tri: req.query.tri || "recent",
  };

  const query = {};
  if (filtres.search) {
    const regex = { $regex: filtres.search, $options: "i" };
    query.$or = [{ name: regex }, { slug: regex }, { businessType: regex }];
  }
  // isDeleted = suppression douce faite par le pro lui-même. On ne l'affiche
  // que si on la demande explicitement, sinon la liste montrerait des
  // établissements invisibles partout ailleurs dans l'application.
  if (filtres.statut === "supprime") query.isDeleted = true;
  else query.isDeleted = { $ne: true };
  if (filtres.statut === "actif") query.isPaused = { $ne: true };
  if (filtres.statut === "pause") query.isPaused = true;

  const il7j = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const il30j = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  const [brutes, toutes, totalBookings, bookings30j, parEtab, parEtab30j, clientsParEtab] = await Promise.all([
    Company.find(query)
      .populate("owner", "fullName email isPremium manualPremium manualPremiumExpiry subscription businessName businessPicture isDisabled")
      // `plan`, `planStatus` et `grantExpiry` : le forfait appartient à
      // l'ÉTABLISSEMENT. Sans eux dans le select, la liste retomberait
      // silencieusement sur le forfait du compte pour tout le monde.
      .select("name slug businessType createdAt isPaused isDeleted photo description plan planStatus grantExpiry")
      .lean(),
    // Deuxième passe sans filtre : les chiffres clés doivent rester stables
    // quand on filtre la liste.
    Company.find({ isDeleted: { $ne: true } })
      // `manualPremiumExpiry` est indispensable au chiffre « octrois à
      // échéance » calculé plus bas — sans lui il vaudrait toujours zéro.
      .populate("owner", "isPremium manualPremium manualPremiumExpiry subscription businessName")
      .select("name isPaused createdAt owner plan planStatus grantExpiry")
      .lean(),
    Booking.countDocuments({}),
    Booking.countDocuments({ createdAt: { $gte: il30j } }),
    Booking.aggregate([{ $group: { _id: "$company", count: { $sum: 1 } } }]),
    Booking.aggregate([
      { $match: { createdAt: { $gte: il30j } } },
      { $group: { _id: "$company", count: { $sum: 1 } } },
    ]),
    Client.aggregate([{ $group: { _id: "$company", count: { $sum: 1 } } }]),
  ]);

  // Ne lister que les VRAIS établissements : ceux qui ont un nom affichable.
  // Un compte pro inscrit mais jamais configuré crée une Company vide (name ""),
  // affichée « — / — » — on l'exclut (même critère que l'affichage dans la vue).
  let liste = brutes.filter((c) => (c.name || c.owner?.businessName || "").trim() !== "");

  const rdv = new Map(parEtab.map((b) => [String(b._id), b.count]));
  const rdv30 = new Map(parEtab30j.map((b) => [String(b._id), b.count]));
  const clients = new Map(clientsParEtab.map((b) => [String(b._id), b.count]));
  const maintenant = Date.now();

  liste.forEach((c) => {
    c.bookingCount = rdv.get(String(c._id)) || 0;
    c.bookings30d = rdv30.get(String(c._id)) || 0;
    c.clientCount = clients.get(String(c._id)) || 0;
    c.displayName = (c.name || c.owner?.businessName || "").trim();
    // Même repli que pour le nom. Sans lui, la liste affichait « Métier non
    // renseigné » à des pros qui l'avaient bien saisi : sur les comptes
    // antérieurs au multi-établissement, le métier vit sur le COMPTE et n'a
    // jamais été recopié sur la Company (migration d'identité non lancée).
    c.displayType = (c.businessType || c.owner?.businessType || "").trim();
    c.displayPhoto = c.photo || c.owner?.businessPicture || "";
    // Forfait de L'ÉTABLISSEMENT (repli sur le compte tant que company.plan
    // n'est pas renseigné). Lu sur le propriétaire, deux établissements d'un
    // même patron affichaient forcément le même plan et la même échéance.
    const planEffectif = getCompanyPlan(c, c.owner || {});
    c.planKey = planEffectif;
    c.planLabel = PLAN_LABEL[planEffectif] || "Free";
    // Temps restant de l'accès offert. null = illimité / pas d'octroi.
    // Un octroi peut durer quelques heures : on affiche « 3 h », pas « 1 j ».
    const echeance = c.grantExpiry
      || (!c.plan && c.owner && (c.owner.manualPremium || c.owner.isPremium) ? c.owner.manualPremiumExpiry : null);
    if (planEffectif !== "basic" && echeance) {
      const ms = new Date(echeance).getTime() - maintenant;
      c.trialDaysLeft = ms > 0 ? Math.ceil(ms / 86400000) : 0;
      c.trialLeftLabel = formatTempsRestant(ms);
      c.trialExpiryAt = new Date(echeance).toISOString();
    } else {
      c.trialDaysLeft = null;
      c.trialLeftLabel = null;
      c.trialExpiryAt = null;
    }
  });

  if (filtres.plan !== "tous") liste = liste.filter((c) => c.planKey === filtres.plan);

  const parDate = (v) => (v ? new Date(v).getTime() : 0);
  if (filtres.tri === "ancien") liste.sort((a, b) => parDate(a.createdAt) - parDate(b.createdAt));
  else if (filtres.tri === "nom") liste.sort((a, b) => a.displayName.localeCompare(b.displayName, "fr"));
  else if (filtres.tri === "rdv") liste.sort((a, b) => b.bookingCount - a.bookingCount);
  else liste.sort((a, b) => parDate(b.createdAt) - parDate(a.createdAt));

  // Chiffres clés : calculés sur l'ensemble des établissements réels, pas sur
  // la page affichée — sinon ils changeraient à chaque filtre.
  const tous = toutes.filter((c) => (c.name || c.owner?.businessName || "").trim() !== "");
  const kpis = {
    total: tous.length,
    enPause: tous.filter((c) => c.isPaused).length,
    nouveaux7j: tous.filter((c) => parDate(c.createdAt) >= il7j.getTime()).length,
    sansRdv: tous.filter((c) => !(rdv.get(String(c._id)) || 0)).length,
    totalBookings,
    bookings30j,
    mrr: tous.reduce((somme, c) => somme + (PRIX_MENSUEL[planDuCompte(c.owner || {}).planKey] || 0), 0),
    payants: tous.filter((c) => planDuCompte(c.owner || {}).planKey !== "basic").length,
  };
  kpis.actifs = kpis.total - kpis.enPause;

  // Octrois qui arrivent à échéance : chacun est un moment de conversion à ne
  // pas rater — et, si on le rate, un pro qui bascule en gratuit sans prévenir.
  // Calculé sur `tous` comme les autres chiffres clés, pour ne pas dépendre
  // des filtres affichés.
  const echeances = tous
    .map((c) => {
      const o = c.owner || {};
      // Échéance de CET établissement ; repli sur celle du compte tant qu'il
      // n'a pas de forfait propre (établissements d'avant la séparation).
      const echeance = c.grantExpiry
        || (!c.plan && (o.manualPremium || o.isPremium) ? o.manualPremiumExpiry : null);
      if (!echeance) return null;
      if (getCompanyPlan(c, o) === "basic") return null;
      const ms = new Date(echeance).getTime() - maintenant;
      if (!(ms > 0)) return null;
      return {
        nom: (c.name || o.businessName || "").trim(),
        jours: Math.ceil(ms / 86400000),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.jours - b.jours);
  kpis.octroisQuiExpirent = echeances.length;
  kpis.octroiProchain = echeances[0] || null;
  kpis.octroisUrgents = echeances.filter((e) => e.jours <= 7).length;

  const pages = Math.max(1, Math.ceil(liste.length / ETABS_PAR_PAGE));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);

  res.render("superadmin/establishments", {
    saPage: "estab",
    companies: liste.slice((page - 1) * ETABS_PAR_PAGE, page * ETABS_PAR_PAGE),
    filtres,
    resultats: liste.length,
    page,
    pages,
    kpis,
    search: filtres.search,
    totalBookings,
  });
};

// Export CSV du parc d'établissements (mêmes filtres que la page).
exports.establishmentsExport = async (req, res) => {
  try {
    const query = { isDeleted: { $ne: true } };
    if (req.query.search) {
      const regex = { $regex: req.query.search, $options: "i" };
      query.$or = [{ name: regex }, { slug: regex }, { businessType: regex }];
    }
    if (req.query.statut === "actif") query.isPaused = { $ne: true };
    if (req.query.statut === "pause") query.isPaused = true;

    const [liste, parEtab] = await Promise.all([
      Company.find(query)
        .populate("owner", "fullName email isPremium manualPremium subscription businessName")
        .select("name slug businessType createdAt isPaused")
        .sort("-createdAt")
        .lean(),
      Booking.aggregate([{ $group: { _id: "$company", count: { $sum: 1 } } }]),
    ]);
    const rdv = new Map(parEtab.map((b) => [String(b._id), b.count]));

    const echapper = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lignes = [["Établissement", "Lien", "Métier", "Propriétaire", "Email", "Plan", "RDV", "Statut", "Créé le"].join(";")];
    liste
      .filter((c) => (c.name || c.owner?.businessName || "").trim() !== "")
      .filter((c) => req.query.plan && req.query.plan !== "tous"
        ? planDuCompte(c.owner || {}).planKey === req.query.plan
        : true)
      .forEach((c) => {
        lignes.push([
          echapper((c.name || c.owner?.businessName || "").trim()),
          echapper("/" + (c.slug || "")),
          echapper(c.businessType || ""),
          echapper(c.owner?.fullName || ""),
          echapper(c.owner?.email || ""),
          echapper(planDuCompte(c.owner || {}).planLabel),
          echapper(rdv.get(String(c._id)) || 0),
          echapper(c.isPaused ? "En pause" : "Actif"),
          echapper(c.createdAt ? new Date(c.createdAt).toLocaleDateString("fr-FR") : ""),
        ].join(";"));
      });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="branshee-etablissements.csv"');
    res.send("﻿" + lignes.join("\r\n"));
  } catch (err) {
    console.error("establishmentsExport error:", err);
    res.status(500).send("Erreur serveur.");
  }
};

// Met en pause / réactive un établissement depuis le panel. Même drapeau que
// la pause déclenchée par le pro : page publique et /search masquées, aucune
// donnée touchée, réversible.
exports.toggleEstablishmentPause = async (req, res) => {
  try {
    const c = await Company.findById(req.params.companyId).select("isPaused").lean();
    if (!c) return res.status(404).json({ error: "Établissement introuvable." });
    const nouveau = !c.isPaused;
    await Company.updateOne({ _id: req.params.companyId }, { $set: { isPaused: nouveau } });
    res.json({ success: true, isPaused: nouveau });
  } catch (err) {
    console.error("toggleEstablishmentPause error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// Fiche détaillée d'un établissement (panneau latéral).
exports.establishmentDetails = async (req, res) => {
  try {
    const c = await Company.findById(req.params.companyId)
      .populate("owner", "fullName email phone isPremium manualPremium manualPremiumExpiry subscription isDisabled")
      .lean();
    if (!c) return res.status(404).json({ error: "Établissement introuvable." });

    // Les clients d'un établissement se déduisent des réservations (emails
    // distincts), comme dans clientDossier.controller. L'ancien
    // `Client.countDocuments({ company })` renvoyait TOUJOURS 0 : le schéma
    // Client n'a pas de champ `company`, et Mongoose laisse passer un filtre
    // inconnu tel quel à MongoDB.
    const [reservations, aVenir, services, employes, emailsClients, avis] = await Promise.all([
      Booking.countDocuments({ company: c._id }),
      Booking.countDocuments({ company: c._id, date: { $gte: new Date() } }),
      Service.countDocuments({ company: c._id }),
      Employee.countDocuments({ company: c._id }),
      Booking.distinct("email", { company: c._id, email: { $nin: [null, ""] } }),
      Review.countDocuments({ company: c._id }),
    ]);
    // `distinct` est sensible à la casse : on re-déduplique en minuscules,
    // sinon « Jean@x.be » et « jean@x.be » comptent pour deux personnes.
    const clients = new Set(emailsClients.map((e) => String(e).toLowerCase().trim())).size;

    res.json({
      success: true,
      company: {
        id: String(c._id),
        name: (c.name || "").trim(),
        slug: c.slug || "",
        businessType: c.businessType || "",
        photo: c.photo || "",
        description: c.description || "",
        isPaused: !!c.isPaused,
        isDeleted: !!c.isDeleted,
        createdAt: c.createdAt,
      },
      owner: c.owner
        ? {
            id: String(c.owner._id),
            fullName: c.owner.fullName || "",
            email: c.owner.email || "",
            phone: c.owner.phone || "",
            isDisabled: !!c.owner.isDisabled,
            manualPremium: !!c.owner.manualPremium,
            manualPremiumExpiry: c.owner.manualPremiumExpiry || null,
            ...planDuCompte(c.owner),
          }
        : null,
      stats: { reservations, aVenir, services, employes, clients, avis },
    });
  } catch (err) {
    console.error("establishmentDetails error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

const PLAN_LABEL = { basic: "Free", essentiel: "Essentiel", pro: "Pro", business: "Business" };

// Plan effectif d'un compte : l'octroi manuel prime, sinon l'abonnement Stripe.
function planDuCompte(u) {
  const brut = (u.manualPremium || u.isPremium)
    ? (u.subscription?.plan && u.subscription.plan !== "basic" ? u.subscription.plan : "pro")
    : (u.subscription?.status === "active" ? (u.subscription.plan || "basic") : "basic");
  const cle = brut === "premium" ? "pro" : brut;
  return { planKey: cle, planLabel: PLAN_LABEL[cle] || "Free" };
}

// Charge les comptes correspondant aux filtres, enrichis de leurs
// établissements et de leur plan. Les filtres « plan » et « établissement »
// sont dérivés (pas stockés tels quels) : on les applique en mémoire, après
// avoir réduit au maximum côté base avec la recherche et le statut.
async function chargerComptes({ search, statut, plan, estab }) {
  const query = {};
  if (search) {
    const regex = { $regex: search, $options: "i" };
    query.$or = [{ fullName: regex }, { email: regex }];
  }
  if (statut === "actif") query.isDisabled = { $ne: true };
  if (statut === "desactive") query.isDisabled = true;

  const users = await User.find(query)
    .select("fullName email phone isPremium manualPremium manualPremiumExpiry subscription createdAt isDisabled lastLoginAt")
    .lean();

  const companies = await Company.find({ owner: { $in: users.map((u) => u._id) } })
    .select("name slug owner isPaused")
    .lean();
  const parProprietaire = new Map();
  companies.forEach((c) => {
    const cle = String(c.owner);
    if (!parProprietaire.has(cle)) parProprietaire.set(cle, []);
    parProprietaire.get(cle).push(c);
  });

  let liste = users.map((u) => ({
    ...u,
    establishments: parProprietaire.get(String(u._id)) || [],
    ...planDuCompte(u),
  }));

  if (plan && plan !== "tous") liste = liste.filter((u) => u.planKey === plan);
  if (estab === "avec") liste = liste.filter((u) => u.establishments.length > 0);
  if (estab === "sans") liste = liste.filter((u) => u.establishments.length === 0);
  return liste;
}

function trierComptes(liste, tri) {
  const parDate = (v) => (v ? new Date(v).getTime() : 0);
  const copie = liste.slice();
  if (tri === "ancien") copie.sort((a, b) => parDate(a.createdAt) - parDate(b.createdAt));
  else if (tri === "nom") copie.sort((a, b) => (a.fullName || a.email || "").localeCompare(b.fullName || b.email || "", "fr"));
  else if (tri === "connexion") copie.sort((a, b) => parDate(b.lastLoginAt) - parDate(a.lastLoginAt));
  else copie.sort((a, b) => parDate(b.createdAt) - parDate(a.createdAt));
  return copie;
}

const COMPTES_PAR_PAGE = 25;

// Nombre de personnes DISTINCTES à partir de plusieurs listes d'e-mails.
// L'e-mail est la seule clé commune aux modèles Client et User (les _id
// appartiennent à deux collections différentes et ne sont jamais comparables).
// Normalisation obligatoire : le schéma Client force `lowercase`, pas celui de
// User — sans ça « Jean@X » et « jean@x » compteraient pour deux personnes.
function compterPersonnesDistinctes(...listesDEmails) {
  const set = new Set();
  for (const liste of listesDEmails) {
    for (const email of liste) {
      const cle = String(email || "").trim().toLowerCase();
      if (cle) set.add(cle);
    }
  }
  return set.size;
}

exports.usersPage = async (req, res) => {
  const filtres = {
    search: req.query.search || "",
    statut: req.query.statut || "tous",
    plan: req.query.plan || "tous",
    estab: req.query.estab || "tous",
    tri: req.query.tri || "recent",
  };

  const PageView = require("../db/models/pageView.model");
  const debutJour = new Date();
  debutJour.setHours(0, 0, 0, 0);
  const ilYa7j = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const ilYa30j = new Date(Date.now() - 30 * 24 * 3600 * 1000);

  // Le KPI « clients » couvre les DEUX modèles : l'ancienne collection Client
  // et les User avec accountIntent 'client'. On récupère des E-MAILS et non des
  // comptages, parce qu'une même personne peut être présente des deux côtés :
  //  - POST /client/register et le OAuth Google client créent encore des
  //    documents Client aujourd'hui, y compris pour une adresse déjà connue
  //    côté User (l'unicité est vérifiée dans chaque contrôleur, jamais par un
  //    index couvrant les deux collections) ;
  //  - scripts/migrate-merge-client-into-user.js crée le User puis supprime le
  //    Client, mais il SAUTE les dossiers dont la fusion violerait l'index
  //    unique (company, client) de Review, et il n'a pas de transaction : le
  //    Client d'origine survit alors à côté de son User.
  // Additionner les deux comptages comptait donc ces personnes deux fois ; on
  // dédoublonne sur l'e-mail (seule clé commune aux deux modèles).
  const [
    liste, totalComptes, disabledCount, adminsToday, inscrits7j,
    connectes7j, jamaisConnectes, totalViews, uniqueVisitors,
    emailsLegacy, emailsLegacyToday, emailsUnifies, emailsUnifiesToday,
    topSources, totalEtablissements,
  ] = await Promise.all([
    chargerComptes(filtres),
    User.countDocuments({}),
    User.countDocuments({ isDisabled: true }),
    User.countDocuments({ createdAt: { $gte: debutJour } }),
    User.countDocuments({ createdAt: { $gte: ilYa7j } }),
    User.countDocuments({ lastLoginAt: { $gte: ilYa7j } }),
    User.countDocuments({ $or: [{ lastLoginAt: null }, { lastLoginAt: { $exists: false } }] }),
    PageView.countDocuments({}),
    PageView.distinct("visitorId"),
    Client.distinct("email"),
    Client.distinct("email", { createdAt: { $gte: debutJour } }),
    User.distinct("email", { accountIntent: "client" }),
    User.distinct("email", { accountIntent: "client", createdAt: { $gte: debutJour } }),
    PageView.aggregate([
      { $group: { _id: { $ifNull: ["$source", "direct"] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
    Company.countDocuments({}),
  ]);

  // Provenance des INSCRITS (≠ provenance des vues) : c'est la seule mesure
  // qui relie une campagne à un compte réellement créé. `campaign` est ajouté
  // à la clé quand il existe, pour comparer deux campagnes d'une même source.
  const inscritsParSource = await User.aggregate([
    { $match: { "acquisition.source": { $nin: [null, ""] } } },
    {
      $group: {
        _id: {
          $cond: [
            { $in: [{ $ifNull: ["$acquisition.campaign", ""] }, ["", null]] },
            "$acquisition.source",
            { $concat: ["$acquisition.source", " · ", "$acquisition.campaign"] },
          ],
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 8 },
  ]);
  // Comptes créés avant le suivi (ou via l'app mobile) : à afficher tel quel
  // plutôt que de les faire passer pour du "direct", ce qui serait faux.
  const inscritsSansSource = await User.countDocuments({
    $or: [{ "acquisition.source": { $exists: false } }, { "acquisition.source": "" }],
  });

  const triee = trierComptes(liste, filtres.tri);
  const pages = Math.max(1, Math.ceil(triee.length / COMPTES_PAR_PAGE));
  const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);
  const users = triee.slice((page - 1) * COMPTES_PAR_PAGE, page * COMPTES_PAR_PAGE);

  res.render("superadmin/users", {
    saPage: "users",
    users,
    filtres,
    resultats: triee.length,
    page,
    pages,
    parPage: COMPTES_PAR_PAGE,
    kpis: {
      total: totalComptes,
      actifs: totalComptes - disabledCount,
      desactives: disabledCount,
      aujourdhui: adminsToday,
      inscrits7j,
      connectes7j,
      jamaisConnectes,
      etablissements: totalEtablissements,
    },
    trafic: {
      totalViews,
      uniqueViews: uniqueVisitors.length,
      totalClients: compterPersonnesDistinctes(emailsLegacy, emailsUnifies),
      clientsToday: compterPersonnesDistinctes(emailsLegacyToday, emailsUnifiesToday),
      topSources,
      inscritsParSource,
      inscritsSansSource,
    },
    // Compat : d'anciens gabarits lisent encore ces variables à plat.
    search: filtres.search,
    ilYa30j,
  });
};

// Fiche détaillée d'un compte, chargée à la volée par le panneau latéral.
exports.userDetails = async (req, res) => {
  try {
    const u = await User.findById(req.params.userId)
      .select("fullName email phone isPremium manualPremium manualPremiumExpiry subscription createdAt isDisabled lastLoginAt googleId twoFactorEnabled")
      .lean();
    if (!u) return res.status(404).json({ error: "Compte introuvable." });

    const companies = await Company.find({ owner: u._id }).select("name slug isPaused createdAt").lean();
    const ids = companies.map((c) => c._id);
    // Même correctif qu'establishmentDetails : les clients se déduisent des
    // emails distincts sur les réservations, pas d'un `company` inexistant
    // sur le schéma Client (le compte affichait donc toujours 0 client).
    const [emailsClients, reservations, connexions, dernieresActions] = await Promise.all([
      ids.length ? Booking.distinct("email", { company: { $in: ids }, email: { $nin: [null, ""] } }) : [],
      ids.length ? Booking.countDocuments({ company: { $in: ids } }) : 0,
      LoginEvent.countDocuments({ user: u._id }),
      ids.length
        ? require("../db/models/activityLog.model")
            .find({ company: { $in: ids } })
            .sort("-createdAt")
            .limit(6)
            .select("description createdAt")
            .lean()
        : [],
    ]);
    const clients = new Set(emailsClients.map((e) => String(e).toLowerCase().trim())).size;

    res.json({
      success: true,
      user: {
        id: String(u._id),
        fullName: u.fullName || "",
        email: u.email,
        phone: u.phone || "",
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt || null,
        isDisabled: !!u.isDisabled,
        google: !!u.googleId,
        twoFactor: !!u.twoFactorEnabled,
        manualPremium: !!u.manualPremium,
        manualPremiumExpiry: u.manualPremiumExpiry || null,
        subscriptionStatus: u.subscription?.status || "inactive",
        ...planDuCompte(u),
      },
      establishments: companies.map((c) => ({
        id: String(c._id),
        name: c.name || "",
        slug: c.slug || "",
        isPaused: !!c.isPaused,
        createdAt: c.createdAt,
      })),
      stats: { clients, reservations, connexions },
      activite: dernieresActions,
    });
  } catch (err) {
    console.error("userDetails error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// Export CSV de la sélection courante (mêmes filtres que la page).
exports.usersExport = async (req, res) => {
  try {
    const liste = trierComptes(
      await chargerComptes({
        search: req.query.search || "",
        statut: req.query.statut || "tous",
        plan: req.query.plan || "tous",
        estab: req.query.estab || "tous",
      }),
      req.query.tri || "recent",
    );

    const echapper = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lignes = [
      ["Nom", "Email", "Téléphone", "Plan", "Statut", "Établissements", "Inscrit le", "Dernière connexion"].join(";"),
    ];
    liste.forEach((u) => {
      lignes.push([
        echapper(u.fullName || ""),
        echapper(u.email),
        echapper(u.phone || ""),
        echapper(u.planLabel),
        echapper(u.isDisabled ? "Désactivé" : "Actif"),
        echapper(u.establishments.map((e) => e.name || e.slug).join(", ")),
        echapper(u.createdAt ? new Date(u.createdAt).toLocaleDateString("fr-FR") : ""),
        echapper(u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString("fr-FR") : "jamais"),
      ].join(";"));
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="branshee-utilisateurs.csv"');
    // BOM : sans lui Excel lit le fichier en ANSI et casse les accents.
    res.send("﻿" + lignes.join("\r\n"));
  } catch (err) {
    console.error("usersExport error:", err);
    res.status(500).send("Erreur serveur.");
  }
};

exports.toggleManualPremium = async (req, res) => {
  try {
    const { userId } = req.params;
    const { manualPremium } = req.body;
    const val = !!manualPremium;
    const maj = { manualPremium: val, isPremium: val };
    // On remet l'échéance à zéro en ACCORDANT (nouvel octroi, dont la date
    // reste à fixer), jamais en retirant : la date passée est la trace qui
    // empêche ce compte de réclamer un deuxième mois offert
    // (cf. utils/freeTrial.js).
    if (val) maj.manualPremiumExpiry = null;
    await User.findByIdAndUpdate(userId, maj);
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
      "subscription.plan": isFree ? "basic" : plan,
      "subscription.status": isFree ? "inactive" : "active",
    };
    // Même règle qu'au toggle : on efface l'échéance en passant à un plan
    // payant (nouvel octroi), pas en redescendant en gratuit — sinon on
    // rendrait le compte éligible au mois offert qu'il a déjà consommé.
    if (!isFree) update.manualPremiumExpiry = null;

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

// Calcule la date d'expiration d'un octroi manuel depuis une durée choisie.
// Renvoie : null = infini · Date = expiration · undefined = valeur invalide.
//
// `duration` accepte :
//   "infinite"            → aucune expiration
//   "<n>h" / "<n>d" / "<n>mo" → 1 heure, 3 jours, 2 mois… (presets de la modale)
//   "custom"              → customValue + customUnit (h|d|mo). `customDays`
//                           reste accepté pour l'ancien format (unité = jours).
//   "date"                → expiryAt, une date/heure précise choisie à la main
const MAX_GRANT_MS = 3650 * 86400000; // 10 ans, garde-fou

function addUnit(base, value, unit) {
  const d = new Date(base);
  if (unit === "h") d.setHours(d.getHours() + value);
  else if (unit === "mo") d.setMonth(d.getMonth() + value);
  else d.setDate(d.getDate() + value);
  return d;
}

function computeTrialExpiry(duration, customDays, extra) {
  const opts = extra || {};
  if (!duration || duration === "infinite") return null;
  const now = Date.now();

  // Date d'expiration choisie explicitement.
  if (duration === "date") {
    const d = new Date(opts.expiryAt);
    if (Number.isNaN(d.getTime())) return undefined;
    if (d.getTime() <= now) return undefined; // une date passée n'a pas de sens
    if (d.getTime() > now + MAX_GRANT_MS) return undefined;
    return d;
  }

  let value;
  let unit;
  if (duration === "custom") {
    value = Number(opts.customValue != null ? opts.customValue : customDays);
    unit = ["h", "d", "mo"].includes(opts.customUnit) ? opts.customUnit : "d";
  } else {
    const m = /^(\d{1,4})(h|d|mo)$/.exec(String(duration));
    if (!m) return undefined;
    value = Number(m[1]);
    unit = m[2];
  }
  if (!Number.isFinite(value) || value <= 0) return undefined;
  value = Math.round(value);

  const d = addUnit(now, value, unit);
  if (d.getTime() <= now || d.getTime() > now + MAX_GRANT_MS) return undefined;
  return d;
}

// ── Gestion plan par établissement ──────────────────────────────────────────
// Le plan vit sur le User (owner). Changer le plan d'un établissement =
// changer le plan de son propriétaire (qui peut posséder plusieurs établissements,
// mais le plan s'applique à toute l'activité du compte).
exports.setPlanForCompany = async (req, res) => {
  try {
    const company = await Company.findById(req.params.companyId).select("owner grantExpiry").lean();
    if (!company) return res.status(404).json({ error: "Établissement introuvable." });

    const { plan } = req.body; // "free" | "essentiel" | "pro" | "business"
    const validPlans = ["free", "essentiel", "pro", "business"];
    if (!validPlans.includes(plan)) return res.status(400).json({ error: "Plan invalide." });

    // "infinite" | "1h" | "7d" | "3mo"… | "custom" | "date" | undefined
    const { duration, customDays, customValue, customUnit, expiryAt } = req.body;
    const isFree = plan === "free";

    // Le forfait s'écrit sur L'ÉTABLISSEMENT, jamais sur le compte.
    // Il était posé sur le propriétaire : accorder « Business 3 jours » à un
    // établissement l'accordait à TOUS ceux du même patron. C'est précisément
    // ce que la facturation par établissement doit empêcher.
    const update = {
      plan: isFree ? "basic" : plan,
      planStatus: "active",
    };
    if (isFree) {
      // Retour au gratuit : plus d'échéance à surveiller.
      update.grantExpiry = null;
    } else if (duration !== undefined) {
      const expiry = computeTrialExpiry(duration, customDays, { customValue, customUnit, expiryAt });
      if (expiry === undefined) {
        return res.status(400).json({ error: "Durée invalide : choisissez une échéance future, au plus 10 ans." });
      }
      update.grantExpiry = expiry; // null = illimité, ou Date
    }
    // Plan payant SANS durée fournie → on préserve l'échéance déjà en place
    // plutôt que de la remettre à « illimité » sans qu'on l'ait demandé.

    await Company.findByIdAndUpdate(company._id, update);

    // Les quotas (services, employés…) se comptent par établissement : le 3e
    // argument est INDISPENSABLE. Sans lui, enforcePlanLimits retombe sur
    // l'établissement PRINCIPAL du compte — passer le second en gratuit
    // désactiverait alors les services du premier.
    const { enforcePlanLimits } = require("./account.controller");
    enforcePlanLimits(String(company.owner), isFree ? "basic" : plan, company._id).catch(() => {});

    const fresh = await Company.findById(company._id).select("grantExpiry").lean();
    res.json({ success: true, plan, expiry: fresh ? fresh.grantExpiry : null });
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
    // Même grammaire de durées que l'octroi par établissement (heures, jours,
    // mois, date précise) — un seul calcul pour les deux écrans.
    const { duration, customDays, customValue, customUnit, expiryAt } = req.body;
    if (!duration) return res.status(400).json({ error: "Durée manquante." });
    const expiry = computeTrialExpiry(duration, customDays, { customValue, customUnit, expiryAt });
    if (expiry === undefined) {
      return res.status(400).json({ error: "Durée invalide : choisissez une échéance future, au plus 10 ans." });
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
  res.render("superadmin/promo-codes", { saPage: "promo", codes });
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

  res.render("superadmin/referrals", { saPage: "referrals", users: referrersWithFilleuls });
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

  // Chiffres clés du flux : calculés en base, pas sur la tranche affichée.
  const il24h = new Date(Date.now() - 24 * 3600 * 1000);
  const il7j = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [inscrits7j, rdv7j, connexions24h, encaisse7j] = await Promise.all([
    User.countDocuments({ createdAt: { $gte: il7j } }),
    Booking.countDocuments({ createdAt: { $gte: il7j } }),
    LoginEvent.countDocuments({ createdAt: { $gte: il24h } }),
    Booking.aggregate([
      { $match: { "payment.status": "paid", "payment.paidAt": { $gte: il7j } } },
      { $group: { _id: null, total: { $sum: "$payment.amount" } } },
    ]),
  ]);

  res.render("superadmin/logs", {
    saPage: "logs",
    events: events.slice(0, 400),
    kpis: {
      evenements: events.length,
      inscrits7j,
      rdv7j,
      connexions24h,
      encaisse7j: encaisse7j[0]?.total || 0,
    },
  });
};

// ── Boost (mise en avant homepage) ───────────────────────────────────────────

exports.boostPage = async (req, res) => {
  // name/photo/businessType de l'ÉTABLISSEMENT : sans eux, deux
  // établissements d'un même patron étaient indiscernables dans la liste.
  const companies = await Company.find({})
    .select("_id slug boostPosition owner name photo businessType location")
    .populate("owner", "company fullName businessName businessType location profilePicture businessPicture")
    .sort({ boostPosition: -1, name: 1 })
    .lean();
  // Ville de l'ÉTABLISSEMENT : lue sur le compte, elle affichait la ville du
  // premier établissement du patron sur toutes ses autres lignes.
  companies.forEach((c) => {
    const loc = identityFor(c, c.owner).location;
    c.ville = (loc && typeof loc === "object" && loc.city) || "";
  });
  res.render("superadmin/boost", { saPage: "boost", companies });
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
  res.render("superadmin/access-links", { saPage: "links", links });
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

  res.render("superadmin/features", { saPage: "features", features, smsNotificationsEnabled, adminFeatures, navSections });
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
  res.render("superadmin/messages", { saPage: "messages", messages, totalUsers, userList });
};

// Envoi d'un message ciblé (recipientId), à une sélection (recipientIds) ou
// en diffusion (broadcast=true).
exports.sendMessage = async (req, res) => {
  try {
    const mongoose = require("mongoose");
    const { recipientId, recipientIds, broadcast, title, body, type, ctaLabel, ctaUrl } = req.body;

    const cleanTitle = (title || "").toString().trim();
    const cleanBody = (body || "").toString().trim();
    if (!cleanTitle || !cleanBody) {
      return res.status(400).json({ error: "Titre et message requis." });
    }
    const msgType = MSG_TYPES.includes(type) ? type : "info";
    const isBroadcast = broadcast === true || broadcast === "true" || broadcast === "1";
    const isMulti = !isBroadcast && Array.isArray(recipientIds) && recipientIds.length > 0;

    const base = {
      broadcast: isBroadcast,
      title: cleanTitle.slice(0, 140),
      body: cleanBody.slice(0, 4000),
      type: msgType,
      ctaLabel: (ctaLabel || "").toString().trim().slice(0, 60),
      ctaUrl: (ctaUrl || "").toString().trim().slice(0, 500),
    };

    let created;
    if (isBroadcast) {
      created = [await AdminMessage.create({ ...base, recipient: null })];
    } else if (isMulti) {
      // Un document par destinataire — même modèle que l'envoi ciblé unique,
      // pour ne rien changer à la lecture côté pro (getMyMessages matche
      // `recipient: uid`, que le message vienne d'un envoi seul ou groupé).
      const validIds = [...new Set(recipientIds)]
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .slice(0, 500); // filet de sécurité, la liste vient de la page superadmin (~qqes dizaines)
      const users = await User.find({ _id: { $in: validIds } }).select("_id").lean();
      if (!users.length) return res.status(404).json({ error: "Aucun destinataire valide sélectionné." });
      created = await AdminMessage.insertMany(users.map((u) => ({ ...base, recipient: u._id })));
    } else {
      let user = null;
      if (recipientId) {
        user = await User.findById(recipientId).select("_id").lean();
      } else if (req.body.recipientEmail) {
        const email = String(req.body.recipientEmail).trim().toLowerCase();
        user = await User.findOne({ email }).select("_id").lean();
      }
      if (!user) return res.status(404).json({ error: "Destinataire introuvable (vérifiez l'email)." });
      created = [await AdminMessage.create({ ...base, recipient: user._id })];
    }
    const msg = created[0];

    // Notification temps réel : on émet globalement, chaque client recharge
    // SES propres messages via /api/my-messages (scopé par req.user). Évite de
    // dépendre du nom exact de la room par utilisateur.
    try {
      const io = req.app.get("io");
      if (io) io.emit("adminMessage:new");
    } catch (_) {}

    res.json({ success: true, id: msg._id, count: created.length });
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

/* ═══════════════════════════════════════════════════════════════════════════
   Signalements d'avis
   Personne — pas même le professionnel concerné — ne peut supprimer un avis :
   sinon il suffirait de signaler ses mauvaises notes pour les faire tomber.
   Tout passe par une décision prise ici.
   ═══════════════════════════════════════════════════════════════════════════ */

const MOTIFS_LABELS = {
  insulting: "Propos insultants ou haineux",
  false:     "Faux avis / client jamais venu",
  spam:      "Spam ou publicité",
  personal:  "Données personnelles divulguées",
  other:     "Autre",
};

exports.reviewReportsPage = async (req, res) => {
  const filtre = ["pending", "accepted", "rejected"].includes(req.query.statut)
    ? req.query.statut
    : "pending";

  const [reports, compteurs] = await Promise.all([
    ReviewReport.find({ status: filtre })
      .populate({ path: "company", select: "name slug owner", populate: { path: "owner", select: "fullName email" } })
      .sort("-createdAt")
      .limit(300)
      .lean(),
    ReviewReport.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
  ]);

  // Un même avis peut être signalé par plusieurs personnes : on regroupe pour
  // que la décision se prenne une fois, pas dix.
  const parAvis = new Map();
  reports.forEach((r) => {
    const cle = String(r.review);
    if (!parAvis.has(cle)) parAvis.set(cle, { ...r, autres: [] });
    else parAvis.get(cle).autres.push(r);
  });

  const stats = { pending: 0, accepted: 0, rejected: 0 };
  compteurs.forEach((c) => { stats[c._id] = c.n; });
  stats.traites7j = await ReviewReport.countDocuments({
    status: { $ne: "pending" },
    decidedAt: { $gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
  });

  // File d'attente triée par urgence : une demande du pro et les avis signalés
  // plusieurs fois passent devant, le reste reste antéchronologique.
  const groupes = Array.from(parAvis.values());
  if (filtre === "pending") {
    const urgence = (g) => (g.reporterKind === "owner" ? 10 : 0) + g.autres.length;
    groupes.sort((a, b) => urgence(b) - urgence(a) || new Date(b.createdAt) - new Date(a.createdAt));
  }

  res.render("superadmin/review-reports", {
    saPage: "reports",
    groupes,
    filtre,
    stats,
    motifs: MOTIFS_LABELS,
  });
};

// Compteur pour la pastille de la barre de navigation.
exports.reviewReportsCount = async (req, res) => {
  const n = await ReviewReport.countDocuments({ status: "pending" });
  res.json({ pending: n });
};

// Décision : « accepted » supprime l'avis, « rejected » le conserve.
// Dans les deux cas TOUS les signalements portant sur cet avis sont clos, sans
// quoi le même avis reviendrait indéfiniment dans la file.
exports.decideReviewReport = async (req, res) => {
  try {
    const { decision, note } = req.body;
    if (!["accepted", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "Décision invalide." });
    }

    const report = await ReviewReport.findById(req.params.id).lean();
    if (!report) return res.status(404).json({ error: "Signalement introuvable." });

    if (decision === "accepted") {
      await Review.deleteOne({ _id: report.review });
    }

    await ReviewReport.updateMany(
      { review: report.review, status: "pending" },
      {
        $set: {
          status: decision,
          decidedAt: new Date(),
          decisionNote: (note || "").toString().trim().slice(0, 500),
        },
      },
    );

    return res.json({ success: true, avisSupprime: decision === "accepted" });
  } catch (err) {
    console.error("decideReviewReport:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Modération des métiers ──────────────────────────────────────────────────
// La liste officielle est figée dans utils/services.js. Tout métier saisi hors
// de cette liste s'affiche en orange côté pro (« pas encore reconnu ») et la
// demande d'ajout ne partait qu'en email : rien n'était modérable.
//
// Cette page réunit les deux sources :
//   1. les DEMANDES explicites des pros (mises en avant, ce sont des gens qui
//      attendent une réponse) ;
//   2. tous les métiers effectivement UTILISÉS par des établissements et
//      absents de la liste officielle — même ceux dont personne n'a demandé
//      l'ajout. Ce sont eux qui apparaissent en orange sur le site.
exports.jobTitlesPage = async (req, res) => {
  const JobTitle = require("../db/models/jobTitle.model");
  const getServices = require("../utils/services");

  // Liste officielle (figée + déjà approuvés), en clés normalisées.
  const officiels = new Set(getServices("fr").map((s) => JobTitle.toKey(s)));

  // Métiers réellement portés par des établissements, avec leur nombre d'usages.
  const usages = await Company.aggregate([
    { $match: { isDeleted: { $ne: true }, businessType: { $nin: [null, ""] } } },
    { $group: { _id: "$businessType", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);

  const decisions = await JobTitle.find({}).lean();
  const parCle = new Map(decisions.map((d) => [d.key, d]));

  // Un métier « orange » = utilisé mais hors liste officielle.
  const oranges = [];
  for (const u of usages) {
    const key = JobTitle.toKey(u._id);
    if (officiels.has(key)) continue; // déjà reconnu → rien à trancher
    const d = parCle.get(key);
    oranges.push({
      name: u._id,
      key,
      count: u.n,
      status: d ? d.status : "pending",
      source: d ? d.source : "usage",
      requestedByEmail: d ? d.requestedByEmail : "",
      decidedAt: d ? d.decidedAt : null,
    });
  }

  // Les demandes explicites encore en attente passent devant : quelqu'un
  // attend une réponse. Les métiers seulement constatés suivent, par usage.
  const demandes = decisions
    .filter((d) => d.status === "pending" && d.source === "request")
    .map((d) => {
      const u = usages.find((x) => JobTitle.toKey(x._id) === d.key);
      return { ...d, count: u ? u.n : 0 };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  res.render("superadmin/job-titles", {
    saPage: "jobTitles",
    demandes,
    oranges,
    nbApprouves: decisions.filter((d) => d.status === "approved").length,
    nbBloques: decisions.filter((d) => d.status === "blocked").length,
  });
};

// Trancher : approuver (rejoint la liste officielle), bloquer, ou remettre en
// attente. `upsert` car un métier seulement CONSTATÉ n'a pas encore de ligne.
exports.decideJobTitle = async (req, res) => {
  try {
    const { name, status } = req.body;
    if (!name || !["approved", "blocked", "pending"].includes(status)) {
      return res.status(400).json({ error: "Requête invalide." });
    }
    const JobTitle = require("../db/models/jobTitle.model");
    const key = JobTitle.toKey(name);

    await JobTitle.updateOne(
      { key },
      {
        $set: {
          status,
          decidedAt: new Date(),
          decidedBy: (req.session && req.session.superadmin) || "superadmin",
        },
        $setOnInsert: { name: String(name).trim(), key, source: "usage" },
      },
      { upsert: true }
    );

    // Le cache mémoire alimente getServices() : sans ce rafraîchissement, un
    // métier approuvé resterait orange jusqu'au prochain redémarrage.
    await require("../utils/services").refreshApprovedJobTitles();

    return res.json({ success: true });
  } catch (err) {
    console.error("decideJobTitle error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};
