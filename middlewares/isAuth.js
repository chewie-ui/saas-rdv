/**
 * Session obligatoire.
 *
 * La redirection vers /login convient à une navigation (le visiteur voit la
 * page de connexion), mais pas à un appel `fetch` : le front recevait le HTML
 * de /login là où il attendait du JSON, et `res.json()` échouait sur une
 * erreur de parsing incompréhensible pour le pro (« Erreur réseau » alors que
 * sa session avait simplement expiré).
 *
 * On répond donc selon ce que le client demande : 401 JSON pour un appel
 * programmatique, redirection pour une vraie navigation. La distinction se
 * fait sur les en-têtes, pas sur la méthode HTTP : /account/update-password
 * est un VRAI formulaire HTML en POST (views/templates/change-password.pug),
 * il doit continuer à rediriger.
 */
function veutDuJson(req) {
  // Envoyé par notre front sur tous les fetch à corps JSON.
  if (req.is("application/json")) return true;
  // XMLHttpRequest historique, et en-tête que l'on pose explicitement sur les
  // envois multipart (photos), qui n'ont pas de Content-Type exploitable.
  if (req.xhr || req.get("X-Requested-With") === "XMLHttpRequest") return true;
  const accept = req.get("accept") || "";
  // « Accept: application/json » sans text/html = appel programmatique.
  return accept.includes("application/json") && !accept.includes("text/html");
}

module.exports = (req, res, next) => {
  if (req.isAuthenticated()) return next();

  if (veutDuJson(req)) {
    return res.status(401).json({
      success: false,
      error: "not_authenticated",
      message: "Votre session a expiré. Reconnectez-vous pour continuer.",
    });
  }

  res.redirect("/login");
};
