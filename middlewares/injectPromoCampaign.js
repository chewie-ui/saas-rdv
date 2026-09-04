/**
 * Rend la campagne promo disponible dans TOUTES les vues (`res.locals.promo`).
 *
 * Ici plutôt que dans chaque contrôleur : l'offre s'annonce sur l'accueil,
 * /tarifs, l'inscription, la landing pro et le tunnel d'abonnement. Recopier
 * le calcul dans cinq contrôleurs, c'est se garantir qu'un jour l'un d'eux
 * affichera une promo éteinte.
 *
 * Coût : une lecture Mongo toutes les 15 s (cache dans utils/promoCampaign),
 * et rien du tout sur les routes qui ne rendent pas de HTML.
 */
const { banniereCampagne } = require("../utils/promoCampaign");

module.exports = async function injectPromoCampaign(req, res, next) {
  res.locals.promo = null;

  // Inutile sur les appels programmatiques et les fichiers statiques : ils ne
  // rendent aucun gabarit, la lecture serait pure perte.
  if (req.method !== "GET") return next();
  if (req.path.startsWith("/api/") || req.path.startsWith("/webhook")) return next();
  if (/\.(css|js|png|jpe?g|webp|svg|ico|woff2?|map)$/i.test(req.path)) return next();

  try {
    res.locals.promo = await banniereCampagne();
  } catch (err) {
    // Une promo indisponible ne doit jamais empêcher une page de s'afficher.
    console.error("[injectPromoCampaign]", err.message);
  }
  return next();
};
