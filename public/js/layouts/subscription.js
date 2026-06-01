// Translations injected server-side
const subT = window.__subT || {};

/* ── Billing toggle (Monthly / Yearly) ───────────────────────── */
let isYearly = false;

const billMonthly = document.getElementById("billMonthly");
const billYearly  = document.getElementById("billYearly");
const priceEls    = document.querySelectorAll(".sub-plan__price[data-monthly]");

function updatePrices() {
  priceEls.forEach((el) => {
    const monthly = el.dataset.monthly;
    const yearly  = el.dataset.yearly;
    const val     = isYearly ? yearly : monthly;
    if (!val) return;
    // Keep the currency symbol if present
    const prefix = el.textContent.replace(/[\d.]+/, "").trim() || "€";
    el.textContent = `${prefix}${val}`;
  });
}

const getProPlan         = document.getElementById("getProPlan");
const getProPlanAlert    = document.getElementById("getProPlanAlert");
const getBusinessPlan    = document.getElementById("getBusinessPlan");
const cancelSubscriptionPro = document.getElementById("cancelSubscriptionPro");
const getFreePlan        = document.getElementById("getFreePlan");
const retakeSubscription = document.getElementById("retakeSubscription");
const templateDialog     = document.getElementById("templateDialog");

// ── Promo code ────────────────────────────────────────────────────────────────
const promoCodeInput  = document.getElementById("promoCodeInput");
const applyPromoBtn   = document.getElementById("applyPromoBtn");
const promoCodeStatus = document.getElementById("promoCodeStatus");
let appliedPromoCode  = null; // { code, discountType, discountValue, applicablePlan }
let currentPlan       = "pro"; // plan courant sélectionné pour le checkout

// Prix de base (mensuel / annuel) lus depuis les data attributes
const PRICES = {
  pro:      { monthly: null, yearly: null },
  business: { monthly: null, yearly: null },
};
document.querySelectorAll(".sub-plan__price[data-monthly]").forEach((el) => {
  const m = parseFloat(el.dataset.monthly);
  const y = parseFloat(el.dataset.yearly);
  if (el.closest(".sub-plan--premium"))  { PRICES.pro.monthly = m; PRICES.pro.yearly = y; }
  if (el.closest(".sub-plan--studio"))   { PRICES.business.monthly = m; PRICES.business.yearly = y; }
});

function calcDiscounted(basePrice, type, value) {
  if (!basePrice) return null;
  if (type === "percent") return Math.max(0, basePrice * (1 - value / 100));
  if (type === "fixed")   return Math.max(0, basePrice - value);
  return basePrice;
}

function applyPromoToUI(promoData) {
  // Plans ciblés par le code
  const ap = promoData ? promoData.applicablePlan : null; // ex: "pro_monthly", "all"
  const billing = isYearly ? "yearly" : "monthly";

  ["pro", "business"].forEach((plan) => {
    const planClass  = plan === "pro" ? ".sub-plan--premium" : ".sub-plan--studio";
    const priceEl    = document.querySelector(`${planClass} .sub-plan__price`);
    if (!priceEl) return;

    const base = isYearly ? PRICES[plan].yearly : PRICES[plan].monthly;
    if (!base) return;

    // Déterminer si ce code s'applique à ce plan
    const applies = promoData &&
      (ap === "all" ||
       ap === `${plan}_${billing}` ||
       ap === `${plan}_monthly` || ap === `${plan}_yearly`);

    // Supprimer l'ancien affichage promo s'il existe
    const oldWrap = priceEl.parentNode.querySelector(".sub-promo-wrap");
    if (oldWrap) oldWrap.remove();
    priceEl.style.display = "";

    if (applies) {
      const wrap = document.createElement("div");
      wrap.className = "sub-promo-wrap";
      wrap.style.cssText = "display:flex;flex-direction:column;gap:4px;";

      if (promoData.discountType === "trial") {
        // Trial : badge "X jours gratuits" + prix normal dessous
        const badge = document.createElement("span");
        badge.style.cssText = "display:inline-flex;align-items:center;gap:5px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:5px 12px;font-size:0.9rem;font-weight:700;color:#16a34a;width:fit-content;";
        badge.textContent = `🎁 ${promoData.trialDays || 30} jours gratuits`;

        const sub = document.createElement("span");
        sub.style.cssText = "font-size:0.75rem;color:#6b7280;font-weight:500;";
        sub.textContent = `puis ${priceEl.textContent.trim()}/mois`;

        wrap.appendChild(badge);
        wrap.appendChild(sub);
      } else {
        // Percent / fixed : prix barré + nouveau prix
        const discounted = calcDiscounted(base, promoData.discountType, promoData.discountValue);
        if (discounted === null) return;

        const priceRow = document.createElement("div");
        priceRow.style.cssText = "display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:2.5rem;font-weight:800;letter-spacing:-1.5px;line-height:1;";

        const strike = document.createElement("span");
        strike.style.cssText = "text-decoration:line-through;color:#aaa;font-size:1em;font-weight:800;";
        strike.textContent = priceEl.textContent.trim();

        const newPrice = document.createElement("span");
        newPrice.style.cssText = "font-size:1em;font-weight:800;color:#16a34a;letter-spacing:-1.5px;";
        newPrice.textContent = "€" + discounted.toFixed(2).replace(/\.00$/, "");

        priceRow.appendChild(strike);
        priceRow.appendChild(newPrice);
        wrap.appendChild(priceRow);

        const sub = document.createElement("span");
        sub.style.cssText = "font-size:0.75rem;color:#6b7280;font-weight:500;";
        sub.textContent = "1ère facture uniquement, puis plein tarif";
        wrap.appendChild(sub);
      }

      priceEl.style.display = "none";
      priceEl.parentNode.insertBefore(wrap, priceEl.nextSibling);
    }
  });
}

