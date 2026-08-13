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
    // Le symbole reste où il était : « 19€ » devenait « €19 » dès la première
    // bascule mensuel/annuel, parce qu'on le recollait toujours devant.
    const texte  = el.textContent.trim();
    const symbole = texte.replace(/[\d.,\s]/g, "") || "€";
    el.textContent = /^\s*[^\d]/.test(texte) ? `${symbole}${val}` : `${val}${symbole}`;
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

// Les trois plans payables, avec la classe de leur carte. Une seule liste :
// ajouter un plan ici suffit à ce qu'il lise ses prix ET affiche les promos.
// L'Essentiel n'est plus proposé (cf. utils/tarifs.js, `visible: false`) : sa
// carte n'existe plus sur la page, il n'y a donc plus de prix à y décorer.
const PLANS_PAYANTS = [
  { cle: "pro",      carte: ".sub-plan--premium" },
  { cle: "business", carte: ".sub-plan--studio" },
];

// Prix de base (mensuel / annuel) lus depuis les data attributes.
//
// L'Essentiel était écrit en dur à 9 € et exclu de la lecture du DOM : le jour
// où son prix change en base de traductions, la remise aurait été calculée sur
// un montant périmé. On le lit comme les autres, avec un repli sur le texte
// affiché quand la carte n'a pas de `data-monthly` (cas de l'annuel Essentiel
// non configuré dans Stripe, cf. essentielYearlyAvailable).
const PRICES = { pro: { monthly: null, yearly: null }, business: { monthly: null, yearly: null } };

PLANS_PAYANTS.forEach(({ cle, carte }) => {
  const el = document.querySelector(`${carte} .sub-plan__price`);
  if (!el) return;
  const m = parseFloat(el.dataset.monthly);
  const y = parseFloat(el.dataset.yearly);
  const affiche = parseFloat(String(el.textContent).replace(",", ".").replace(/[^\d.]/g, ""));
  PRICES[cle].monthly = Number.isFinite(m) ? m : (Number.isFinite(affiche) ? affiche : null);
  // Sans tarif annuel propre, la bascule « Annuel » laisse le prix mensuel
  // affiché : la remise doit donc porter sur ce même montant.
  PRICES[cle].yearly = Number.isFinite(y) ? y : PRICES[cle].monthly;
});

function calcDiscounted(basePrice, type, value) {
  if (!basePrice) return null;
  if (type === "percent") return Math.max(0, basePrice * (1 - value / 100));
  if (type === "fixed")   return Math.max(0, basePrice - value);
  return basePrice;
}

// Offres mises en avant par le superadmin (cf. subscription.pug). Elles
// s'appliquent sans que le pro ait à saisir quoi que ce soit : le prix plein
// est barré, le prix remisé affiché, et le code part au paiement. Avant, on
// annonçait « -20% » avec un code à copier-coller — remise affichée, plein
// tarif facturé à qui ne le collait pas.
const OFFRES_AUTO = Array.isArray(window.__offresAuto) ? window.__offresAuto : [];

// Même règle que le serveur (validate-promo et create-checkout) : un code visé
// « pro_monthly » ne doit pas décorer l'annuel, sinon on affiche une remise que
// le paiement refusera.
function promoCouvrePlan(promo, plan) {
  if (!promo) return false;
  const ap = promo.applicablePlan || "all";
  const billing = isYearly ? "yearly" : "monthly";
  return ap === "all" ||
    ap === `${plan}_${billing}` ||
    (plan === "pro" && ap === `premium_${billing}`);
}

// Renoncement explicite à l'offre (lien « Passer directement au plan payant »).
// Sans ce drapeau, l'offre automatique reviendrait aussitôt et on rejouerait
// l'essai gratuit que le pro vient justement de refuser.
let offresAutoRefusees = false;

// Un code saisi à la main l'emporte sur l'offre automatique : c'est un choix
// explicite du pro (et il peut être meilleur).
function promoPourPlan(plan) {
  if (promoCouvrePlan(appliedPromoCode, plan)) return appliedPromoCode;
  if (offresAutoRefusees) return null;
  return OFFRES_AUTO.find((o) => promoCouvrePlan(o, plan)) || null;
}

