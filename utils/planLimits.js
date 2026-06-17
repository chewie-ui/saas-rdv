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

  // manualPremium bypass: use the stored plan if present, else "pro"
  if (user.manualPremium || user.isPremium) {
    const manualPlan = sub && sub.plan;
    // Only trust the embedded plan if it's a known paid plan
    if (manualPlan === "business") return "business";
    return "pro";
  }

  if (!sub || sub.status !== "active") return "basic";
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

  // Max services (3 = free trial)
  services: { basic: 3, pro: 10, business: 50 },

  // Max employees (0 = feature locked)
  employees: { basic: 0, pro: 2, business: 10 },

  // Monthly bookings cap (Infinity = unlimited)
  monthlyBookings: { basic: 20, pro: Infinity, business: Infinity },

  // Availability features
  availability: {
    basic:    { ranges: false, buffer: false, slotDuration: false },
    pro:      { ranges: true,  buffer: true,  slotDuration: true  },
    business: { ranges: true,  buffer: true,  slotDuration: true  },
  },

  // Social links visible on public page
  socialLinks: { basic: false, pro: true, business: true },

  // Email reminders sent 24h before appointment
  emailReminders: { basic: false, pro: true, business: true },

  // Google Calendar two-way sync
  googleCalendar: { basic: false, pro: true, business: true },

  // Booking page customization (colors, logo, fonts, layout)
  calendarCustomization: { basic: false, pro: true, business: true },

  // Cancel / delete / restore bookings from the admin panel
  cancelDeleteBookings: { basic: false, pro: true, business: true },

  // Send emails without "Powered by BranShee" branding
  noBranding: { basic: false, pro: false, business: true },

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
