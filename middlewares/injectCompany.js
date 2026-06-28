const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const Booking = require("../db/models/book.model");
const { getLimit } = require("../utils/planLimits");
const { getAdminFeaturesFlags } = require("./featureFlag");
const { clientWord } = require("../utils/terminology");

module.exports = async (req, res, next) => {
  try {
    // 1. Sécurité : Si l'utilisateur n'est pas connecté, on ne fait rien
    // (Ce middleware doit normalement passer APRES isAuth)
    if (!req.user) {
      return next();
    }

    // 2. On cherche la company dont l'owner est l'id de l'user connecté
    // .lean() permet de récupérer un objet JS simple (plus rapide)
    let currentCompany = await Company.findOne({
      owner: req.user._id,
    }).lean();
    let membershipRole = currentCompany ? "owner" : null;

    // 2b. Pas propriétaire ? Peut-être membre d'un établissement qu'il a
    // rejoint (cf. plan d'unification — "rejoindre un établissement",
    // approuvé par le propriétaire) — accès complet au même titre que lui.
    if (!currentCompany) {
      const membership = await CompanyMembership.findOne({
        user: req.user._id,
        status: "accepted",
      }).lean();
      if (membership) {
        currentCompany = await Company.findById(membership.company).lean();
        membershipRole = "member";
      }
    }

    // 3. Si l'utilisateur n'a ni établissement propre ni adhésion acceptée —
    // compte "client"/"undecided" (cf. inscription unifiée), demande pour
    // rejoindre encore en attente/refusée, ou pro qui n'a pas terminé sa
    // création — pas de système de "rôles" dans ce modèle User, c'est la
    // présence d'une Company (propriétaire ou membre) qui définit l'accès.
    // On le laisse uniquement atteindre /settings (où il peut créer/voir
    // l'état de sa demande, cf. carte "Votre établissement") ou /register.
    // Les autres pages admin supposent toutes une Company existante.
    if (!currentCompany) {
      if (req.path === "/settings" || req.path === "/register") return next();
      return res.redirect("/");
    }

    // 4. On injecte dans res.locals
    // Ces variables seront accessibles direct dans tes fichiers .pug
    res.locals.currentCompany = currentCompany;
    res.locals.membershipRole = membershipRole;
    res.locals.user = req.user;

    // 4a. Vocabulaire "client" vs "patient" selon le métier (kiné, dentiste,
    // psy... → patient ; coiffeur, coach... → client) — dispo dans TOUTES
    // les pages admin sans avoir à le repasser depuis chaque contrôleur.
    res.locals.clientTerm           = clientWord(req.user.businessType);
    res.locals.clientTermPlural     = clientWord(req.user.businessType, { plural: true });
    res.locals.clientTermCap        = clientWord(req.user.businessType, { capitalize: true });
    res.locals.clientTermCapPlural  = clientWord(req.user.businessType, { capitalize: true, plural: true });

    // 4b. Fonctionnalités admin activables/désactivables depuis le superadmin
    // (ex: Cours collectifs, Temps tampon) — utilisées pour cacher des
    // sections du sidebar/pages quand désactivées (test/rollout progressif).
    res.locals.adminFeatures = await getAdminFeaturesFlags();

    // 5. Limite mensuelle de RDV (plan Starter/basic) : on calcule si elle est
    // atteinte pour pouvoir afficher une bannière persistante sur TOUTES les
    // pages admin ("vos clients ne peuvent plus réserver !").
    res.locals.monthlyLimitReached = false;
    res.locals.monthlyBookingsCount = 0;
    res.locals.monthlyBookingsLimit = Infinity;
    if (currentCompany) {
      const monthlyLimit = getLimit("monthlyBookings", req.user);
      res.locals.monthlyBookingsLimit = monthlyLimit;
      if (monthlyLimit !== Infinity) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthlyCount = await Booking.countDocuments({
          company: currentCompany._id,
          date:    { $gte: startOfMonth },
          status:  { $ne: "canceled" },
        });
        res.locals.monthlyBookingsCount = monthlyCount;
        res.locals.monthlyLimitReached = monthlyCount >= monthlyLimit;
      }
    }

    next();
  } catch (err) {
    console.error("Erreur injectCompany:", err);
    res.status(500).send("Erreur interne du serveur");
  }
};