/** « 12.50 » → « 12,50€ » · « 9.00 » → « 9€ » */
function formatPrix(n) {
  return n.toFixed(2).replace(/\.00$/, "").replace(".", ",") + "€";
}

function applyPromoToUI() {
  // L'Essentiel était absent de cette boucle : une offre visant « tous les
  // plans » — que le serveur accepte pourtant pour l'Essentiel au paiement —
  // n'était annoncée que sur Pro et Business. Le pro qui prenait l'Essentiel
  // recevait la remise sans qu'on la lui ait jamais promise ; celui qui la
  // cherchait sur la page ne la voyait pas et partait.
  PLANS_PAYANTS.forEach(({ cle: plan, carte }) => {
    const priceEl = document.querySelector(`${carte} .sub-plan__price`);
    if (!priceEl) return;

    const base = isYearly ? PRICES[plan].yearly : PRICES[plan].monthly;
    if (!base) return;

    const promoData = promoPourPlan(plan);

    // Supprimer l'ancien affichage promo s'il existe
    const oldWrap = priceEl.parentNode.querySelector(".sub-promo-wrap");
    if (oldWrap) oldWrap.remove();
    priceEl.classList.remove("is-replaced");

    if (!promoData) return;

    const wrap = document.createElement("div");
    wrap.className = "sub-promo-wrap";

    if (promoData.discountType === "trial") {
      // Essai : badge « X jours gratuits », puis le plein tarif en dessous —
      // rien n'est barré, le prix ne baisse pas, il est seulement différé.
      const badge = document.createElement("span");
      badge.className = "sub-promo-wrap__badge";
      badge.textContent = `🎁 ${promoData.trialDays || 30} jours gratuits`;

      const sub = document.createElement("span");
      sub.className = "sub-promo-wrap__note";
      // On reprend le suffixe affiché par la carte plutôt que de le déduire du
      // mode de facturation : en annuel, le prix montré reste un tarif MENSUEL
      // (« 15€/mois, facturé à l'année »). Écrire « /an » à côté de 15 €
      // annoncerait un abonnement quatre fois moins cher qu'il ne l'est.
      const suffixe = (priceEl.parentNode.querySelector(".sub-plan__per") || {}).textContent || "";
      sub.textContent = `puis ${priceEl.textContent.trim()} ${suffixe.trim()}`.trim();

      wrap.appendChild(badge);
      wrap.appendChild(sub);
    } else {
      // Remise en % ou en € : prix plein barré, prix remisé à côté.
      const discounted = calcDiscounted(base, promoData.discountType, promoData.discountValue);
      if (discounted === null) return;

      const priceRow = document.createElement("div");
      priceRow.className = "sub-promo-wrap__row";

      const strike = document.createElement("span");
      strike.className = "sub-promo-wrap__old";
      strike.textContent = priceEl.textContent.trim();

      const newPrice = document.createElement("span");
      newPrice.className = "sub-promo-wrap__new";
      newPrice.textContent = formatPrix(discounted);

      priceRow.appendChild(strike);
      priceRow.appendChild(newPrice);
      wrap.appendChild(priceRow);

      const sub = document.createElement("span");
      sub.className = "sub-promo-wrap__note";
      // Ces deux types de remise sont des coupons Stripe `duration: once` (cf.
      // account.controller.js) : le dire, plutôt que laisser croire que le
      // tarif remisé vaut pour toujours.
      sub.textContent = "1ère facture uniquement, puis plein tarif";
      wrap.appendChild(sub);
    }

    // `class` plutôt que `style.display` : le style vit dans la feuille CSS,
    // et un `display` en dur écrasait celui de la règle au retour à l'état
    // normal.
    priceEl.classList.add("is-replaced");
    priceEl.parentNode.insertBefore(wrap, priceEl.nextSibling);
  });
}

