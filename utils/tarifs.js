/**
 * Tarifs des forfaits, en euros par mois.
 *
 * Ils n'existaient jusqu'ici que dans les gabarits de la page d'abonnement et
 * dans les identifiants de prix Stripe. Les rassembler ici donne une source
 * unique, exploitable côté serveur — en particulier par l'export CRM, qui doit
 * chiffrer le revenu récurrent.
 *
 * ⚠ À tenir à jour avec les prix réels de Stripe : ce module ne les lit pas,
 * il les déclare. En cas de doute, Stripe fait foi.
 */

/** Prix affichés sur /subscription (mensuel, et mensuel en engagement annuel). */
const FORFAITS = {
  basic: { libelle: "Gratuit", mensuel: 0, annuelParMois: 0 },
  essentiel: { libelle: "Essentiel", mensuel: 9, annuelParMois: 7 },
  pro: { libelle: "Pro", mensuel: 19, annuelParMois: 15 },
  business: { libelle: "Business", mensuel: 49, annuelParMois: 39 },
  // Ancien nom encore présent dans l'énumération des abonnements.
  premium: { libelle: "Premium", mensuel: 19, annuelParMois: 15 },
};

/** Suppléments récurrents facturés en plus du forfait. */
const ADDONS = {
  customUrl: { libelle: "URL personnalisée", mensuel: 5 },
  collaborateur: { libelle: "Siège collaborateur", mensuel: 10 },
};

const estPayant = (plan) => !!FORFAITS[plan] && FORFAITS[plan].mensuel > 0;

/** Prix mensuel d'un forfait. `annuel` = engagement annuel (prix réduit). */
function prixMensuel(plan, annuel = false) {
  const f = FORFAITS[plan];
  if (!f) return 0;
  return annuel ? f.annuelParMois : f.mensuel;
}

/**
 * Revenu mensuel d'un établissement, add-ons compris.
 * Un accès offert par le superadmin rapporte 0 : le forfait est actif, mais
 * personne ne paie — le compter fausserait le MRR.
 */
function revenuMensuel({ plan, offert = false, addons = {} } = {}) {
  if (offert || !estPayant(plan)) return 0;
  let total = prixMensuel(plan);
  if (addons.customUrl) total += ADDONS.customUrl.mensuel;
  if (addons.extraCollaboratorSeats) total += addons.extraCollaboratorSeats * ADDONS.collaborateur.mensuel;
  return total;
}

module.exports = { FORFAITS, ADDONS, prixMensuel, revenuMensuel, estPayant };
