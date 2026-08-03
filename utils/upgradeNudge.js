const { getPlan, getLimit } = require("./planLimits");

/**
 * Choisit l'incitation à passer au plan payant la plus pertinente pour un
 * établissement gratuit.
 *
 * Le parti pris : ne jamais afficher un argument générique. Un pro qui n'a
 * jamais approché le plafond mensuel se moque qu'on lui parle du plafond
 * mensuel — et un encart qu'on ignore devient un encart qu'on ne voit plus.
 * On ne montre donc QUE ce qui le gêne vraiment, maintenant, et dans l'ordre
 * où ça le gêne : d'abord ce qui le bloque, ensuite ce qui lui coûte de
 * l'argent sans qu'il s'en rende compte.
 *
 * Volontairement SYNCHRONE et sans accès base : injectCompany compte déjà les
 * rendez-vous du mois, on réutilise ce chiffre au lieu d'ajouter une requête
 * sur chaque page admin. Rend la fonction testable sans base, aussi.
 */

// L'ordre du tableau EST la priorité : le premier motif applicable gagne.
function motifsPossibles({ rdvCeMois, plafondRdv }) {
  const restants = plafondRdv - rdvCeMois;
  return [
    {
      cle: "quota-atteint",
      actif: rdvCeMois >= plafondRdv,
      ton: "bloquant",
      icone: "block",
      titre: "Vos clients ne peuvent plus réserver ce mois-ci",
      texte: `Vous avez atteint les ${plafondRdv} rendez-vous du plan gratuit. Les réservations en ligne sont refusées jusqu'au 1er du mois prochain.`,
      action: "Débloquer les réservations",
    },
    {
      cle: "quota-proche",
      actif: restants > 0 && restants <= 5,
      ton: "urgent",
      icone: "hourglass_bottom",
      titre: restants === 1 ? "Plus qu'un rendez-vous ce mois-ci" : `Plus que ${restants} rendez-vous ce mois-ci`,
      texte: `Le plan gratuit s'arrête à ${plafondRdv} réservations par mois. Au-delà, vos clients ne pourront plus réserver en ligne.`,
      action: "Passer en illimité",
    },
    {
      cle: "rappels",
      actif: rdvCeMois >= 5,
      ton: "normal",
      icone: "notifications_active",
      titre: "Vos clients ne reçoivent aucun rappel",
      texte: `Un rappel la veille supprime la plupart des oublis. Sur vos ${rdvCeMois} rendez-vous du mois, c'est autant d'heures qui ne partent pas en fumée.`,
      action: "Activer les rappels",
    },
    {
      cle: "decouverte",
      actif: true, // repli, d'où sa place en dernier
      ton: "normal",
      icone: "auto_awesome",
      titre: "Réservations illimitées dès 9 €/mois",
      texte: `Le plan gratuit plafonne à ${plafondRdv} rendez-vous par mois et n'envoie aucun rappel à vos clients.`,
      action: "Voir les plans",
    },
  ];
}

/**
 * @param {object} billingUser   porteur du forfait (cf. billingUserFor)
 * @param {object} etat          { rdvCeMois, plafondRdv } déjà calculés
 * @returns {object|null}        null pour tout plan payant
 */
function computeUpgradeNudge(billingUser, etat = {}) {
  if (!billingUser) return null;
  if (getPlan(billingUser) !== "basic") return null; // payant : rien à vendre

  // Un plafond FOURNI fait foi, y compris Infinity : si l'appelant nous dit
  // qu'il n'y a pas de limite, inventer « 20 » afficherait un argument faux.
  // On ne retombe sur le plan que si rien n'a été transmis.
  const plafondRdv = etat.plafondRdv === undefined
    ? getLimit("monthlyBookings", billingUser)
    : etat.plafondRdv;
  if (!Number.isFinite(plafondRdv)) return null; // illimité : rien à vendre

  const rdvCeMois = Number.isFinite(etat.rdvCeMois) ? etat.rdvCeMois : 0;

  const motif = motifsPossibles({ rdvCeMois, plafondRdv }).find((m) => m.actif);
  return motif ? { ...motif, rdvCeMois, plafondRdv } : null;
}

module.exports = { computeUpgradeNudge };
