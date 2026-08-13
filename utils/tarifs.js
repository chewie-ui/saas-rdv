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

/**
 * Prix affichés sur /subscription (mensuel, et mensuel en engagement annuel).
 *
 * `libelle` est le nom COMMERCIAL, `cle` reste la valeur stockée en base. Les
 * deux ont été séparés pour renommer l'offre sans migration : « Business »
 * devient « Pro+ » à l'écran alors que tout le code continue de manipuler
 * `business`. Renommer la clé aurait demandé de reprendre les abonnements
 * Stripe, les limites de forfait et les données existantes — pour un simple
 * changement de vitrine.
 *
 * `visible` : présenté ou non sur la page des plans. L'Essentiel n'est plus
 * proposé, mais reste défini — des comptes y sont encore abonnés et leur
 * forfait doit continuer de s'afficher correctement partout ailleurs.
 *
 * ⚠ Les montants doivent correspondre aux prix Stripe. Vérifiable à tout
 * moment : `node scripts/check-stripe-prices.js` sur le VPS.
 */
const FORFAITS = {
  basic: { libelle: "Amateur", mensuel: 0, annuelParMois: 0, visible: true },
  essentiel: { libelle: "Essentiel", mensuel: 9, annuelParMois: 7, visible: false },
  pro: { libelle: "Pro", mensuel: 19, annuelParMois: 15, visible: true },
  business: { libelle: "Pro+", mensuel: 49, annuelParMois: 39, visible: true },
  // Ancien nom encore présent dans l'énumération des abonnements.
  premium: { libelle: "Pro", mensuel: 19, annuelParMois: 15, visible: false },
};

/** Nom commercial d'un forfait, pour l'affichage. */
function libelle(plan) {
  return (FORFAITS[plan] && FORFAITS[plan].libelle) || "Amateur";
}

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

/** Forfaits proposés à la vente, dans l'ordre d'affichage. */
function forfaitsVisibles() {
  return ["basic", "pro", "business"].filter((k) => FORFAITS[k] && FORFAITS[k].visible);
}

module.exports = { FORFAITS, ADDONS, prixMensuel, revenuMensuel, estPayant, libelle, forfaitsVisibles };
