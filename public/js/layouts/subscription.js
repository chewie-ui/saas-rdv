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

if (billMonthly && billYearly) {
  billMonthly.addEventListener("click", () => {
    isYearly = false;
    billMonthly.classList.add("active");
    billYearly.classList.remove("active");
    updatePrices();
  });

  billYearly.addEventListener("click", () => {
    isYearly = true;
    billYearly.classList.add("active");
    billMonthly.classList.remove("active");
    updatePrices();
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

async function validatePromo() {
  const code = promoCodeInput.value.trim().toUpperCase();
  if (!code) return;

  promoCodeStatus.textContent = subT.checking || "Vérification...";
  promoCodeStatus.className   = "promo-code-status";

  const res  = await fetch("/api/validate-promo", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ code, plan: currentPlan, billing: isYearly ? "yearly" : "monthly" }),
  });
  const data = await res.json();

  if (data.valid) {
    appliedPromoCode = data;
    const discount   = data.discountType === "percent"
      ? `-${data.discountValue}%`
      : `-${data.discountValue}€`;
    promoCodeStatus.textContent = `✓ Code appliqué : ${discount} de réduction`;
    promoCodeStatus.className   = "promo-code-status valid";
  } else {
    appliedPromoCode = null;
    promoCodeStatus.textContent = data.error || subT.invalid || "Code invalide.";
    promoCodeStatus.className   = "promo-code-status invalid";
  }
}

if (applyPromoBtn && promoCodeInput) {
  applyPromoBtn.addEventListener("click", validatePromo);
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
  else if (data.error) alert(data.error);
}

if (getProPlan)      getProPlan.onclick      = () => { currentPlan = "pro";      startCheckout("pro"); };
if (getProPlanAlert) getProPlanAlert.onclick = () => { currentPlan = "pro";      startCheckout("pro"); };
if (getBusinessPlan) getBusinessPlan.onclick = () => { currentPlan = "business"; startCheckout("business"); };

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
      alert(subT.success_cancel || data.message || "Abonnement annulé.");
      window.location.reload();
    } else {
      alert(data.error || "Une erreur est survenue.");
    }
  } catch (err) {
    console.error("Fetch error:", err);
    alert("Une erreur est survenue. Veuillez réessayer.");
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
        alert(subT.success_resume || data.message || "Abonnement repris.");
        location.reload();
      } else {
        alert(data.error || "Une erreur est survenue.");
      }
    } catch (err) {
      console.error("Fetch error:", err);
      alert("Une erreur est survenue. Veuillez réessayer.");
    }
  };
}
