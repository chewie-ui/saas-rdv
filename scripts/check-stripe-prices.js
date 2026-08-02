/**
 * Vérifie la configuration Stripe de PRODUCTION. Lecture seule : ce script
 * ne crée, ne modifie et ne supprime rien.
 *
 *   node scripts/check-stripe-prices.js
 *
 * Il répond à deux questions :
 *   1. Les prix existent-ils vraiment dans le compte Stripe en mode live ?
 *   2. Chaque variable STRIPE_PRICE_*_SERVER pointe-t-elle sur un prix valide ?
 *
 * Rappel important : un price ID de TEST ne fonctionne PAS avec une clé LIVE.
 * Les deux modes ont des identifiants séparés — recopier un `price_…` du mode
 * test dans la variable de production donne « No such price » au paiement.
 */
require("dotenv").config({ quiet: true });

const env = require("../environment/production");
const cle = env.stripeSecretKey;

if (!cle) {
  console.error("STRIPE_SECRET_KEY_SERVER est absente. Rien à vérifier.");
  process.exit(1);
}
const mode = cle.startsWith("sk_live") ? "LIVE" : cle.startsWith("sk_test") ? "TEST" : "INCONNU";
const stripe = require("stripe")(cle);

// Ce que le code de paiement va chercher (cf. controllers/account.controller.js).
const ATTENDUS = [
  ["Essentiel · mensuel", "STRIPE_PRICE_ESSENTIEL_MONTHLY_SERVER", env.stripePriceEssentielMonthly],
  ["Essentiel · annuel", "STRIPE_PRICE_ESSENTIEL_YEARLY_SERVER", env.stripePriceEssentielYearly],
  ["Pro · mensuel", "STRIPE_PRICE_PREMIUM_MONTHLY_KEY_SERVER", env.stripePricePremiumMonthly],
  ["Pro · annuel", "STRIPE_PRICE_PREMIUM_YEARLY_KEY_SERVER", env.stripePricePremiumYearly],
  ["Business · mensuel", "STRIPE_PRICE_BUSINESS_MONTHLY_KEY_SERVER", env.stripePriceBusinessMonthly],
  ["Business · annuel", "STRIPE_PRICE_BUSINESS_YEARLY_KEY_SERVER", env.stripePriceBusinessYearly],
  ["Add-on URL perso", "STRIPE_PRICE_ADDON_CUSTOM_URL_SERVER", env.stripePriceAddonCustomUrl],
  ["Collaborateur suppl.", "STRIPE_PRICE_EXTRA_COLLABORATOR_SERVER", env.stripePriceExtraCollaborator],
];

// Une clé restreinte par IP ne répond qu'depuis le serveur autorisé. Le
// signaler explicitement évite de conclure « le prix est invalide » alors que
// c'est simplement la machine qui n'a pas le droit d'interroger Stripe.
function estRestrictionIP(err) {
  return /does not allow requests from your IP/i.test(err && err.message ? err.message : "");
}

const euros = (p) =>
  p.unit_amount == null ? "?" : (p.unit_amount / 100).toFixed(2) + " " + String(p.currency).toUpperCase();
const recurrence = (p) =>
  p.recurring ? "tous les " + (p.recurring.interval_count || 1) + " " + p.recurring.interval : "paiement unique";

(async () => {
  console.log("Clé utilisée : " + mode + "\n");

  // ── 1. Les variables pointent-elles sur quelque chose de valide ? ─────────
  console.log("── Variables attendues par le code ──");
  let bloquants = 0;
  for (const [libelle, variable, valeur] of ATTENDUS) {
    if (!valeur) {
      // Seuls les plans mensuels bloquent un paiement : les autres périodes
      // retombent sur le mensuel (cf. le repli dans account.controller.js).
      const critique = /MONTHLY/.test(variable);
      if (critique) bloquants++;
      console.log(
        (critique ? "  BLOQUANT " : "  manquant ") + libelle.padEnd(22) + variable
      );
      continue;
    }
    try {
      const p = await stripe.prices.retrieve(valeur);
      const actif = p.active ? "actif" : "INACTIF DANS STRIPE";
      console.log("  ok       " + libelle.padEnd(22) + euros(p) + " · " + recurrence(p) + " · " + actif);
      if (!p.active) bloquants++;
    } catch (err) {
      if (estRestrictionIP(err)) {
        console.log("  ?        " + libelle.padEnd(22) + valeur + " (non vérifiable depuis cette machine)");
        continue;
      }
      bloquants++;
      console.log("  INVALIDE " + libelle.padEnd(22) + valeur + " → " + err.message.split("\n")[0]);
    }
  }

  // ── 2. Qu'est-ce qui existe réellement dans ce compte Stripe ? ────────────
  console.log("\n── Prix récurrents existants dans le compte (" + mode + ") ──");
  try {
    const prix = await stripe.prices.list({ active: true, limit: 100, expand: ["data.product"] });
    const recurrents = prix.data.filter((p) => p.recurring);
    if (!recurrents.length) {
      console.log("  AUCUN. Les produits n'ont jamais été créés dans ce mode.");
      console.log("  → à créer dans le dashboard Stripe, puis recopier les price_… ci-dessous.");
    } else {
      recurrents.forEach((p) => {
        const nom = p.product && p.product.name ? p.product.name : "(produit sans nom)";
        console.log("  " + p.id.padEnd(32) + euros(p).padStart(11) + " · " + recurrence(p).padEnd(18) + nom);
      });
    }
  } catch (err) {
    if (!estRestrictionIP(err)) throw err;
    console.log("  Impossible : cette clé Stripe est restreinte à certaines adresses IP.");
    console.log("  → relancer ce script SUR LE VPS, où l'IP est autorisée.");
  }

  console.log(
    "\n" +
      (bloquants === 0
        ? ">>> Le paiement est opérationnel."
        : ">>> " + bloquants + " problème(s) bloquant(s) : personne ne peut payer les plans concernés.")
  );
})().catch((e) => {
  console.error("Échec de la vérification :", e.message);
  process.exit(1);
});
