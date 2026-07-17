const Client = require("../db/models/client.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const Company = require("../db/models/company/company.model");

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
  // A-t-il accès à un établissement (le sien, ou rejoint et accepté) ? Sert
  // de base à "Gérer mon établissement" vs "Commencer mon établissement"
  // dans la topbar (views/common/topbar.pug) et la sidebar espace client
  // (views/layouts/client.pug) — calculé une fois ici plutôt que dupliqué
  // partout (cf. middlewares/injectCompany.js, même logique côté admin).
  res.locals.hasEstablishment = false;

  // Compte unifié (cf. plan d'unification) : un User connecté — pro ou non —
  // est aussi son propre "client" pour réserver chez d'autres établissements.
  // Priorité à req.user ; on ne retombe sur l'ancien compte Client séparé
  // (req.session.clientId) que tant que tous les comptes n'ont pas été
  // fusionnés (cf. scripts/migrate-merge-client-into-user.js).
  if (req.user) {
    const parts = (req.user.fullName || "").trim().split(" ");
    res.locals.clientUser = {
      firstName: parts[0] || "",
      lastName: parts.slice(1).join(" ") || "",
      email: req.user.email || "",
      phone: req.user.phone || "",
    };
    res.locals.clientSession = {
      _id: String(req.user._id),
      fullName: req.user.fullName || "",
      profilePicture: req.user.profilePicture || "/images/no-user.webp",
    };
    try {
      if (req.user.company) {
        // Le champ `company` sur le User n'est qu'une référence — il peut
        // rester renseigné alors que l'établissement n'a jamais été créé
        // (échec pendant l'inscription) ou a été supprimé (isDeleted) depuis.
        // Sans cette vérification, "hasEstablishment" mentait à la topbar
        // ("Gérer mon établissement" affiché + lien vers /appointment, qui
        // ne trouve alors aucun établissement réel et boucle sans jamais
        // aboutir nulle part pour l'utilisateur).
        const exists = await Company.exists({ _id: req.user.company, isDeleted: { $ne: true } });
        res.locals.hasEstablishment = !!exists;
      }
      if (!res.locals.hasEstablishment) {
        const accepted = await CompanyMembership.exists({ user: req.user._id, status: "accepted" });
        res.locals.hasEstablishment = !!accepted;
      }
    } catch (_) {
      // best-effort — ne bloque jamais la page
    }
    return next();
  }

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
