const Company = require("../db/models/company/company.model");

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

    next();
  } catch (err) {
    console.error("Erreur injectCompany:", err);
    res.status(500).send("Erreur interne du serveur");
  }
};
