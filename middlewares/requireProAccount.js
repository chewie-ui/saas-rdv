/**
 * Accès au parcours « créer mon établissement » (/demarrer).
 *
 * `isAuth` exige un `User`. Un compte **Client** legacy connecté n'en est pas
 * un : il était donc traité comme un visiteur anonyme et renvoyé vers
 * l'inscription complète, à qui on redemandait nom, email et mot de passe
 * alors qu'il avait déjà un compte (retour utilisateur : « j'ai déjà un
 * compte ?? »).
 *
 * On accepte donc aussi une session Client, en la promouvant en User au
 * passage (utils/promoteClientToUser.js) — la création d'un établissement
 * exige un User, `Company.owner` le référençant.
 */
const { promoteClientToUser } = require("../utils/promoteClientToUser");

module.exports = async (req, res, next) => {
  if (req.isAuthenticated && req.isAuthenticated()) return next();

  const clientId = req.session && req.session.clientId;
  if (!clientId) return res.redirect("/register?intent=pro");

  try {
    const r = await promoteClientToUser(clientId);

    if (r.introuvable) {
      req.session.clientId = null;
      return res.redirect("/login");
    }
    // Un compte pro existe déjà avec cet email : on ne s'y connecte JAMAIS
    // automatiquement (ce serait une prise de contrôle de compte). On demande
    // la connexion, en expliquant pourquoi.
    if (r.conflit) {
      return res.redirect("/login?motif=compte-pro-existant");
    }

    return req.login(r.user, (err) => {
      if (err) {
        console.error("[requireProAccount] login après promotion :", err);
        return res.redirect("/login");
      }
      // La session Client n'a plus lieu d'être : le Client a été supprimé au
      // profit du User. La laisser ferait cohabiter deux identités (cf.
      // routes/index.js:1233, où cette cohabitation causait déjà un bug).
      req.session.clientId = null;
      req.session.save((e) => {
        if (e) console.error("[requireProAccount] sauvegarde session :", e);
        next();
      });
    });
  } catch (err) {
    console.error("[requireProAccount] promotion échouée :", err);
    return res.redirect("/espace-client?erreur=promotion");
  }
};