// Reset prix quand on change mensuel/annuel. On redécore systématiquement :
// une offre peut ne valoir que pour le mensuel ou que pour l'annuel, et le
// prix barré doit suivre la bascule.
const _origUpdatePrices = updatePrices;
function updatePricesWithPromo() {
  _origUpdatePrices();
  applyPromoToUI();
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
  appliedPromoCode = null;   // le temps de la vérification
  applyPromoToUI();

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
  // Le code envoyé est celui réellement affiché sur CE plan — saisi à la main
  // ou offre automatique. Le serveur revalide de toute façon (expiration,
  // quota, déjà utilisé) : au pire l'offre est ignorée, jamais forcée.
  const promoPlan = promoPourPlan(currentPlan);
  if (promoPlan) body.promoCode = promoPlan.code;
  if (selectedPaymentMethodId) body.paymentMethodId = selectedPaymentMethodId;

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

/* ── Boîte de confirmation avant paiement ──────────────────────────────────────
   "si y a déjà une carte, demande payer instant avec carte X ou changer de
   carte, et ajoute avant de payer l'option AJOUTER UN CODE PROMO et une
   validation 'êtes-vous sûr de vouloir payer X €' — pas question que ça
   débite direct au clic sur 'Acheter Business', c'est abusé."
   ───────────────────────────────────────────────────────────────────────────── */
let selectedPaymentMethodId = null;

function fmtPrice(n) {
  if (n == null || isNaN(n)) return null;
  // Virgule décimale : une remise tombe rarement sur un compte rond et
  // « 15.20 € » n'est pas un prix français.
  return n.toFixed(2).replace(/\.00$/, "").replace(".", ",") + " €";
}

function cardLabel(pm) {
  return (pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1)) + " •••• " + pm.last4;
}

function getPlanPrice(plan) {
  const billing = isYearly ? "yearly" : "monthly";
  const base = PRICES[plan] ? PRICES[plan][billing] : null;
  if (base == null) return null;

  // Même promo que celle affichée sur la carte du plan (code saisi OU offre
  // mise en avant) : sans ça la carte annonçait 15,20 € et la confirmation
  // 19 € — deux prix pour le même achat.
  const promo = promoPourPlan(plan);
  if (promo) {
    // Code de type "essai gratuit" : le 1er paiement est 0 € (Stripe
    // décale la première facturation à la fin du trial). On retourne 0
    // pour que la confirmation affiche "0 €" et non le plein tarif
    // ("jai activé BIENVENUE qui donne 1 mois gratuit mais il met 49 €").
    if (promo.discountType === "trial") return 0;
    const discounted = calcDiscounted(base, promo.discountType, promo.discountValue);
    if (discounted !== null) return discounted;
  }
  return base;
}

// Retourne vrai si un code essai gratuit est actif et s'applique à ce plan.
function isTrialActive(plan) {
  const promo = promoPourPlan(plan);
  if (promo && promo.discountType === "trial") return true;
  // Le mois offert est appliqué par le SERVEUR sur un nouvel abonnement
  // (cf. trial_period_days dans createCheckout), mais UNE SEULE FOIS par
  // compte : `__trialAvailable` reflète cette éligibilité, calculée côté
  // serveur (utils/freeTrial.js).
  //
  // Les deux sens comptent autant : annoncer « payer 19 € » juste après un
  // bouton « Essayer gratuitement » trahit une promesse, et annoncer
  // « 30 jours offerts » à quelqu'un qui sera débité tout de suite est pire
  // encore.
  return window.__trialAvailable !== false;
}

