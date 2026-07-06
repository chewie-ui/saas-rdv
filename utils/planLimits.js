/**
 * BranShee — Plan limits & feature gates
 * Single source of truth for all subscription restrictions.
 */

const PLANS = {
  basic:     0,
  essentiel: 1,
  pro:       2,
  business:  3,
};

// Plans payants connus (avec un abonnement Stripe). "basic" = gratuit.
const PAID_PLANS = ["essentiel", "pro", "business"];

/**
 * Returns the canonical plan for a user object.
 * Falls back to "basic" if no active subscription.
 */
function getPlan(user) {
  if (!user) return "basic";
  const sub = user.subscription;

  // manualPremium / isPremium bypass : on fait confiance au plan stocké s'il
  // est un plan payant connu (essentiel/pro/business), sinon "pro" (octroi
  // manuel superadmin sans plan précis).
  if (user.manualPremium || user.isPremium) {
    if (PAID_PLANS.includes(sub && sub.plan)) return sub.plan;
    return "pro";
  }

  if (!sub || sub.status !== "active") return "basic";
  return PAID_PLANS.includes(sub.plan) ? sub.plan : "basic";
}

/**
 * Returns true if the user's plan is >= the required plan.
 * e.g. atLeast(user, "pro") → true for pro and business
 */
function atLeast(user, requiredPlan) {
  return PLANS[getPlan(user)] >= PLANS[requiredPlan];
}

/** ── Feature-specific limits ─────────────────────────────────────── */

// Plan "essentiel" = même périmètre fonctionnel que "basic" (gratuit), avec
// une seule différence majeure : les rendez-vous illimités (+ l'historique
// conservé, ce qui découle automatiquement d'un abonnement actif). Toutes les
// autres cases sont donc identiques à basic — voir les valeurs `essentiel`.
const LIMITS = {
  // Max pre-booking form questions
  formQuestions: { basic: 1, essentiel: 1, pro: 5, business: 10 },

  // Max services (free gets 5 so users can actually build their catalog)
  services: { basic: 5, essentiel: 5, pro: 20, business: Infinity },

  // Max employees (0 = feature locked on free — team is a Pro differentiator)
  employees: { basic: 0, essentiel: 0, pro: 5, business: 10 },

  // Max établissements possédés
  companies: { basic: 1, essentiel: 1, pro: 1, business: 5 },

  // Max collaborateurs (CompanyMembership) inclus gratuitement par établissement.
  // Au-delà : sièges supplémentaires à +10€/mois chacun (voir getCollaboratorLimit).
  collaborators: { basic: 0, essentiel: 0, pro: 1, business: 4 },

  // Monthly bookings cap (Infinity = unlimited). Essentiel = illimité : c'est
  // SA raison d'être (le "gratuit sans plafond de RDV").
  monthlyBookings: { basic: 20, essentiel: Infinity, pro: Infinity, business: Infinity },

  // Availability features
  availability: {
    basic:     { ranges: false, buffer: false, slotDuration: false },
    essentiel: { ranges: false, buffer: false, slotDuration: false },
    pro:       { ranges: true,  buffer: true,  slotDuration: true  },
    business:  { ranges: true,  buffer: true,  slotDuration: true  },
  },

  // Social links visible on public page
  socialLinks: { basic: false, essentiel: false, pro: true, business: true },

  // Email reminders sent 24h before appointment
  emailReminders: { basic: false, essentiel: false, pro: true, business: true },

  // Rappels SMS inclus par mois (coût réel ~0,05-0,09€/SMS — quotas choisis
  // pour rester sous ~15% du prix du plan). Au-delà : email de repli, ou
  // crédits prépayés si l'utilisateur a activé "use_credits" (voir sms.js).
  smsReminders: { basic: 0, essentiel: 0, pro: 30, business: 100 },

  // Google Calendar two-way sync
  googleCalendar: { basic: false, essentiel: false, pro: true, business: true },

  // Booking page customization (colors, logo, fonts, layout)
  calendarCustomization: { basic: false, essentiel: false, pro: true, business: true },

  // Cancel / delete / restore bookings from the admin panel
  cancelDeleteBookings: { basic: false, essentiel: false, pro: true, business: true },

  // Send emails without "Powered by BranShee" branding
  noBranding: { basic: false, essentiel: false, pro: false, business: true },

  // Custom URL: business = included; others need addon purchase
  customUrl: {
    hasFeature: (user) => {
      const plan = getPlan(user);
      if (plan === "business") return true;
      return !!(user && user.addons && user.addons.customUrl);
    },
  },
};

function getLimit(feature, user) {
  const plan = getPlan(user);
  return LIMITS[feature][plan];
}

/**
 * Nombre de collaborateurs autorisés = quota gratuit du plan + sièges
 * supplémentaires achetés (+10€/mois/siège, Pro et Business uniquement).
 * Sur le plan "basic", les sièges achetés ne comptent pas (le forfait ne
 * permet pas d'inviter de collaborateurs, il faut d'abord passer Pro).
 */
function getCollaboratorLimit(user) {
  const plan = getPlan(user);
  const base = LIMITS.collaborators[plan];
  if (plan === "basic") return base;
  const extra = (user && user.addons && user.addons.extraCollaboratorSeats) || 0;
  return base + extra;
}

/**
 * Quota SMS gratuit inclus dans le plan chaque mois (Pro 30 / Business 100).
 * Au-delà de ce quota : consommation du solde prépayé (voir utils/sms.js),
 * sinon repli automatique sur l'email.
 */
function getSmsQuota(user) {
  return LIMITS.smsReminders[getPlan(user)] || 0;
}

module.exports = {
  getPlan, atLeast, getLimit, getCollaboratorLimit, getSmsQuota,
  LIMITS, PLANS,
};
