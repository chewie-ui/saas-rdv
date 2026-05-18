/**
 * BranShee — Plan limits & feature gates
 * Single source of truth for all subscription restrictions.
 */

const PLANS = {
  basic:    0,
  pro:      1,
  business: 2,
};

/**
 * Returns the canonical plan for a user object.
 * Falls back to "basic" if no active subscription.
 */
function getPlan(user) {
  if (!user) return "basic";
  const sub = user.subscription;
  if (!sub || sub.status !== "active") {
    // manualPremium bypass (dev/admin)
    if (user.manualPremium || user.isPremium) return "pro";
    return "basic";
  }
  return sub.plan || "basic";
}

/**
 * Returns true if the user's plan is >= the required plan.
 * e.g. atLeast(user, "pro") → true for pro and business
 */
function atLeast(user, requiredPlan) {
  return PLANS[getPlan(user)] >= PLANS[requiredPlan];
}

/** ── Feature-specific limits ─────────────────────────────────────── */

const LIMITS = {
  // Max pre-booking form questions (0 = feature locked)
  formQuestions: { basic: 0, pro: 3, business: 10 },

  // Max services (0 = feature locked)
  services: { basic: 0, pro: 10, business: 50 },

  // Max employees (0 = feature locked)
  employees: { basic: 0, pro: 2, business: 10 },

  // Availability features
  availability: {
    basic:    { ranges: false, buffer: false, slotDuration: false },
    pro:      { ranges: true,  buffer: true,  slotDuration: true  },
    business: { ranges: true,  buffer: true,  slotDuration: true  },
  },

  // Social links visible on public page
  socialLinks: { basic: false, pro: true, business: true },

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

module.exports = { getPlan, atLeast, getLimit, LIMITS, PLANS };
