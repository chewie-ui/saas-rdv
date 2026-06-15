const Company = require("../db/models/company/company.model");
const Booking = require("../db/models/book.model");
const { getLimit } = require("../utils/planLimits");
const { getAdminFeaturesFlags } = require("./featureFlag");

module.exports = async (req, res, next) => {
  try {
    // 1. Sécurité : Si l'utilisateur n'est pas connecté, on ne fait rien
    // (Ce middleware doit normalement passer APRES isAuth)
    if (!req.user) {
      return next();
    }

    // 2. On cherche la company dont l'owner est l'id de l'user connecté
    // .lean() permet de récupérer un objet JS simple (plus rapide)
    const currentCompany = await Company.findOne({
      owner: req.user._id,
    }).lean();

    // 3. Si l'utilisateur est un "Pro" mais n'a pas encore de profil Company
    if (!currentCompany && req.user.role === "admin") {
      // On évite de rediriger si on est déjà sur la page de création
      if (req.path === "/register") return next();
      return res.redirect("/register");
    }

    // 4. On injecte dans res.locals
    // Ces variables seront accessibles direct dans tes fichiers .pug
    res.locals.currentCompany = currentCompany;
    res.locals.user = req.user;

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
    if (currentCompany && req.user.role === "admin") {
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