function confirmPurchase(plan) {
  return new Promise((resolve) => {
    const pms = window.__paymentMethods || [];
    if (!selectedPaymentMethodId) {
      const def = pms.find((pm) => pm.isDefault) || pms[0];
      selectedPaymentMethodId = def ? def.id : null;
    }

    const planLabel    = plan === "business" ? "Business" : plan === "essentiel" ? "Essentiel" : "Pro";
    const billingLabel = isYearly ? "facturation annuelle" : "facturation mensuelle";
    let   price        = getPlanPrice(plan);
    let   priceLabel   = fmtPrice(price);
    // Détecter dès l'ouverture si un code essai gratuit est actif.
    const trialActive  = isTrialActive(plan);
    // La promo peut être nulle quand l'essai vient du serveur et non d'un code :
    // sans cette garde, la boîte de confirmation plantait.
    const promoPlan    = promoPourPlan(plan);
    const trialDays    = trialActive ? ((promoPlan && promoPlan.trialDays) || 30) : 0;
    // Prix affiché après l'essai : celui de la carte du plan, remise comprise —
    // annoncer « puis 19 €/mois » sous un prix barré à 15,20 € est incohérent.
    const billing      = isYearly ? "yearly" : "monthly";
    const plein        = PRICES[plan] ? PRICES[plan][billing] : null;
    const basePrice    = (promoPlan && promoPlan.discountType !== "trial" && plein != null)
      ? calcDiscounted(plein, promoPlan.discountType, promoPlan.discountValue)
      : plein;

    const tmp       = templateDialog.content.cloneNode(true);
    const parentTmp = tmp.querySelector("#dialogWrp");
    const close     = (value) => { parentTmp.remove(); resolve(value); };

    tmp.querySelector(".dialog__h2").textContent = "Confirmer votre achat";

    const descEl = tmp.querySelector(".dialog__description");
    descEl.innerHTML = "";

    const intro = document.createElement("p");
    intro.className = "dialog__p";
    if (trialActive) {
      // Code essai : 1er mois / N jours offerts, puis plein tarif.
      intro.innerHTML = "Plan <strong>" + planLabel + "</strong> — " +
        "<strong>" + trialDays + " jours offerts</strong>, puis " +
        (basePrice != null ? "<strong>" + fmtPrice(basePrice) + "</strong>/mois" : "plein tarif") +
        " (" + billingLabel + ").";
    } else {
      intro.innerHTML = "Vous êtes sur le point de souscrire au plan <strong>" + planLabel + "</strong>" +
        (priceLabel ? " pour <strong>" + priceLabel + "</strong>" : "") +
        " (" + billingLabel + ").";
    }
    descEl.appendChild(intro);

    // ── Carte : "payer instant avec carte X ou changer de carte" ─────────────
    let showPicker = false;
    if (pms.length) {
      const cardWrap = document.createElement("div");
      cardWrap.className = "sub-confirm__card";

      function renderCardChoice() {
        cardWrap.innerHTML = "";
        const current = pms.find((pm) => pm.id === selectedPaymentMethodId) || pms[0];

        const row = document.createElement("div");
        row.className = "sub-confirm__card-row";
        const lbl = document.createElement("span");
        lbl.className = "sub-confirm__card-label";
        lbl.innerHTML = "Payer instantanément avec <strong>" + cardLabel(current) + "</strong>";
        row.appendChild(lbl);

        if (pms.length > 1) {
          const switchBtn = document.createElement("button");
          switchBtn.type = "button";
          switchBtn.className = "sub-confirm__card-switch";
          switchBtn.textContent = showPicker ? "Masquer" : "Changer de carte";
          switchBtn.onclick = () => { showPicker = !showPicker; renderCardChoice(); };
          row.appendChild(switchBtn);
        }
        cardWrap.appendChild(row);

        if (showPicker) {
          const list = document.createElement("div");
          list.className = "sub-confirm__card-list";
          pms.forEach((pm) => {
            const item = document.createElement("label");
            item.className = "sub-confirm__card-item" + (pm.id === selectedPaymentMethodId ? " active" : "");
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "confirmCardChoice";
            radio.value = pm.id;
            radio.checked = pm.id === selectedPaymentMethodId;
            radio.addEventListener("change", () => {
              selectedPaymentMethodId = pm.id;
              showPicker = false;
              renderCardChoice();
            });
            const span = document.createElement("span");
            span.innerHTML = cardLabel(pm) + "<small>Expire " +
              String(pm.expMonth).padStart(2, "0") + "/" + String(pm.expYear).slice(-2) + "</small>";
            item.appendChild(radio);
            item.appendChild(span);
            list.appendChild(item);
          });
          cardWrap.appendChild(list);
        }
      }
      renderCardChoice();
      descEl.appendChild(cardWrap);
    }

    // ── "Ajouter un code promo" avant de payer ───────────────────────────────
    let priceStrongEls = [];
    function refreshPriceDisplays() {
      price = getPlanPrice(plan);
      priceLabel = fmtPrice(price);
      const isTrial = isTrialActive(plan);
      if (isTrial) {
        // En mode essai gratuit : le "fort" du texte "payer X" devient
        // "votre essai gratuit" pour que la phrase reste cohérente.
        priceStrongEls.forEach((el) => { el.textContent = "votre essai gratuit"; });
        confirmBtnLabel.textContent = "Activer mon essai gratuit →";
      } else {
        priceStrongEls.forEach((el) => { el.textContent = priceLabel || ""; });
        confirmBtnLabel.textContent = priceLabel ? ("Oui, payer " + priceLabel) : (subT.confirm || "Confirmer");
      }
    }

    if (!appliedPromoCode) {
      const promoWrap = document.createElement("div");
      promoWrap.className = "sub-confirm__promo";

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "sub-confirm__promo-toggle";
      toggle.textContent = "+ Ajouter un code promo";

      const form = document.createElement("div");
      form.className = "sub-confirm__promo-form";
      form.style.display = "none";

      const input = document.createElement("input");
      input.type = "text";
      input.className = "sub-confirm__promo-input";
      input.placeholder = "Code promo";

      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "sub-confirm__promo-apply";
      applyBtn.textContent = "Appliquer";

      const status = document.createElement("span");
      status.className = "sub-confirm__promo-status";

      form.appendChild(input);
      form.appendChild(applyBtn);
      promoWrap.appendChild(toggle);
      promoWrap.appendChild(form);
      promoWrap.appendChild(status);

      toggle.addEventListener("click", () => {
        const willShow = form.style.display === "none";
        form.style.display = willShow ? "flex" : "none";
        if (willShow) input.focus();
      });

      input.addEventListener("keydown", (e) => { if (e.key === "Enter") applyBtn.click(); });

      applyBtn.addEventListener("click", async () => {
        const code = input.value.trim().toUpperCase();
        if (!code) return;
        status.textContent = subT.checking || "Vérification...";
        status.className = "sub-confirm__promo-status";
        try {
          const res  = await fetch("/api/validate-promo", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ code, plan, billing: isYearly ? "yearly" : "monthly" }),
          });
          const data = await res.json();
          if (data.valid) {
            appliedPromoCode = data;
            if (promoCodeInput) promoCodeInput.value = data.code;
            applyPromoToUI(data);
            showApplicablePlanBadge(data);
            status.textContent = '✓ Code "' + data.code + '" appliqué';
            status.className   = "sub-confirm__promo-status valid";
            form.style.display = "none";
            toggle.style.display = "none";
            refreshPriceDisplays();
          } else {
            status.textContent = data.error || subT.invalid || "Code invalide.";
            status.className   = "sub-confirm__promo-status invalid";
          }
        } catch (e) {
          status.textContent = "Erreur réseau. Veuillez réessayer.";
          status.className   = "sub-confirm__promo-status invalid";
        }
      });

      descEl.appendChild(promoWrap);
    }

    // ── Validation finale : "êtes-vous sûr de vouloir payer X € ?" ───────────
    const ask = document.createElement("p");
    ask.className = "dialog__p sub-confirm__ask";
    const askPriceEl = document.createElement("strong");
    askPriceEl.className = "sub-confirm__price";
    if (trialActive) {
      // Code essai : la phrase de confirmation reflète le mois gratuit, pas
      // un paiement ("jai activé BIENVENUE qui donne 1 mois gratuit mais il
      // met payer 49 €").
      askPriceEl.textContent = "votre essai gratuit";
      ask.appendChild(document.createTextNode("Êtes-vous sûr·e de vouloir activer "));
      ask.appendChild(askPriceEl);
      ask.appendChild(document.createTextNode(" ?"));
    } else {
      askPriceEl.textContent = priceLabel || "";
      ask.appendChild(document.createTextNode("Êtes-vous sûr·e de vouloir payer "));
      ask.appendChild(askPriceEl);
      ask.appendChild(document.createTextNode(" ?"));
    }
    priceStrongEls.push(askPriceEl);
    descEl.appendChild(ask);

    const confirmBtn = tmp.querySelector(".dialog__btn2");
    confirmBtn.innerHTML = "";
    const confirmBtnLabel = document.createElement("span");
    // Label du bouton de confirmation selon le type de promo.
    if (trialActive) {
      confirmBtnLabel.textContent = "Activer mon essai gratuit →";
    } else {
      confirmBtnLabel.textContent = priceLabel ? ("Oui, payer " + priceLabel) : (subT.confirm || "Confirmer");
    }
    confirmBtn.appendChild(confirmBtnLabel);
    confirmBtn.onclick = () => close(true);

    // ── Lien "Passer directement au plan payant" (visible seulement en mode trial) ──
    if (trialActive) {
      const skipWrap = document.createElement("div");
      skipWrap.style.cssText = "text-align:center;margin-top:10px;";
      const skipLink = document.createElement("button");
      skipLink.type = "button";
      skipLink.style.cssText = "background:none;border:none;cursor:pointer;font-size:12px;color:#9ca3af;text-decoration:underline;padding:0;";
      skipLink.textContent = "Passer directement au plan payant →";
      skipLink.addEventListener("click", async () => {
        parentTmp.remove();   // fermer ce dialog
        resolve(false);       // annuler le flux trial
        // Relancer un checkout sans promo trial
        const savedPromo = appliedPromoCode;
        appliedPromoCode = null;
        offresAutoRefusees = true;   // l'offre mise en avant ne doit pas revenir
        if (promoCodeInput) promoCodeInput.value = "";
        applyPromoToUI();
        const confirmed2 = await confirmPurchase(plan);
        if (confirmed2) startCheckout(plan);
        else {
          appliedPromoCode = savedPromo;   // remettre si l'user annule
          offresAutoRefusees = false;
          applyPromoToUI();
        }
      });
      skipWrap.appendChild(skipLink);
      descEl.parentNode.insertBefore(skipWrap, confirmBtn.parentNode
        ? confirmBtn.closest(".dialog__actions") || confirmBtn.parentNode
        : descEl.nextSibling);
      // On insère après descEl car la structure dialog n'est pas connue
      descEl.after(skipWrap);
    }

    tmp.querySelector(".dialog__btn1").innerHTML = "<span>" + (subT.close || "Annuler") + "</span>";
    tmp.querySelector(".dialog__btn1").onclick   = () => close(false);
    tmp.querySelector(".dialog__icon").onclick   = () => close(false);
    parentTmp.addEventListener("click", (e) => { if (e.target === parentTmp) close(false); });

    document.body.appendChild(tmp);
  });
}