// Reset prix quand on change mensuel/annuel
const _origUpdatePrices = updatePrices;
function updatePricesWithPromo() {
  _origUpdatePrices();
  if (appliedPromoCode) applyPromoToUI(appliedPromoCode);
}

if (billMonthly && billYearly) {
  billMonthly.addEventListener("click", () => {
    isYearly = false;
    billMonthly.classList.add("active");
    billYearly.classList.remove("active");
    updatePricesWithPromo();
  });
  billYearly.addEventListener("click", () => {
    isYearly = true;
    billYearly.classList.add("active");
    billMonthly.classList.remove("active");
    updatePricesWithPromo();
  });
}

// Plan applicable badge
function showApplicablePlanBadge(promoData) {
  const existing = document.getElementById("promoApplicableBadge");
  if (existing) existing.remove();
  if (!promoData) return;

  const planLabels = {
    all:               "✅ Valable sur tous les plans",
    pro_monthly:       "✅ Valable sur Pro Mensuel uniquement",
    pro_yearly:        "✅ Valable sur Pro Annuel uniquement",
    business_monthly:  "✅ Valable sur Business Mensuel uniquement",
    business_yearly:   "✅ Valable sur Business Annuel uniquement",
  };
  const label = planLabels[promoData.applicablePlan] || "✅ Code appliqué";
  const badge = document.createElement("span");
  badge.id = "promoApplicableBadge";
  badge.style.cssText = "display:block;font-size:12px;color:#22c55e;margin-top:4px;";
  badge.textContent = label;
  promoCodeStatus.insertAdjacentElement("afterend", badge);
}

