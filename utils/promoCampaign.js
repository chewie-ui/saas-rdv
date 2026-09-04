/**
 * Campagne promo en cours — lecture partagée par les vues publiques et le
 * tunnel de paiement.
 *
 * Une seule source de vérité : si la campagne est éteinte ou expirée, la
 * bannière disparaît ET le coupon Stripe cesse d'être appliqué. Les deux ne
 * peuvent pas diverger, ce qui évite d'annoncer un prix que la facture ne
 * tiendrait pas.
 */
const PromoCampaign = require("../db/models/promoCampaign.model");
const { peutAvoirEssaiGratuit } = require("./freeTrial");
const { FORFAITS } = require("./tarifs");

let cache = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 15 * 1000;

async function getCampaign() {
  const now = Date.now();
  if (cache && now < cacheExpiry) return cache;

  const doc = await PromoCampaign.findOne({ key: "main" }).lean();
  cache = doc || null;
  cacheExpiry = now + CACHE_TTL_MS;
  return cache;
}

function invalidatePromoCampaignCache() {
  cache = null;
  cacheExpiry = 0;
}

/** La campagne tourne-t-elle réellement en ce moment ? */
function estEnCours(c) {
  if (!c || !c.active) return false;
  // Une campagne sans date de fin n'affiche aucun compte à rebours : on la
  // laisse tourner, mais c'est `endsAt` qui pilote l'urgence affichée.
  if (c.endsAt && new Date(c.endsAt).getTime() <= Date.now()) return false;
  return true;
}

/**
 * Données d'affichage pour les pages publiques.
 * @returns {null|{endsAt: string|null, prixEuros: number, days: number, plan: string, prixNormal: number}}
 */
async function banniereCampagne() {
  const c = await getCampaign();
  if (!estEnCours(c)) return null;

  const forfait = FORFAITS[c.plan] || FORFAITS.pro;
  return {
    endsAt: c.endsAt ? new Date(c.endsAt).toISOString() : null,
    prixEuros: c.firstPeriodCents / 100,
    days: c.days,
    plan: c.plan,
    planLabel: forfait.libelle,
    prixNormal: forfait.mensuel,
  };
}

/**
 * L'offre s'applique-t-elle à CE paiement ?
 *
 * `user` sert à vérifier que le compte n'a jamais eu d'accès payant : l'offre
 * est due une seule fois, sinon résilier puis reprendre la relancerait
 * indéfiniment (même raison que pour l'ancien mois offert).
 *
 * @returns {null|{amountOffCents: number, prixEuros: number, days: number}}
 */
async function offrePourCheckout(user, planName, billing) {
  const c = await getCampaign();
  if (!estEnCours(c)) return null;
  if (planName !== c.plan || billing !== c.billing) return null;
  if (!peutAvoirEssaiGratuit(user)) return null;

  const forfait = FORFAITS[planName];
  if (!forfait || !forfait.mensuel) return null;

  const plein = Math.round(forfait.mensuel * 100);
  const amountOffCents = plein - c.firstPeriodCents;
  // Une remise nulle ou négative n'a rien à faire chez Stripe : un coupon
  // amount_off <= 0 est refusé, et un prix promo supérieur au plein tarif
  // serait une erreur de saisie qu'on préfère ignorer que facturer.
  if (amountOffCents <= 0) return null;

  return { amountOffCents, prixEuros: c.firstPeriodCents / 100, days: c.days };
}

module.exports = {
  getCampaign,
  invalidatePromoCampaignCache,
  estEnCours,
  banniereCampagne,
  offrePourCheckout,
};
