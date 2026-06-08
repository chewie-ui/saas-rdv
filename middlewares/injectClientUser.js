const Client = require("../db/models/client.model");

/**
 * Injecte les infos du client connecté (espace client) dans `res.locals`
 * pour TOUTES les pages — pas seulement celles dont le contrôleur pense à
 * les calculer manuellement.
 *
 * Avant ce middleware, `clientUser`/`clientSession` n'étaient renseignés
 * que par la route de la page de réservation publique (routes/index.js),
 * ce qui faisait que le bouton « Espace client » de la topbar
 * (views/common/topbar.pug, qui se base sur `clientUser`) restait invisible
 * sur toutes les autres pages publiques (recherche, contact, mentions
 * légales, page « devenir pro », landing pages, etc.) même quand le
 * visiteur était bel et bien connecté côté client → bug "il n'apparaît pas
 * ici" remonté dans les retours.
 *
 * Les routes qui calculent déjà leur propre `clientUser` (ex: la page de
 * réservation, qui a besoin d'un format précis pour pré-remplir le
 * formulaire) restent prioritaires : `res.render(view, locals)` fusionne
 * `res.locals` avec les locals passés explicitement, ces derniers gagnant.
 * On ne fait donc ici que poser une valeur par défaut sûre.
 */
module.exports = async function injectClientUser(req, res, next) {
  res.locals.clientUser = null;
  res.locals.clientSession = null;

  const clientId = req.session && req.session.clientId;
  if (!clientId) return next();

  try {
    const client = await Client.findById(clientId).lean();
    if (client) {
      const parts = (client.fullName || "").trim().split(" ");
      res.locals.clientUser = {
        firstName: parts[0] || "",
        lastName: parts.slice(1).join(" ") || "",
        email: client.email || "",
        phone: client.phone || "",
      };
      res.locals.clientSession = {
        _id: String(client._id),
        fullName: client.fullName || "",
        profilePicture: client.profilePicture || "/images/no-user.webp",
      };
    }
  } catch (_) {
    // Session client invalide/orpheline → on continue sans bloquer la page
  }

  return next();
};