async function validatePromo() {
  const code = promoCodeInput.value.trim().toUpperCase();
  if (!code) return;

  promoCodeStatus.textContent = subT.checking || "Vérification...";
  promoCodeStatus.className   = "sub-promo__status";
  applyPromoToUI(null); // reset

  const res  = await fetch("/api/validate-promo", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ code, plan: currentPlan, billing: isYearly ? "yearly" : "monthly" }),
  });
  const data = await res.json();

  if (data.valid) {
    appliedPromoCode = data;
    let discountLabel;
    if (data.discountType === "trial") {
      discountLabel = `${data.trialDays || 30} jours gratuits, puis plein tarif`;
    } else if (data.discountType === "percent") {
      discountLabel = `-${data.discountValue}% sur la 1ère facture`;
    } else {
      discountLabel = `-${data.discountValue}€ sur la 1ère facture`;
    }
    promoCodeStatus.textContent = `✓ Code "${data.code}" appliqué : ${discountLabel}`;
    promoCodeStatus.className   = "sub-promo__status valid";
    applyPromoToUI(data);
    showApplicablePlanBadge(data);
    // Scroll vers les cartes de plan pour que l'utilisateur voie les prix mis à jour
    const plansSection = document.querySelector(".sub-plans");
    if (plansSection) {
      setTimeout(() => {
        plansSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    }
  } else {
    appliedPromoCode = null;
    applyPromoToUI(null);
    showApplicablePlanBadge(null);
    promoCodeStatus.textContent = data.error || subT.invalid || "Code invalide.";
    promoCodeStatus.className   = "sub-promo__status invalid";
  }
}

if (applyPromoBtn && promoCodeInput) {
  applyPromoBtn.addEventListener("click", validatePromo);
  promoCodeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") validatePromo(); });
}

// ── Toast (remplace les alert() natifs) ──────────────────────────────────────
function showToast(message, type = "success", duration = 3500) {
  const existing = document.querySelector(".bs-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `bs-toast bs-toast--${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("bs-toast--out");
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

// ── Generic confirm dialog ────────────────────────────────────────────────────
function openDialog(title, desc, confirmLabel, closeLabel) {
  return new Promise((resolve) => {
    const tmp      = templateDialog.content.cloneNode(true);
    const parentTmp = tmp.querySelector("#dialogWrp");
    const close    = (value) => { parentTmp.remove(); resolve(value); };

    tmp.querySelector(".dialog__h2").textContent    = title;
    tmp.querySelector(".dialog__p").textContent     = desc;
    tmp.querySelector(".dialog__btn2").innerHTML    = `<span>${confirmLabel}</span>`;
    tmp.querySelector(".dialog__btn1").innerHTML    = `<span>${closeLabel}</span>`;
    tmp.querySelector(".dialog__btn1").onclick      = () => close(false);
    tmp.querySelector(".dialog__icon").onclick      = () => close(false);
    // Fermer en cliquant sur l'overlay
    parentTmp.addEventListener("click", (e) => { if (e.target === parentTmp) close(false); });
    tmp.querySelector(".dialog__btn2").onclick      = () => close(true);

    document.body.appendChild(tmp);
  });
}

// ── Checkout helpers ──────────────────────────────────────────────────────────
async function startCheckout(plan) {
  currentPlan = plan || "pro";
  const body = { plan: currentPlan, billing: isYearly ? "yearly" : "monthly" };
  if (appliedPromoCode) body.promoCode = appliedPromoCode.code;

  const response = await fetch("/account/create-checkout", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const data = await response.json();
  if (data.url) window.location = data.url;
  else if (data.upgraded) window.location = "/subscription/success";
  else if (data.error) showToast(data.error, "error");
}

if (getProPlan)      getProPlan.onclick      = () => { currentPlan = "pro";      startCheckout("pro"); };
if (getProPlanAlert) getProPlanAlert.onclick = () => { currentPlan = "pro";      startCheckout("pro"); };
if (getBusinessPlan) getBusinessPlan.onclick = () => { currentPlan = "business"; startCheckout("business"); };

// ── Auto-checkout après inscription (avec promo auto-appliqué si présent) ─────
(function() {
  const params       = new URLSearchParams(window.location.search);
  const autoPlan     = params.get("plan");
  const autoBilling  = params.get("billing");
  const autoCheckout = params.get("autoCheckout");
  const autoPromo    = params.get("promo");
  if (autoCheckout !== "1" || !autoPlan) return;

  if (autoBilling === "yearly" && billYearly) {
    isYearly = true;
    billYearly.classList.add("active");
    if (billMonthly) billMonthly.classList.remove("active");
    updatePrices();
  }

  // Si un code promo est dans l'URL → l'appliquer avant le checkout
  if (autoPromo && promoCodeInput) {
    promoCodeInput.value = autoPromo;
    validatePromo().then(() => {
      setTimeout(() => startCheckout(autoPlan), 400);
    });
  } else {
    setTimeout(() => startCheckout(autoPlan), 600);
  }
})();

// ── Cancel subscription ───────────────────────────────────────────────────────
const handleSubscriptionCancel = async function (e) {
  e.preventDefault();

  const isConfirmed = await openDialog(
    subT.cancel_title || "Annuler l'abonnement",
    subT.cancel_desc  || "Êtes-vous sûr de vouloir annuler votre abonnement ?",
    subT.confirm      || "Confirmer",
    subT.close        || "Fermer"
  );

  if (!isConfirmed) return;

  try {
    const response = await fetch("/account/cancel-subscription", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json();

    if (data.success) {
      showToast(subT.success_cancel || data.message || "Abonnement annulé.", "success");
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showToast(data.error || "Une erreur est survenue.", "error");
    }
  } catch (err) {
    console.error("Fetch error:", err);
    showToast("Une erreur est survenue. Veuillez réessayer.", "error");
  }
};

if (cancelSubscriptionPro) cancelSubscriptionPro.onclick = handleSubscriptionCancel;
if (getFreePlan)           getFreePlan.onclick           = handleSubscriptionCancel;

// ── Resume subscription ───────────────────────────────────────────────────────
if (retakeSubscription) {
  retakeSubscription.onclick = async function (e) {
    e.preventDefault();

    const isConfirmed = await openDialog(
      subT.resume_title || "Reprendre le plan",
      subT.resume_desc  || "Êtes-vous sûr de vouloir reprendre votre abonnement ?",
      subT.confirm      || "Confirmer",
      subT.close        || "Fermer"
    );

    if (!isConfirmed) return;

    try {
      const response = await fetch("/subscription/resume", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json();

      if (data.success) {
        showToast(subT.success_resume || data.message || "Abonnement repris.", "success");
        setTimeout(() => location.reload(), 1500);
      } else {
        showToast(data.error || "Une erreur est survenue.", "error");
      }
    } catch (err) {
      console.error("Fetch error:", err);
      showToast("Une erreur est survenue. Veuillez réessayer.", "error");
    }
  };
}