async function handlePlanPurchaseClick(plan) {
  currentPlan = plan;
  const confirmed = await confirmPurchase(plan);
  if (confirmed) startCheckout(plan);
}

if (getProPlan)      getProPlan.onclick      = () => handlePlanPurchaseClick("pro");
if (getProPlanAlert) getProPlanAlert.onclick = () => handlePlanPurchaseClick("pro");
if (getBusinessPlan) getBusinessPlan.onclick = () => handlePlanPurchaseClick("business");
const getEssPlan = document.getElementById("getEssPlan");
if (getEssPlan)      getEssPlan.onclick      = () => handlePlanPurchaseClick("essentiel");

// ── Bandeau d'incitation vers le Pro ─────────────────────────────────────────
// Ce bouton écrivait ici « BETA » dans le champ code promo avant d'aller au
// paiement. Or le code qui existe en base s'appelle « BETA100 » : le serveur
// répondait « code invalide » juste avant le checkout, sur le bouton le plus
// visible de la page. Plus aucun code n'est appliqué en dur — les offres
// automatiques ont déjà leur mécanisme (cf. OFFRES_AUTO), qui filtre selon le
// compte, ce qu'un code écrit dans le JavaScript ne peut pas faire.
//
// Le clic n'est PAS rebranché ici : subscription.pug relaie déjà ce bouton
// vers celui de la carte Pro. Poser un second gestionnaire ouvrait la boîte
// de confirmation deux fois.

// ── Offre mise en avant : appliquée dès l'ouverture de la page ──────────────
// Remplace l'ancien bouton « copier le code » : le pro devait coller un code
// pour obtenir la remise qu'on lui affichait déjà. Le prix barré vaut
// maintenant engagement — c'est ce montant-là qui part au paiement.
applyPromoToUI();

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
