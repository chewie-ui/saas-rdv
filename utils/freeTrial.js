/**
 * Le mois offert : UNE SEULE FOIS par compte.
 *
 * Il était jusqu'ici accordé à chaque souscription, sans mémoire : quelqu'un
 * qui résiliait puis reprenait repartait pour 30 jours gratuits, indéfiniment.
 *
 * Rien n'est stocké : l'information est DÉDUITE de traces qui existent déjà.
 * C'est volontaire — un drapeau posé au moment du checkout serait consommé
 * même par quelqu'un qui abandonne sur la page de paiement, et lui volerait
 * son essai sans qu'il ait rien reçu.
 *
 * Un essai est considéré comme utilisé dès que le compte a DÉJÀ eu un accès
 * payant, d'où qu'il vienne :
 *   - un abonnement Stripe, en cours ou résilié ;
 *   - un octroi manuel du superadmin. C'est le point le moins évident, mais
 *     offrir 30 jours de plus à quelqu'un à qui on vient déjà d'offrir
 *     l'accès n'a aucun sens : il a déjà essayé.
 */

const TRIAL_DAYS = 30;

function aDejaEuUnAccesPayant(user) {
  if (!user) return false;

  // Octroi manuel, en cours ou passé. `manualPremiumExpiry` survit à
  // l'expiration tant que le superadmin ne le remet pas à zéro, et
  // `manualPremium` est remis à false par injectSubscription à l'échéance :
  // on teste les deux pour couvrir l'avant et l'après.
  if (user.manualPremium === true) return true;
  if (user.manualPremiumExpiry) return true;

  const sub = user.subscription || {};
  // Un identifiant d'abonnement Stripe ne s'efface pas à la résiliation :
  // c'est la preuve la plus fiable qu'un abonnement a existé.
  if (sub.stripeSubscriptionId) return true;
  if (sub.status === "active" || sub.status === "cancelled") return true;

  return false;
}

/** Ce compte a-t-il encore droit au mois offert ? */
function peutAvoirEssaiGratuit(user) {
  return !aDejaEuUnAccesPayant(user);
}

module.exports = { peutAvoirEssaiGratuit, aDejaEuUnAccesPayant, TRIAL_DAYS };
