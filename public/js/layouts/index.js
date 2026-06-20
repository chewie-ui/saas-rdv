/* ============================================================
   BranShee — Client Booking Wizard
   Step flow: Service? → Employee? → Time → Details → Payment? → Confirm
   All API calls preserved from the original implementation.
   ============================================================ */

const __t        = window.__t        || {};
const SERVICES   = window.__services  || [];
const EMPLOYEES  = window.__employees || [];
let CLIENT       = window.__clientUser || null; // { firstName, lastName, email, phone } — mutable pour login inline
const PREPAYMENT = window.__prepayment || { enabled: false, required: false };
const STRIPE_KEY = window.__stripeKey  || "";

/* ── Popup "plus de créneaux ce mois-ci" (remplace l'alert() natif moche) ── */
function showLimitReachedModal() {
  const businessName = (window.__companyInfo && window.__companyInfo.businessName) || "ce professionnel";
  let modal = document.getElementById("bkLimitModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "bkLimitModal";
    modal.className = "bk-limit-modal";
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="bk-limit-modal__backdrop"></div>
    <div class="bk-limit-modal__card">
      <div class="bk-limit-modal__icon">
        <svg xmlns="http://www.w3.org/2000/svg" height="28px" viewBox="0 -960 960 960" width="28px" fill="currentColor">
          <path d="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-800h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm280 240q-17 0-28.5-11.5T440-480q0-17 11.5-28.5T480-520q17 0 28.5 11.5T520-480q0 17-11.5 28.5T480-440Z"/>
        </svg>
      </div>
      <h3 class="bk-limit-modal__title">Complet pour ce mois-ci</h3>
      <p class="bk-limit-modal__text">${businessName} a atteint sa limite de réservations en ligne pour ce mois. Les créneaux rouvrent automatiquement le mois prochain — vous pouvez aussi le/la contacter directement en attendant.</p>
      <button type="button" class="bk-limit-modal__btn" id="bkLimitModalClose">J'ai compris</button>
    </div>
  `;
  modal.classList.add("is-open");
  document.body.style.overflow = "hidden";

  function close() {
    modal.classList.remove("is-open");
    document.body.style.overflow = "";
  }
  modal.querySelector(".bk-limit-modal__backdrop").addEventListener("click", close);
  modal.querySelector("#bkLimitModalClose").addEventListener("click", close);
}

/* ── Stripe instances (lazy) ─────────────────────────────────────────────── */
let _stripe      = null;   // Stripe.js instance
let _cardElement = null;   // CardElement mounted in the payment step

function getStripe() {
  if (!_stripe && STRIPE_KEY && window.Stripe) _stripe = window.Stripe(STRIPE_KEY);
  return _stripe;
}

/* ── State ──────────────────────────────────────────────────────────────── */
const STATE = {
  service:    null,      // { id, name, price, duration, desc }
  employee:   undefined, // undefined = not yet chosen; null = "no preference"
  date:       null,   // "yyyy-mm-dd"
  time:       null,   // "HH:MM"
  daypart:    "all",  // "all" | "morning" | "afternoon" | "evening"
  calMonth:   new Date(),
  form: {
    firstName: CLIENT ? CLIENT.firstName : "",
    lastName:  CLIENT ? CLIENT.lastName  : "",
    email:     CLIENT ? CLIENT.email     : "",
    phone:     CLIENT ? CLIENT.phone     : "",
    message:   "",
  },
  formAnswers: [],
  activeForm:  null,  // pre-booking form loaded from API
  loading:     false,
  _openCat:    null,  // currently expanded category (null = all closed)
  _activeCat:  null,  // active category filter pill (null = "Tous")
  // ── Payment state ────────────────────────────────────────────────────────
  paymentMethod:        null,   // "online" | "on_site"
  stripePaymentIntentId: null,  // set after confirmCardPayment succeeds
  stripeSetupIntentId:   null,  // set after confirmCardSetup succeeds (carte enregistrée, 0€)
  paymentError:         null,
};

/* ── DOM refs ───────────────────────────────────────────────────────────── */
const stepper = document.getElementById("bkStepper");
const pane    = document.getElementById("bkPane");
const cart    = document.getElementById("bkCart");

/* ── Steps ──────────────────────────────────────────────────────────────── */
// La carte doit être enregistrée (0€ prélevé) dès que l'établissement a une
// politique d'annulation non gratuite — même si le prépaiement n'est pas
// activé — afin de pouvoir prélever les frais en cas d'annulation tardive
// ou d'absence.
function cardRequiredByPolicy() {
  return !!(PREPAYMENT.stripeActive && STRIPE_KEY && (PREPAYMENT.cancellationRule || "free") !== "free");
}

function needsPaymentStep() {
  // Only show payment step if the selected service has a price > 0
  const price = STATE.service?.price;
  if (price === null || price === undefined || Number(price) <= 0) return false;
  if (PREPAYMENT.enabled) return true;
  return cardRequiredByPolicy();
}

// Utilisé pour décider si l'étape "Paiement" doit apparaître dans le stepper
// — basé sur TOUS les services (pas seulement celui sélectionné), pour que
// le nombre d'étapes affichées reste IDENTIQUE du tout premier rendu (avant
// même de choisir un service) jusqu'à la fin du parcours. Sans ça, l'étape
// "Paiement" apparaissait/disparaissait selon le service choisi, donnant
// l'impression d'un stepper buggé (5 étapes puis soudain 6).
// Si le service réellement choisi n'a pas besoin de paiement, le flux
// continue de sauter cette étape à l'usage (cf. needsPaymentStep() dans
// goToNextStep) — elle reste juste visible dans la liste, jamais "active".
function anyServiceNeedsPayment() {
  const hasPayableService = SERVICES.some(
    (s) => s.price !== null && s.price !== undefined && Number(s.price) > 0
  );
  if (!hasPayableService) return false;
  return PREPAYMENT.enabled || cardRequiredByPolicy();
}

function buildSteps() {
  const steps = [];
  if (SERVICES.length > 0)  steps.push({ id: "service",  label: "Service" });
  if (EMPLOYEES.length > 0 || hasAnyServiceEmployees()) steps.push({ id: "employee", label: "Avec" });
  steps.push({ id: "time",    label: "Créneau" });
  steps.push({ id: "details", label: "Détails" });
  if (anyServiceNeedsPayment()) steps.push({ id: "payment",  label: "Paiement" });
  steps.push({ id: "confirm", label: "Confirmer" });
  return steps;
}

function hasAnyServiceEmployees() {
  return SERVICES.some(s => s.employees && s.employees.length > 0);
}

let STEPS    = buildSteps();
let stepIdx  = 0; // index into STEPS

function currentStep() { return STEPS[stepIdx]; }
function stepId()      { return STEPS[stepIdx]?.id; }

// Recompute steps after service selection (employee step depends on service)
function recomputeSteps() {
  const svcEmployees = STATE.service
    ? (SERVICES.find(s => s._id === STATE.service.id)?.employees || [])
    : [];
  const globalEmps = EMPLOYEES.length > 0;

  // Show "Avec" if: the service has assigned employees OR the company has any
  // employees at all (fallback: show all company employees when service has none).
  // Les sessions collectives ne dépendent pas d'un employé en particulier.
  const showEmployeeStep = STATE.service?.type !== "group" && (svcEmployees.length > 0 || globalEmps);

  const steps = [];
  if (SERVICES.length > 0) steps.push({ id: "service",  label: "Service" });
  if (showEmployeeStep)     steps.push({ id: "employee", label: "Avec" });
  steps.push({ id: "time",    label: "Créneau" });
  steps.push({ id: "details", label: "Détails" });
  // Même critère "any service" que buildSteps() — le nombre d'étapes ne doit
  // jamais changer selon le service réellement sélectionné (cf. commentaire
  // sur anyServiceNeedsPayment). Le saut effectif de l'étape "Paiement" pour
  // un service gratuit reste géré par needsPaymentStep() dans goToNextStep.
  if (anyServiceNeedsPayment()) steps.push({ id: "payment",  label: "Paiement" });
  steps.push({ id: "confirm", label: "Confirmer" });
  STEPS = steps;
}

/* ── Stepper render ─────────────────────────────────────────────────────── */
function renderStepper() {
  stepper.innerHTML = STEPS.map((s, i) => {
    const cls = i < stepIdx ? "is-done" : i === stepIdx ? "is-active" : "";
    const num = i < stepIdx ? "✓" : String(i + 1);
    return `<div class="bk-step ${cls}">
      <span class="bk-step__num">${num}</span>
      <span class="bk-step__lbl">${s.label}</span>
    </div>`;
  }).join("");
}

/* ── Cart render ────────────────────────────────────────────────────────── */
function renderCart() {
  if (stepIdx === STEPS.length - 1) { cart.innerHTML = ""; return; }

  const sid = stepId();
  const recap = [];
  if (STATE.service)  recap.push({ k: "Service", v: `${STATE.service.name}${STATE.service.price !== null && STATE.service.price !== undefined ? " · " + STATE.service.price + "€" : ""}` });
  if (STATE.employee) recap.push({ k: "Avec",    v: STATE.employee.name });
  if (STATE.date)     recap.push({ k: "Quand",   v: fmtDate(STATE.date) + (STATE.time ? " · " + STATE.time : "") });

  // "Continuer" is enabled when: logged in, OR guest form is visible and filled
  const guestFormVisible = !!document.getElementById("bkGuestForm")?.offsetParent;
  const detailsOk = CLIENT
    ? !!(CLIENT.firstName && CLIENT.email)
    : (guestFormVisible && !!(STATE.form.firstName && STATE.form.lastName && STATE.form.email));

  // Payment step: active as soon as any method is chosen.
  const paymentOk =
    STATE.paymentMethod === "on_site"       ||
    STATE.paymentMethod === "online"        ||
    STATE.paymentMethod === "paypal"        ||
    STATE.paymentMethod === "bank_transfer";

  const canNext =
    (sid === "service"  && STATE.service) ||
    (sid === "employee" && STATE.employee !== undefined) ||
    (sid === "time"     && STATE.date && STATE.time) ||
    (sid === "details"  && detailsOk) ||
    (sid === "payment"  && paymentOk);

  const isPayment = sid === "payment";
  const isDetails = sid === "details";
  let nextLabel = "Continuer";
  if (isDetails && !needsPaymentStep()) nextLabel = "Confirmer la réservation";
  if (isDetails &&  needsPaymentStep()) nextLabel = "Continuer";
  if (isPayment) nextLabel = STATE.paymentMethod === "online" ? "Confirmer et payer" : "Confirmer la réservation →";

  const showBack = stepIdx > 0;

  cart.innerHTML = `<div class="bk-cart">
    ${showBack ? `<button class="bk-cart__back" id="cartBack">← Retour</button>` : ""}
    <div class="bk-cart__recap">
      ${recap.map((r, i) => `
        ${i > 0 ? `<div class="bk-cart__sep"></div>` : ""}
        <div>
          <span class="bk-cart__k">${r.k}</span>
          <span class="bk-cart__v">${r.v}</span>
        </div>
      `).join("")}
    </div>
    ${recap.length > 0 ? `<div class="bk-cart__sep"></div>` : ""}
    <button class="bk-cart__next" id="cartNext" ${canNext ? "" : "disabled"}>
      ${nextLabel}
      <svg width="13" height="13" viewBox="0 -960 960 960" fill="currentColor">
        <path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/>
      </svg>
    </button>
  </div>`;

  const next = document.getElementById("cartNext");
  const back = document.getElementById("cartBack");
  if (next) next.onclick = () => advanceStep();
  if (back) back.onclick = () => retreatStep();
}

/* ── Navigation ─────────────────────────────────────────────────────────── */
function advanceStep() {
  const sid = stepId();

  if (sid === "details") {
    // Always collect form answers here while the details pane is still in the DOM.
    // If we proceed to the payment step, the pane will be replaced and answers
    // would be lost if collected later.
    STATE.formAnswers = collectFormAnswers();

    if (!needsPaymentStep()) {
      submitBooking();
      return;
    }
    // Advance to payment step
    stepIdx = Math.min(stepIdx + 1, STEPS.length - 1);
    render();
    return;
  }

  if (sid === "payment") {
    submitBookingWithPayment();
    return;
  }

  stepIdx = Math.min(stepIdx + 1, STEPS.length - 1);
  render();
}

function retreatStep() {
  stepIdx = Math.max(stepIdx - 1, 0);
  render();
}

function goToStep(id) {
  const idx = STEPS.findIndex(s => s.id === id);
  if (idx >= 0) { stepIdx = idx; render(); }
}

/* ── Guide contextuel ──────────────────────────────────────────────────── */
const GUIDE_MSGS = {
  service:  "Choisissez un service pour commencer votre réservation.",
  employee: "Sélectionnez le prestataire de votre choix (ou laissez-nous choisir).",
  time:     "Choisissez une date sur le calendrier puis un créneau horaire.",
  details:  "Renseignez vos coordonnées pour finaliser la réservation.",
  payment:  "Procédez au paiement pour confirmer votre rendez-vous.",
  confirm:  "Votre rendez-vous est confirmé ! Vous allez recevoir un email.",
};
function updateGuide(sid) {
  const el = document.querySelector(".bk-booking-guide span");
  if (el && GUIDE_MSGS[sid]) el.textContent = GUIDE_MSGS[sid];
}

/* ── Master render ──────────────────────────────────────────────────────── */
function render() {
  renderStepper();
  const sid = stepId();
  updateGuide(sid);
  if (sid === "service")       renderServicePane();
  else if (sid === "employee") renderEmployeePane();
  else if (sid === "time")     renderTimePane();
  else if (sid === "details")  renderDetailsPane();
  else if (sid === "payment")  renderPaymentPane();
  else if (sid === "confirm")  renderConfirmPane();
  renderCart();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ── Helpers ────────────────────────────────────────────────────────────── */
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  const months = __t.months || ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const days   = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ════════════════════════════════════════════════════════════════════════════
   STEP 1 — SERVICE
   ═══════════════════════════════════════════════════════════════════════════ */
function renderSvcCard(s) {
  const sel   = STATE.service && STATE.service.id === s._id ? "is-selected" : "";
  const price = (s.price !== null && s.price !== undefined)
    ? `<div class="bk-svc__price">${s.price}<small>€</small></div>` : "";
  const infoBtn = s.description
    ? `<button class="bk-svc__info-btn" type="button" data-svc-name="${escHtml(s.name)}" data-svc-desc="${escHtml(s.description).replace(/\n/g, '&#10;')}" aria-label="Description du service" tabindex="-1">
        <svg width="15" height="15" viewBox="0 -960 960 960" fill="currentColor"><path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>
      </button>`
    : "";
  return `<div class="bk-svc ${sel}" data-svc="${s._id}">
    <div class="bk-svc__left">
      <div class="bk-svc__name-row">
        <div class="bk-svc__name">${escHtml(s.name)}</div>
        ${infoBtn}
      </div>
      <span class="bk-svc__dur">${s.duration} min</span>
    </div>
    <div class="bk-svc__right">
      ${price}
      <div class="bk-svc__check">
        <svg width="13" height="13" viewBox="0 -960 960 960" fill="currentColor"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>
      </div>
    </div>
  </div>`;
}

/* ── Shared: pick a service card ─────────────────────────────────────────── */
function bindSvcCards(container) {
  container.querySelectorAll("[data-svc]").forEach(el => {
    el.onclick = (e) => {
      // Ne pas sélectionner le service si on clique sur le bouton info
      if (e.target.closest(".bk-svc__info-btn")) return;
      const svc = SERVICES.find(s => s._id === el.dataset.svc);
      if (!svc) return;
      STATE.service  = { id: svc._id, name: svc.name, price: svc.price, duration: svc.duration, category: svc.category || "", type: svc.type || "individual", capacity: svc.capacity || null };
      STATE.employee = undefined;
      STATE.date     = null;
      STATE.time     = null;
      recomputeSteps();
      const svcHasEmps    = (svc.employees || []).length > 0;
      const globalHasEmps = EMPLOYEES.length > 0;
      // Les sessions collectives ne sont pas liées à un employé en particulier.
      if (svc.type !== "group" && (svcHasEmps || globalHasEmps)) goToStep("employee");
      else goToStep("time");
    };
  });

  // Bouton info → ouvre le bottom sheet (sans sélectionner le service)
  container.querySelectorAll(".bk-svc__info-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openSvcDescModal(btn.dataset.svcName, btn.dataset.svcDesc);
    };
  });
}

/* ── Modale description service ──────────────────────────────────────────── */
function openSvcDescModal(name, desc) {
  const old = document.getElementById("svcDescOverlay");
  if (old) old.remove();

  const overlay = document.createElement("div");
  overlay.className = "svc-desc-overlay";
  overlay.id = "svcDescOverlay";
  overlay.innerHTML = `
    <div class="svc-desc-sheet" role="dialog" aria-modal="true" aria-label="${name}">
      <div class="svc-desc-sheet__handle"></div>
      <div class="svc-desc-sheet__header">
        <span class="svc-desc-sheet__name">${name}</span>
        <button class="svc-desc-sheet__close" aria-label="Fermer">
          <svg viewBox="0 -960 960 960" width="16" height="16" fill="currentColor">
            <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
          </svg>
        </button>
      </div>
      <div class="svc-desc-sheet__body">${desc.replace(/&#10;/g, '\n')}</div>
    </div>`;

  document.body.appendChild(overlay);

  function close() { overlay.remove(); }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".svc-desc-sheet__close").addEventListener("click", close);
  document.addEventListener("keydown", function onKey(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
  });
}

/* ── Ordered categories (respects admin-set order from __categoriesMeta) ─── */
function getOrderedCats() {
  const META = window.__categoriesMeta || [];
  // Categories explicitly ordered by admin
  const ordered = META.map(m => m.name).filter(Boolean);
  // Any categories on services not in META (appended at end)
  SERVICES.forEach(s => {
    const cat = (s.category || "").trim();
    if (cat && !ordered.includes(cat)) ordered.push(cat);
  });
  // Only keep cats that actually have services
  return ordered.filter(cat => SERVICES.some(s => (s.category || "").trim() === cat));
}

function renderServicePane() {
  const hasCategories = SERVICES.some(s => s.category && s.category.trim() !== "");
  const style = window.__bookingCategoryStyle || "pills";

  let bodyHtml;

  if (!hasCategories) {
    // No categories → flat grid
    bodyHtml = `<div class="bk-svc-grid">${SERVICES.map(renderSvcCard).join("")}</div>`;
  } else if (style === "accordion") {
    // ── Accordion style ───────────────────────────────────────────────────
    const cats = getOrderedCats();
    const uncategorized = SERVICES.filter(s => !(s.category || "").trim());

    if (STATE._openCat === null && cats.length > 0) STATE._openCat = cats[0];

    const groupsHtml = cats.map(cat => {
      const svcs      = SERVICES.filter(s => (s.category || "").trim() === cat);
      const hasSelSvc = svcs.some(s => STATE.service && STATE.service.id === s._id);
      const isOpen    = STATE._openCat === cat || hasSelSvc;
      return `<div class="bk-cat-group${isOpen ? " is-open" : ""}" data-cat="${escHtml(cat)}">
        <button class="bk-cat-header" type="button" data-toggle-cat="${escHtml(cat)}">
          <span class="bk-cat-name">${escHtml(cat)}</span>
          <span class="bk-cat-count">${svcs.length} service${svcs.length > 1 ? "s" : ""}</span>
          <svg class="bk-cat-arrow" width="16" height="16" viewBox="0 -960 960 960" fill="currentColor">
            <path d="M480-360 280-560l56-56 144 144 144-144 56 56-200 200Z"/>
          </svg>
        </button>
        <div class="bk-cat-body">
          <div class="bk-svc-grid">${svcs.map(renderSvcCard).join("")}</div>
        </div>
      </div>`;
    }).join("");

    const uncatHtml = uncategorized.length > 0
      ? `<div class="bk-svc-grid" style="margin-top:8px">${uncategorized.map(renderSvcCard).join("")}</div>` : "";

    bodyHtml = `<div class="bk-cat-list">${groupsHtml}${uncatHtml}</div>`;

  } else if (style === "grid") {
    // ── Grid style: all services grouped by category label, no filter ─────
    const cats = getOrderedCats();
    const groupsHtml = cats.map(cat => {
      const svcs = SERVICES.filter(s => (s.category || "").trim() === cat);
      return `<div class="bk-cat-section">
        <h3 class="bk-cat-section__title">${escHtml(cat)}</h3>
        <div class="bk-svc-grid">${svcs.map(renderSvcCard).join("")}</div>
      </div>`;
    }).join("");
    const uncategorized = SERVICES.filter(s => !(s.category || "").trim());
    const uncatHtml = uncategorized.length > 0
      ? `<div class="bk-svc-grid" style="margin-top:8px">${uncategorized.map(renderSvcCard).join("")}</div>` : "";
    bodyHtml = `<div class="bk-cat-sections">${groupsHtml}${uncatHtml}</div>`;

  } else {
    // ── Pills style (default) — filter by category ────────────────────────
    const cats = getOrderedCats();

    // If selected service is in a category, pre-select it
    if (STATE._activeCat === null && STATE.service) {
      const selSvc = SERVICES.find(s => s._id === STATE.service.id);
      if (selSvc && selSvc.category && selSvc.category.trim()) {
        STATE._activeCat = selSvc.category.trim();
      }
    }

    const filtered = STATE._activeCat
      ? SERVICES.filter(s => (s.category || "").trim() === STATE._activeCat)
      : SERVICES;

    const pillsHtml = `
      <div class="bk-cat-pills">
        <button class="bk-cat-pill${STATE._activeCat === null ? " is-active" : ""}" data-filter-cat="">Tous</button>
        ${cats.map(cat => `
          <button class="bk-cat-pill${STATE._activeCat === cat ? " is-active" : ""}" data-filter-cat="${escHtml(cat)}">
            ${escHtml(cat)}
          </button>`).join("")}
      </div>`;

    bodyHtml = `${pillsHtml}<div class="bk-svc-grid" id="bkSvcGrid">${filtered.map(renderSvcCard).join("")}</div>`;
  }

  pane.innerHTML = `<div class="bk-pane">
    <h2 class="bk-pane-title">Choisissez un service</h2>
    <p class="bk-pane-sub">Sélectionnez la prestation qui vous convient.</p>
    ${bodyHtml}
  </div>`;

  bindSvcCards(pane);

  // ── Accordion toggles ────────────────────────────────────────────────────
  pane.querySelectorAll("[data-toggle-cat]").forEach(btn => {
    btn.onclick = () => {
      const cat   = btn.dataset.toggleCat;
      const group = btn.closest(".bk-cat-group");
      const isOpen = group.classList.contains("is-open");
      pane.querySelectorAll(".bk-cat-group").forEach(g => g.classList.remove("is-open"));
      if (!isOpen) { group.classList.add("is-open"); STATE._openCat = cat; }
      else STATE._openCat = null;
    };
  });

  // ── Pills filter ─────────────────────────────────────────────────────────
  pane.querySelectorAll("[data-filter-cat]").forEach(btn => {
    btn.onclick = () => {
      STATE._activeCat = btn.dataset.filterCat || null;
      pane.querySelectorAll(".bk-cat-pill").forEach(p => p.classList.remove("is-active"));
      btn.classList.add("is-active");
      const grid = pane.querySelector("#bkSvcGrid");
      if (grid) {
        const toShow = STATE._activeCat
          ? SERVICES.filter(s => (s.category || "").trim() === STATE._activeCat)
          : SERVICES;
        grid.innerHTML = toShow.map(renderSvcCard).join("");
        bindSvcCards(grid);
      }
    };
  });
}

/* ════════════════════════════════════════════════════════════════════════════
   STEP 2 — EMPLOYEE
   ═══════════════════════════════════════════════════════════════════════════ */
function renderEmployeePane() {
  // Use service-specific employees if assigned; otherwise fall back to all
  // active company employees so the step always works when employees exist.
  const svcEmployees = STATE.service
    ? (SERVICES.find(s => s._id === STATE.service.id)?.employees || [])
    : [];
  const employeesToShow = svcEmployees.length > 0 ? svcEmployees : EMPLOYEES;

  pane.innerHTML = `<div class="bk-pane">
    <h2 class="bk-pane-title">Choisissez votre prestataire</h2>
    <p class="bk-pane-sub">Sélectionnez votre préférence ou laissez-nous choisir.</p>
    <div class="bk-emp-grid">
      <!-- "Any" card -->
      <div class="bk-emp bk-emp--skip ${STATE.employee === null ? "is-selected" : ""}" data-emp="any">
        <div class="bk-emp__av" style="font-size:20px; color:var(--bk-muted);">—</div>
        <div class="bk-emp__name">Pas de préférence</div>
        <div class="bk-emp__role" style="color:var(--bk-accent-ink); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.04em;">Plus rapide</div>
      </div>
      ${employeesToShow.map(e => {
        const fullName = `${e.firstName||""} ${e.lastName||""}`.trim();
        const initials = ((e.firstName||"")[0]||"") + ((e.lastName||"")[0]||"");
        const sel = STATE.employee && STATE.employee.id === e._id ? "is-selected" : "";
        const pic = e.profilePicture && e.profilePicture !== "/images/no-user.webp"
          ? `<img src="${escHtml(e.profilePicture)}" alt="${escHtml(fullName)}">`
          : `<span>${escHtml(initials.toUpperCase())}</span>`;
        const role = e.age ? `<div class="bk-emp__role">${e.age} ans</div>` : "";
        const infoBtn = e.description
          ? `<button class="bk-emp__info-btn" type="button" data-emp-name="${escHtml(fullName)}" data-emp-desc="${escHtml(e.description).replace(/\n/g, '&#10;')}" aria-label="À propos" tabindex="-1">
              <svg width="13" height="13" viewBox="0 -960 960 960" fill="currentColor"><path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>
              À propos
            </button>`
          : "";
        return `<div class="bk-emp ${sel}" data-emp="${e._id}">
          <div class="bk-emp__av">${pic}</div>
          <div class="bk-emp__name">${escHtml(fullName)}</div>
          ${role}
          ${infoBtn}
        </div>`;
      }).join("")}
    </div>
  </div>`;

  pane.querySelectorAll("[data-emp]").forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest(".bk-emp__info-btn")) return;
      if (el.dataset.emp === "any") {
        STATE.employee = null; // null = no preference
      } else {
        const emp = employeesToShow.find(e => e._id === el.dataset.emp);
        if (!emp) return;
        STATE.employee = {
          id:      emp._id,
          name:    `${emp.firstName||""} ${emp.lastName||""}`.trim(),
          picture: emp.profilePicture || null,
        };
      }
      goToStep("time");
    };
  });

  pane.querySelectorAll(".bk-emp__info-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openSvcDescModal(btn.dataset.empName, btn.dataset.empDesc);
    };
  });
}

/* ════════════════════════════════════════════════════════════════════════════
   STEP 3 — TIME (Calendar + Slots)
   ═══════════════════════════════════════════════════════════════════════════ */
const realToday = new Date();
realToday.setHours(0,0,0,0);

// Calendar data cache
let _dayOffArray      = null;
let _disabledDays     = null;
let _specificBookings = null;
let _slotTime         = null;
let _calDataLoaded    = false;
let _calLoadedEmpId   = undefined; // track which employee the cache was built for

/**
 * Returns true if the given month (year y, month m 0-based) has at least one
 * day that is not past, not a day-off, and not fully booked.
 */
function monthHasAvailableDay(y, m) {
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const slotT = STATE.service ? STATE.service.duration : (_slotTime || 30);

  for (let d = 1; d <= daysInMonth; d++) {
    const c   = new Date(y, m, d);
    const iso = `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

    if (c < realToday) continue;

    const dayOfWeek = c.getDay();
    const dayConfig = _dayOffArray ? _dayOffArray.find(dc => dc.weekdayIndex === dayOfWeek) : null;
    if (dayConfig && dayConfig.dayOff) continue;

    const exception = _disabledDays ? _disabledDays.find(ex => toDateStr(ex.date) === iso) : null;
    if (exception && (!exception.workingHours || exception.workingHours.length === 0)) continue;

    // Working hours
    let activeWH = [];
    if (exception && exception.workingHours) activeWH = exception.workingHours;
    else if (dayConfig && !dayConfig.dayOff)  activeWH = dayConfig.workingHours || [];

    if (activeWH.length === 0 && !exception) continue; // no schedule = closed

    const maxSlots   = countPossibleSlots(activeWH, slotT);
    const bookedCount = _specificBookings ? _specificBookings.filter(b => toDateStr(b.date) === iso).length : 0;
    const markedFull  = _specificBookings ? _specificBookings.find(b => toDateStr(b.date) === iso && b.isFull) : false;

    if (maxSlots > 0 && bookedCount >= maxSlots) continue;
    if (markedFull) continue;

    return true; // found at least one available day
  }
  return false;
}

async function loadCalendarData() {
  const empId = STATE.employee ? STATE.employee.id : "";
  // Invalidate cache if the employee changed since last load
  if (_calDataLoaded && _calLoadedEmpId === empId) return;

  _calDataLoaded  = false;
  _calLoadedEmpId = empId;

  const empParam = empId ? `?employeeId=${empId}` : "";

  const [daysOffRes, disabledRes, bookingsRes, infoRes] = await Promise.all([
    fetch("/get-days-off", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ COMPANY_ID }) }),
    fetch(`/get-disabled-days/${COMPANY_ID}${empParam}`),
    fetch(`/get-booking/${COMPANY_ID}`),
    fetch(`/company/get-infos/${COMPANY_ID}`),
  ]);
  const daysOffData   = await daysOffRes.json();
  _dayOffArray        = daysOffData.result.schedule;
  _disabledDays       = await disabledRes.json();
  _specificBookings   = await bookingsRes.json();
  const info          = await infoRes.json();
  _slotTime           = info.slotTime || 30;
  _calDataLoaded      = true;
}

function countPossibleSlots(workingHours, slotTime) {
  if (!workingHours || workingHours.length === 0) return 0;
  let count = 0;
  workingHours.forEach(p => {
    const [sh, sm] = p.start.split(":").map(Number);
    const [eh, em] = p.end.split(":").map(Number);
    count += Math.floor((eh*60+em - (sh*60+sm)) / slotTime);
  });
  return count;
}

function toDateStr(d) {
  return new Date(d).toISOString().split("T")[0];
}

function buildCalendar() {
  const y = STATE.calMonth.getFullYear();
  const m = STATE.calMonth.getMonth();
  const dows = (__t.weekdays_abbr && __t.weekdays_abbr.length === 7)
    ? __t.weekdays_abbr
    : ["Lu","Ma","Me","Je","Ve","Sa","Di"];
  const months = __t.months || ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

  const firstDow    = (new Date(y, m, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const cells       = [];

  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));

  while (cells.length % 7 !== 0) cells.push(null);

  const isCurrentMonth = y === realToday.getFullYear() && m === realToday.getMonth();
  const monthLabel     = `${months[m]} ${y}`;

  return `<div class="bk-cal">
    <div class="bk-cal-head">
      <h3>${monthLabel}</h3>
      <div class="bk-cal-nav">
        <button class="bk-icon-btn" id="calPrev" ${isCurrentMonth ? "disabled" : ""} aria-label="Mois précédent">
          <svg width="13" height="13" viewBox="0 -960 960 960" fill="currentColor"><path d="M560-240 320-480l240-240 56 56-184 184 184 184-56 56Z"/></svg>
        </button>
        <button class="bk-icon-btn" id="calNext" aria-label="Mois suivant">
          <svg width="13" height="13" viewBox="0 -960 960 960" fill="currentColor"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></svg>
        </button>
      </div>
    </div>
    <div class="bk-cal-grid">
      ${dows.map(d => `<div class="bk-cal-dow">${d}</div>`).join("")}
      ${cells.map(c => {
        if (!c) return `<div class="bk-cal-cell is-empty"></div>`;
        const iso      = `${c.getFullYear()}-${String(c.getMonth()+1).padStart(2,"0")}-${String(c.getDate()).padStart(2,"0")}`;
        const dayOfWeek = c.getDay();
        const isPast    = c < realToday;

        // Day off config
        const dayConfig = _dayOffArray ? _dayOffArray.find(d => d.weekdayIndex === dayOfWeek) : null;
        const isDayOff  = dayConfig && dayConfig.dayOff;

        // Exception (specific date override)
        const exception = _disabledDays ? _disabledDays.find(d => toDateStr(d.date) === iso) : null;

        // Working hours for this day
        let activeWH = [];
        if (exception && exception.workingHours) activeWH = exception.workingHours;
        else if (dayConfig && !dayConfig.dayOff)  activeWH = dayConfig.workingHours || [];

        // Full day (all slots booked)
        const slotT = STATE.service ? STATE.service.duration : (_slotTime || 30);
        const maxSlots = countPossibleSlots(activeWH, slotT);
        const bookedCount = _specificBookings ? _specificBookings.filter(b => toDateStr(b.date) === iso).length : 0;
        const isFull = maxSlots > 0 && bookedCount >= maxSlots;
        const markedFull = _specificBookings ? _specificBookings.find(b => toDateStr(b.date) === iso && b.isFull) : false;
        // "si un jour est full met le en rouge et si la moitié des rdv est
        // pris met orange" — taux de remplissage du jour, affiché en couleur
        // pour donner un repère visuel rapide avant même d'ouvrir le créneau.
        const fillRatio = maxSlots > 0 ? (bookedCount / maxSlots) : 0;
        const isHalfBooked = !isFull && !markedFull && fillRatio >= 0.5;

        const isDisabled = isPast || isDayOff || (exception && (!exception.workingHours || exception.workingHours.length === 0));
        const isToday    = c.getTime() === realToday.getTime();
        const isSelected = STATE.date === iso;

        let cls = "bk-cal-cell";
        if (isDisabled)      cls += " is-disabled";
        else if (isFull || markedFull) cls += " is-full";
        else if (isHalfBooked) cls += " is-busy";
        if (isToday)         cls += " is-today";
        if (isSelected)      cls += " is-selected";

        const clickable = !isDisabled && !isFull && !markedFull;
        return `<div class="${cls}" ${clickable ? `data-date="${iso}"` : ""}>${c.getDate()}</div>`;
      }).join("")}
    </div>
  </div>`;
}

function buildSlotsPanel(slots) {
  if (!STATE.date) {
    return `<div class="bk-slots">
      <h3>Créneaux disponibles</h3>
      <p class="bk-slots__sub">Sélectionnez une date sur le calendrier.</p>
      <div class="bk-slots__empty">← Choisissez un jour</div>
    </div>`;
  }

  const dayparts = [
    ["all","Tous"],["morning","Matin"],["afternoon","Après-midi"],["evening","Soir"]
  ];

  const by = t => {
    const h = parseInt(t.split(":")[0], 10);
    if (STATE.daypart === "morning")   return h < 12;
    if (STATE.daypart === "afternoon") return h >= 12 && h < 17;
    if (STATE.daypart === "evening")   return h >= 17;
    return true;
  };

  const visible   = slots.filter(s => by(s.time));
  const available = visible.filter(s => !s.taken && !s.isPast).length;

  // Regroupement actif uniquement s'il y a déjà au moins un RDV ce jour-là
  // (le serveur ne renvoie des créneaux recommandés que dans ce cas).
  const groupingOn = _smartGrouping.active;

  const renderSlotBtn = s => {
    const remainingHtml = (s.remaining !== undefined && !s.taken && !s.isPast)
      ? `<span class="bk-slot__spots">${s.remaining} place${s.remaining > 1 ? "s" : ""}</span>` : "";
    const isReco = groupingOn && s.recommended && !s.taken && !s.isPast;
    return `<button class="bk-slot ${s.taken?"is-disabled":""} ${s.isPast?"is-past":""} ${STATE.time===s.time?"is-selected":""} ${isReco?"is-recommended":""}"
      data-time="${s.time}" ${s.taken?"disabled":""}>${s.time}${remainingHtml}</button>`;
  };
  const mainSlots  = groupingOn ? visible.filter(s => s.taken || s.isPast || s.recommended) : visible;
  const extraSlots = groupingOn ? visible.filter(s => !s.taken && !s.isPast && !s.recommended) : [];

  return `<div class="bk-slots">
    <h3>${fmtDate(STATE.date)}</h3>
    <p class="bk-slots__sub">${available} créneaux disponibles</p>
    ${groupingOn ? `<p class="bk-slots__grouping-hint">🧩 On vous propose d'abord les horaires proches d'un rendez-vous déjà prévu ce jour-là.</p>` : ""}
    <div class="bk-dayparts">
      ${dayparts.map(([id,lbl]) => `<button class="bk-daypart ${STATE.daypart===id?"is-active":""}" data-dp="${id}">${lbl}</button>`).join("")}
    </div>
    <div class="bk-slot-list ${STATE.service && STATE.service.type === "group" ? "bk-slot-list--group" : ""}">
      ${mainSlots.length === 0 && extraSlots.length === 0
        ? `<div style="grid-column:1/-1; text-align:center; color:var(--bk-muted); font-size:12.5px; padding:20px 0;">Aucun créneau</div>`
        : mainSlots.map(renderSlotBtn).join("")
      }
    </div>
    ${extraSlots.length > 0 ? `
    <button class="bk-slots__more" id="bkSlotsMore" type="button" aria-expanded="false">
      <span>Voir ${extraSlots.length} créneau${extraSlots.length > 1 ? "x" : ""} supplémentaire${extraSlots.length > 1 ? "s" : ""}</span>
      <svg viewBox="0 -960 960 960" width="14" height="14" fill="currentColor"><path d="M480-345 240-585l56-56 184 184 184-184 56 56-240 240Z"/></svg>
    </button>
    <div class="bk-slot-list bk-slot-list--extra ${STATE.service && STATE.service.type === "group" ? "bk-slot-list--group" : ""}" id="bkSlotsExtra" style="display:none">
      ${extraSlots.map(renderSlotBtn).join("")}
    </div>` : ""}
  </div>`;
}

let _currentSlots = [];
let _smartGrouping = { active: false, recommended: new Set() };

async function renderTimePane() {
  pane.innerHTML = `<div class="bk-pane">
    <h2 class="bk-pane-title">Choisissez votre créneau</h2>
    <p class="bk-pane-sub">Heure de Bruxelles (GMT+1).</p>
    <div class="bk-booker">
      <div class="bk-loading"><div class="bk-spinner"></div> Chargement…</div>
    </div>
  </div>`;

  await loadCalendarData();

  // Si le mois courant n'a plus de jours disponibles, avancer au prochain mois disponible
  // (max 12 mois pour ne pas boucler infiniment)
  let guard = 0;
  while (
    guard++ < 12 &&
    !monthHasAvailableDay(STATE.calMonth.getFullYear(), STATE.calMonth.getMonth())
  ) {
    STATE.calMonth = new Date(STATE.calMonth.getFullYear(), STATE.calMonth.getMonth() + 1, 1);
  }

  refreshTimePane();
}

function refreshTimePane() {
  const calHtml   = buildCalendar();
  const slotsHtml = buildSlotsPanel(_currentSlots);

  pane.innerHTML = `<div class="bk-pane">
    <h2 class="bk-pane-title">Choisissez votre créneau</h2>
    <p class="bk-pane-sub">Heure de Bruxelles (GMT+1).</p>
    <div class="bk-booker">
      ${calHtml}
      ${slotsHtml}
    </div>
  </div>`;

  bindTimePane();
}

function bindTimePane() {
  // Month nav
  const prev = document.getElementById("calPrev");
  const next = document.getElementById("calNext");
  if (prev) prev.onclick = () => {
    STATE.calMonth = new Date(STATE.calMonth.getFullYear(), STATE.calMonth.getMonth()-1, 1);
    refreshTimePane();
  };
  if (next) next.onclick = () => {
    STATE.calMonth = new Date(STATE.calMonth.getFullYear(), STATE.calMonth.getMonth()+1, 1);
    refreshTimePane();
  };

  // Day click
  pane.querySelectorAll("[data-date]").forEach(el => {
    el.onclick = async () => {
      STATE.date = el.dataset.date;
      STATE.time = null;

      // Highlight selected day immediately
      pane.querySelectorAll("[data-date]").forEach(d => d.classList.remove("is-selected"));
      el.classList.add("is-selected");

      // Update slots panel with loading
      const slotWrap = pane.querySelector(".bk-slots");
      if (slotWrap) slotWrap.innerHTML = `<div class="bk-loading"><div class="bk-spinner"></div> Chargement…</div>`;

      // Fetch slots
      await fetchSlots();
    };
  });

  // Daypart buttons
  pane.querySelectorAll("[data-dp]").forEach(el => {
    el.onclick = () => {
      STATE.daypart = el.dataset.dp;
      const slotWrap = pane.querySelector(".bk-slots");
      if (slotWrap) slotWrap.outerHTML = buildSlotsPanel(_currentSlots);
      bindSlots();
      bindDayparts();
    };
  });

  // Slot buttons
  bindSlots();
}

function bindSlots() {
  pane.querySelectorAll("[data-time]").forEach(el => {
    el.onclick = () => {
      if (el.disabled) return;
      STATE.time = el.dataset.time;
      pane.querySelectorAll("[data-time]").forEach(s => s.classList.remove("is-selected"));
      el.classList.add("is-selected");
      renderCart();
    };
  });

  // Regroupement des rendez-vous : déplier les créneaux plus éloignés
  const moreBtn = document.getElementById("bkSlotsMore");
  const extraWrap = document.getElementById("bkSlotsExtra");
  if (moreBtn && extraWrap) {
    moreBtn.onclick = () => {
      const isOpen = extraWrap.style.display !== "none";
      extraWrap.style.display = isOpen ? "none" : "";
      moreBtn.classList.toggle("is-open", !isOpen);
      moreBtn.setAttribute("aria-expanded", String(!isOpen));
    };
  }
}

function bindDayparts() {
  pane.querySelectorAll("[data-dp]").forEach(el => {
    el.onclick = () => {
      STATE.daypart = el.dataset.dp;
      const slotWrap = pane.querySelector(".bk-slots");
      if (slotWrap) slotWrap.outerHTML = buildSlotsPanel(_currentSlots);
      bindSlots();
      bindDayparts();
    };
  });
}

async function fetchSlots() {
  if (!STATE.date) return;

  const dayOfWeek = new Date(STATE.date + "T00:00:00").getDay();
  const empId     = STATE.employee ? STATE.employee.id : "";
  const serviceDur = STATE.service ? STATE.service.duration : null;
  const serviceId  = STATE.service ? STATE.service.id : "";
  const isGroupService = STATE.service && STATE.service.type === "group";

  const [slotsRes, bookedRes] = await Promise.all([
    fetch("/get-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: dayOfWeek, COMPANY_ID, date: STATE.date, serviceDuration: serviceDur, employeeId: empId }),
    }),
    fetch(`/get-booking?date=${STATE.date}&companyId=${COMPANY_ID}&employeeId=${empId}${serviceDur ? `&serviceDuration=${serviceDur}` : ""}${serviceId ? `&serviceId=${serviceId}` : ""}`),
  ]);

  const slotsData  = await slotsRes.json();
  const bookedData = await bookedRes.json();
  const booked     = new Set(bookedData.bookedTimes || []);
  const groupAvailability = bookedData.groupAvailability || {};
  const groupCapacity     = bookedData.capacity || (STATE.service ? STATE.service.capacity : null);

  // ── Regroupement des rendez-vous : si l'admin a activé l'option, le serveur
  // renvoie les créneaux "proches" d'un RDV déjà confirmé ce jour-là — on les
  // met en avant et on replie le reste sous "Voir plus d'horaires".
  const recommendedTimes = bookedData.recommendedTimes;
  _smartGrouping.active = Array.isArray(recommendedTimes) && recommendedTimes.length > 0;
  _smartGrouping.recommended = new Set(recommendedTimes || []);

  // Calculer l'heure actuelle locale (pour masquer les créneaux passés si c'est aujourd'hui)
  const nowLocal    = new Date();
  const todayIso    = nowLocal.getFullYear() + "-"
    + String(nowLocal.getMonth() + 1).padStart(2, "0") + "-"
    + String(nowLocal.getDate()).padStart(2, "0");
  const isToday     = STATE.date === todayIso;
  const nowMinutes  = nowLocal.getHours() * 60 + nowLocal.getMinutes();

  _currentSlots = (slotsData.slots || []).map(t => {
    const [h, m]    = t.split(":").map(Number);
    const slotMin   = h * 60 + m;
    // Créneau passé si c'est aujourd'hui ET que l'heure est déjà dépassée
    const isPast    = isToday && slotMin <= nowMinutes;
    const slot = { time: t, taken: booked.has(t) || isPast, isPast, recommended: _smartGrouping.recommended.has(t) };
    if (isGroupService && groupCapacity) {
      const booked2 = groupAvailability[t] ? groupAvailability[t].booked : 0;
      slot.remaining = Math.max(0, groupCapacity - booked2);
      slot.capacity  = groupCapacity;
    }
    return slot;
  });

  // Re-render just the slots panel
  const slotWrap = pane.querySelector(".bk-slots, .bk-loading");
  if (slotWrap) {
    slotWrap.outerHTML = buildSlotsPanel(_currentSlots);
    bindSlots();
    bindDayparts();
  }
  renderCart();
}

/* ════════════════════════════════════════════════════════════════════════════
   STEP 4 — DETAILS (personal info + pre-booking form)
   ═══════════════════════════════════════════════════════════════════════════ */
async function renderDetailsPane() {
  // Load pre-booking form if not yet loaded
  if (STATE.activeForm === null) {
    try {
      const r = await fetch(`/get-form/${COMPANY_ID}`);
      const d = await r.json();
      STATE.activeForm = (d.form && d.form.active && d.form.questions && d.form.questions.length > 0)
        ? d.form : false;
    } catch (_) { STATE.activeForm = false; }
  }

  const f = STATE.form;
  const isLoggedIn = !!CLIENT;

  const questionsHtml = STATE.activeForm
    ? `<div class="bk-questions" id="bkQuestions">
        ${STATE.activeForm.questions.map((q, i) => {
          let inputHtml = "";
          if (q.type === "text") {
            // Pas de limite ici avant -> un client pouvait coller un pavé de
            // texte interminable, qui débordait ensuite de son champ ET de
            // l'écran de confirmation ("limite les caractères ici car
            // sinon…"). On aligne sur la limite du champ "Message" (500).
            inputHtml = `<input class="bk-input bk-choice-input" data-qi="${i}" type="text" maxlength="500" placeholder="" />`;
          } else if (q.type === "yes_no") {
            const yes = __t.yes || "Oui";
            const no  = __t.no  || "Non";
            inputHtml = `<div class="bk-yesno" data-qi="${i}">
              <button class="bk-yesno-btn" type="button" data-val="yes">${yes}</button>
              <button class="bk-yesno-btn" type="button" data-val="no">${no}</button>
            </div>`;
          } else if (q.type === "choice" && q.options && q.options.length) {
            inputHtml = `<div class="bk-choices" data-qi="${i}">
              ${q.options.map(opt => `<button class="bk-choice-btn" type="button" data-val="${escHtml(opt)}">${escHtml(opt)}</button>`).join("")}
            </div>`;
          }
          return `<div class="bk-question" data-index="${i}" data-type="${q.type}" data-required="${q.required ? 'true' : 'false'}">
            <label>${escHtml(q.label)}${q.required ? ' <span class="req">✱</span>' : ""}</label>
            ${inputHtml}
          </div>`;
        }).join("")}
      </div>`
    : "";

  pane.innerHTML = `<div class="bk-pane">
    <div class="bk-form-wrap">
      <h2 class="bk-form-title">Presque terminé</h2>
      <p class="bk-form-sub">Quelques informations avant de confirmer votre réservation.</p>

      ${isLoggedIn ? `
        <div class="bk-client-info">
          <div class="bk-client-info__av">${((CLIENT.firstName||"")[0]||"").toUpperCase()}</div>
          <div>
            <div class="bk-client-info__name">${escHtml((CLIENT.firstName||"") + " " + (CLIENT.lastName||""))}</div>
            <div class="bk-client-info__email">${escHtml(CLIENT.email||"")}</div>
          </div>
        </div>` : `

        <!-- Connexion client inline -->
        <div class="bk-login-section" id="bkLoginSection">
          <div class="bk-login-header">
            <div class="bk-login-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <div>
              <p class="bk-login-title">Déjà un compte ?</p>
              <p class="bk-login-sub">Connectez-vous pour pré-remplir vos informations.</p>
            </div>
          </div>
          <!-- Connexion -->
          <div class="bk-login-form" id="bkLoginForm" style="display:none">
            <a class="bk-google-btn" href="/auth/google/client?returnTo=${encodeURIComponent(window.location.href)}">
              <svg width="17" height="17" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.6h12.4c-.5 2.7-2.1 5-4.5 6.5v5.4h7.3c4.3-3.9 6.9-9.7 6.9-16z"/>
                <path fill="#34A853" d="M24 47c6.5 0 12-2.1 16-5.8l-7.3-5.4c-2.1 1.4-4.8 2.2-8.7 2.2-6.7 0-12.4-4.5-14.4-10.6H2v5.6C6 41.8 14.4 47 24 47z"/>
                <path fill="#FBBC05" d="M9.6 27.4c-.5-1.4-.8-3-.8-4.4s.3-3 .8-4.4V13H2C.7 15.6 0 18.7 0 24s.7 8.4 2 11l7.6-7.6z"/>
                <path fill="#EA4335" d="M24 9.5c3.8 0 7.2 1.3 9.9 3.8l7.3-7.3C36.9 2.1 31.4 0 24 0 14.4 0 6 5.2 2 13l7.6 7.6C11.6 14 17.3 9.5 24 9.5z"/>
              </svg>
              Continuer avec Google
            </a>
            <div class="bk-login-divider"><span>ou</span></div>
            <div class="bk-field">
              <label class="bk-label">Email</label>
              <input class="bk-input" id="bkLoginEmail" type="email" placeholder="jean@email.com" autocomplete="email" />
            </div>
            <div class="bk-field">
              <label class="bk-label">Mot de passe</label>
              <input class="bk-input" id="bkLoginPassword" type="password" placeholder="••••••••" autocomplete="current-password" />
            </div>
            <p class="bk-login-error" id="bkLoginError" style="display:none"></p>
            <button class="bk-login-submit" id="bkLoginSubmit" type="button">Se connecter</button>
            <button class="bk-login-back" id="bkBackFromLogin" type="button">← Retour</button>
          </div>

          <!-- Inscription rapide -->
          <div class="bk-login-form" id="bkRegisterForm" style="display:none">
            <a class="bk-google-btn" href="/auth/google/client?returnTo=${encodeURIComponent(window.location.href)}">
              <svg width="17" height="17" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.6h12.4c-.5 2.7-2.1 5-4.5 6.5v5.4h7.3c4.3-3.9 6.9-9.7 6.9-16z"/>
                <path fill="#34A853" d="M24 47c6.5 0 12-2.1 16-5.8l-7.3-5.4c-2.1 1.4-4.8 2.2-8.7 2.2-6.7 0-12.4-4.5-14.4-10.6H2v5.6C6 41.8 14.4 47 24 47z"/>
                <path fill="#FBBC05" d="M9.6 27.4c-.5-1.4-.8-3-.8-4.4s.3-3 .8-4.4V13H2C.7 15.6 0 18.7 0 24s.7 8.4 2 11l7.6-7.6z"/>
                <path fill="#EA4335" d="M24 9.5c3.8 0 7.2 1.3 9.9 3.8l7.3-7.3C36.9 2.1 31.4 0 24 0 14.4 0 6 5.2 2 13l7.6 7.6C11.6 14 17.3 9.5 24 9.5z"/>
              </svg>
              S'inscrire avec Google
            </a>
            <div class="bk-login-divider"><span>ou</span></div>
            <div class="bk-reg-row">
              <div class="bk-field">
                <label class="bk-label">Prénom *</label>
                <input class="bk-input" id="bkRegFirst" type="text" placeholder="Jean" autocomplete="given-name" />
              </div>
              <div class="bk-field">
                <label class="bk-label">Nom *</label>
                <input class="bk-input" id="bkRegLast" type="text" placeholder="Dupont" autocomplete="family-name" />
              </div>
            </div>
            <div class="bk-field">
              <label class="bk-label">Email *</label>
              <input class="bk-input" id="bkRegEmail" type="email" placeholder="jean@email.com" autocomplete="email" />
            </div>
            <div class="bk-field">
              <label class="bk-label">Mot de passe *</label>
              <input class="bk-input" id="bkRegPwd" type="password" placeholder="8 caractères minimum" autocomplete="new-password" />
            </div>
            <p class="bk-login-error" id="bkRegError" style="display:none"></p>
            <button class="bk-login-submit" id="bkRegSubmit" type="button">Créer mon compte et réserver</button>
            <button class="bk-login-back" id="bkBackFromReg" type="button">← Retour</button>
          </div>

          <!-- Boutons choix -->
          <div class="bk-login-toggle" id="bkLoginChoices">
            <button class="bk-login-toggle-btn" id="bkShowLogin" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Se connecter
            </button>
            <button class="bk-login-toggle-btn bk-login-toggle-btn--outline" id="bkShowRegister" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
              Créer un compte
            </button>
            <button class="bk-login-toggle-btn bk-login-toggle-btn--ghost" id="bkShowGuest" type="button">Continuer sans compte</button>
          </div>
        </div>

        <!-- Formulaire invité (masqué par défaut) -->
        <div id="bkGuestForm" style="display:none">
          <div class="bk-form-row">
            <div class="bk-field">
              <label class="bk-label">Prénom *</label>
              <input class="bk-input" id="bkFirstName" type="text" maxlength="50" placeholder="Jean" value="${escHtml(f.firstName)}" />
            </div>
            <div class="bk-field">
              <label class="bk-label">Nom *</label>
              <input class="bk-input" id="bkLastName" type="text" maxlength="50" placeholder="Dupont" value="${escHtml(f.lastName)}" />
            </div>
          </div>
          <div class="bk-field">
            <label class="bk-label">Email *</label>
            <input class="bk-input" id="bkEmail" type="email" maxlength="100" placeholder="jean@email.com" value="${escHtml(f.email)}" />
          </div>
          <div class="bk-field">
            <label class="bk-label">Téléphone</label>
            <input class="bk-input" id="bkPhone" type="tel" maxlength="30" placeholder="+32 …" value="${escHtml(f.phone)}" />
          </div>
        </div>`}

      ${questionsHtml}

      <div class="bk-field">
        <label class="bk-label">Message (optionnel)</label>
        <textarea class="bk-textarea" id="bkMessage" rows="3" maxlength="500" placeholder="Informations utiles…">${escHtml(f.message)}</textarea>
      </div>

      <div class="bk-policy">
        <strong>Politique d'annulation.</strong>
        Vous pouvez modifier ou annuler gratuitement jusqu'à 24h avant votre rendez-vous.
      </div>
    </div>
  </div>`;

  bindDetailsPane();
}

function bindDetailsPane() {
  // ── Inline login (non-logged-in flow) ────────────────────────────────────
  const showLoginBtn  = document.getElementById("bkShowLogin");
  const showGuestBtn  = document.getElementById("bkShowGuest");
  const loginSection  = document.getElementById("bkLoginSection");
  const loginForm     = document.getElementById("bkLoginForm");
  const guestForm     = document.getElementById("bkGuestForm");
  const loginSubmit   = document.getElementById("bkLoginSubmit");
  const loginError    = document.getElementById("bkLoginError");

  const loginChoices  = document.getElementById("bkLoginChoices");
  const registerForm  = document.getElementById("bkRegisterForm");

  // Intercepter les boutons Google pour sauvegarder l'état avant la redirection
  pane.querySelectorAll(".bk-google-btn").forEach(btn => {
    btn.addEventListener("click", () => saveStateForOAuth());
  });

  function showChoices() {
    if (loginForm)    loginForm.style.display    = "none";
    if (registerForm) registerForm.style.display = "none";
    if (loginChoices) loginChoices.style.display = "flex";
  }

  if (showLoginBtn) {
    showLoginBtn.addEventListener("click", () => {
      loginChoices.style.display = "none";
      loginForm.style.display    = "flex";
      document.getElementById("bkLoginEmail")?.focus();
    });
  }

  document.getElementById("bkShowRegister")?.addEventListener("click", () => {
    loginChoices.style.display  = "none";
    registerForm.style.display  = "flex";
    document.getElementById("bkRegFirst")?.focus();
  });

  document.getElementById("bkBackFromLogin")?.addEventListener("click", showChoices);
  document.getElementById("bkBackFromReg")?.addEventListener("click", showChoices);

  if (showGuestBtn) {
    showGuestBtn.addEventListener("click", () => {
      loginSection.style.display = "none";
      guestForm.style.display    = "block";
      renderCart();
    });
  }

  if (loginSubmit) {
    loginSubmit.addEventListener("click", async () => {
      const email    = document.getElementById("bkLoginEmail")?.value.trim();
      const password = document.getElementById("bkLoginPassword")?.value;
      if (!email || !password) {
        loginError.textContent = "Veuillez remplir tous les champs.";
        loginError.style.display = "block";
        return;
      }
      loginSubmit.disabled = true;
      loginSubmit.textContent = "Connexion…";
      loginError.style.display = "none";
      try {
        const res  = await fetch("/client/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (data.success) {
          // Fetch client info from session
          const meRes  = await fetch("/client/me", { headers: { "X-Requested-With": "fetch" } });
          const meData = await meRes.json();
          if (meData.client) {
            CLIENT = meData.client;
            STATE.form.firstName = CLIENT.firstName || "";
            STATE.form.lastName  = CLIENT.lastName  || "";
            STATE.form.email     = CLIENT.email     || "";
            STATE.form.phone     = CLIENT.phone     || "";
          }
          renderDetailsPane(); // re-render showing logged-in state
        } else {
          loginError.textContent = data.error || "Email ou mot de passe incorrect.";
          loginError.style.display = "block";
          loginSubmit.disabled = false;
          loginSubmit.textContent = "Se connecter";
        }
      } catch (_) {
        loginError.textContent = "Erreur réseau. Réessayez.";
        loginError.style.display = "block";
        loginSubmit.disabled = false;
        loginSubmit.textContent = "Se connecter";
      }
    });

    // Enter key on password field
    document.getElementById("bkLoginPassword")?.addEventListener("keydown", e => {
      if (e.key === "Enter") loginSubmit.click();
    });
  }

  // ── Register handler ──────────────────────────────────────────────────────
  const regSubmit = document.getElementById("bkRegSubmit");
  const regError  = document.getElementById("bkRegError");

  if (regSubmit) {
    regSubmit.addEventListener("click", async () => {
      const first = document.getElementById("bkRegFirst")?.value.trim();
      const last  = document.getElementById("bkRegLast")?.value.trim();
      const email = document.getElementById("bkRegEmail")?.value.trim();
      const pwd   = document.getElementById("bkRegPwd")?.value || "";

      if (!first || !last || !email) {
        regError.textContent = "Prénom, nom et email sont obligatoires.";
        regError.style.display = "block"; return;
      }
      if (pwd.length < 8) {
        regError.textContent = "Le mot de passe doit faire au moins 8 caractères.";
        regError.style.display = "block"; return;
      }
      regSubmit.disabled = true;
      regSubmit.textContent = "Création…";
      regError.style.display = "none";

      try {
        const res  = await fetch("/client/register", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
          body: JSON.stringify({ fullName: `${first} ${last}`, email, password: pwd, confirmPassword: pwd }),
        });
        const data = await res.json();
        if (data.success) {
          CLIENT = { firstName: first, lastName: last, email, phone: "" };
          STATE.form.firstName = first;
          STATE.form.lastName  = last;
          STATE.form.email     = email;
          renderDetailsPane();
        } else {
          regError.textContent = data.error || "Une erreur est survenue.";
          regError.style.display = "block";
          regSubmit.disabled = false;
          regSubmit.textContent = "Créer mon compte et réserver";
        }
      } catch (_) {
        regError.textContent = "Erreur réseau. Réessayez.";
        regError.style.display = "block";
        regSubmit.disabled = false;
        regSubmit.textContent = "Créer mon compte et réserver";
      }
    });

    document.getElementById("bkRegPwd")?.addEventListener("keydown", e => {
      if (e.key === "Enter") regSubmit.click();
    });
  }

  // ── Personal info inputs — sync to STATE.form ─────────────────────────────
  const fields = [
    ["bkFirstName", "firstName"],
    ["bkLastName",  "lastName"],
    ["bkEmail",     "email"],
    ["bkPhone",     "phone"],
    ["bkMessage",   "message"],
  ];
  fields.forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => {
      STATE.form[key] = el.value;
      if (el.classList.contains("field-error")) el.classList.remove("field-error");
      renderCart();
    });
  });
  // Message (always present)
  const msgEl = document.getElementById("bkMessage");
  if (msgEl) msgEl.addEventListener("input", () => { STATE.form.message = msgEl.value; });

  // Yes/No buttons
  pane.querySelectorAll(".bk-yesno").forEach(wrap => {
    wrap.querySelectorAll(".bk-yesno-btn").forEach(btn => {
      btn.onclick = () => {
        wrap.querySelectorAll(".bk-yesno-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      };
    });
  });

  // Choice buttons
  pane.querySelectorAll(".bk-choices").forEach(wrap => {
    wrap.querySelectorAll(".bk-choice-btn").forEach(btn => {
      btn.onclick = () => {
        wrap.querySelectorAll(".bk-choice-btn").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
      };
    });
  });
}

function collectFormAnswers() {
  const answers = [];
  if (!STATE.activeForm) return answers;
  pane.querySelectorAll(".bk-question").forEach((q, i) => {
    const formQ = STATE.activeForm.questions[i];
    if (!formQ) return;
    let answer = "";
    if (formQ.type === "text") {
      const inp = q.querySelector(".bk-choice-input");
      answer = inp ? inp.value.trim() : "";
    } else if (formQ.type === "yes_no") {
      const sel = q.querySelector(".bk-yesno-btn.selected");
      answer = sel ? sel.dataset.val : "";
    } else if (formQ.type === "choice") {
      const sel = q.querySelector(".bk-choice-btn.selected");
      answer = sel ? sel.dataset.val : "";
    }
    answers.push({ question: formQ.label, answer, required: !!formQ.required });
  });
  return answers;
}

function validateDetails() {
  if (CLIENT) return true; // logged in, no need to validate personal fields

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let ok = true;

  ["bkFirstName","bkLastName","bkEmail"].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.value.trim()) { el.classList.add("field-error"); ok = false; }
  });

  const emailEl = document.getElementById("bkEmail");
  if (emailEl && emailEl.value.trim() && !emailPattern.test(emailEl.value.trim())) {
    emailEl.classList.add("field-error");
    ok = false;
  }

  // Required pre-booking questions
  if (STATE.activeForm) {
    pane.querySelectorAll(".bk-question[data-required='true']").forEach(q => {
      const type = q.dataset.type;
      let answered = false;
      if (type === "text")   answered = !!(q.querySelector(".bk-choice-input")?.value?.trim());
      if (type === "yes_no") answered = !!q.querySelector(".bk-yesno-btn.selected");
      if (type === "choice") answered = !!q.querySelector(".bk-choice-btn.selected");
      if (!answered) {
        // Outline only the input element, not the whole question block
        const input = q.querySelector(".bk-choice-input, .bk-yesno, .bk-choices");
        if (input) {
          input.style.outline = "2px solid #ef4444";
          input.style.borderRadius = "8px";
          input.addEventListener("input", () => { input.style.outline = ""; }, { once: true });
          input.addEventListener("click", () => { input.style.outline = ""; }, { once: true });
        }
        ok = false;
      }
    });
  }

  return ok;
}

/* ════════════════════════════════════════════════════════════════════════════
   PAYMENT STEP
   ═══════════════════════════════════════════════════════════════════════════ */

function renderPaymentPane() {
  const pane = document.getElementById("bkPane");
  const price      = STATE.service?.price;
  const priceLabel = price !== null && price !== undefined ? `${Number(price).toFixed(2)} €` : "";
  // La carte est obligatoire soit parce que le prépaiement est activé,
  // soit parce que la politique d'annulation de l'établissement exige
  // une carte enregistrée en garantie (sans prélèvement immédiat).
  const policyRequiresCard = cardRequiredByPolicy();
  const isRequired = PREPAYMENT.required || policyRequiresCard;

  // Build the list of available payment methods from admin config
  const methods = [];
  if (PREPAYMENT.stripeActive && STRIPE_KEY) {
    methods.push("online");
  }
  if (PREPAYMENT.paypal && PREPAYMENT.paypalMe) {
    methods.push("paypal");
  }
  if (PREPAYMENT.bankTransfer) {
    methods.push("bank_transfer");
  }
  if (PREPAYMENT.cash || PREPAYMENT.cardOnSite) {
    methods.push("on_site");
  }

  // Si la carte n'est requise que pour la garantie d'annulation (prépaiement
  // non activé), on ne propose que la carte — pas de choix entre plusieurs
  // moyens de paiement, puisqu'aucun montant n'est prélevé ici.
  if (policyRequiresCard && !PREPAYMENT.enabled) {
    methods.length = 0;
    methods.push("online");
  }

  // Sélection initiale uniquement : si rien n'est encore choisi, on pré-sélectionne
  // "online" si le paiement est obligatoire (ou s'il s'agit du seul moyen dispo).
  // Une fois que l'utilisateur a fait un choix (selectPayMethod), on ne le force plus.
  if (!STATE.paymentMethod) {
    if (isRequired && methods.includes("online")) {
      STATE.paymentMethod = "online";
    } else if (methods.length === 1) {
      STATE.paymentMethod = methods[0];
    }
  }

  // Reset Stripe card element when re-rendering
  _cardElement = null;

  // ── Build choice buttons ────────────────────────────────────────────────────
  const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;

  function choiceBtn(id, method, icon, label, sub) {
    const active = STATE.paymentMethod === method;
    return `
      <button class="bk-pay-choice ${active ? "bk-pay-choice--active" : ""}" id="${id}">
        <span class="bk-pay-choice__icon">${icon}</span>
        <div>
          <span class="bk-pay-choice__label">${label}</span>
          <span class="bk-pay-choice__sub">${sub}</span>
        </div>
        <div class="bk-pay-choice__check">${active ? checkSvg : ""}</div>
      </button>`;
  }

  let choicesHtml = "";
  if (!isRequired || methods.length > 1) {
    const onSiteSub = [PREPAYMENT.cash && "espèces", PREPAYMENT.cardOnSite && "CB sur place"].filter(Boolean).join(" · ") || "sur place";
    if (methods.includes("online"))
      choicesHtml += choiceBtn("payChoiceOnline", "online", "💳",
        "Payer maintenant par carte", "Sécurisé via Stripe · Paiement immédiat");
    if (methods.includes("paypal"))
      choicesHtml += choiceBtn("payChoicePaypal", "paypal", "🅿️",
        "PayPal", "Un lien de paiement vous sera envoyé");
    if (methods.includes("bank_transfer"))
      choicesHtml += choiceBtn("payChoiceBankTransfer", "bank_transfer", "🏦",
        "Virement bancaire", "Coordonnées affichées après confirmation");
    if (methods.includes("on_site"))
      choicesHtml += choiceBtn("payChoiceOnSite", "on_site", "🏪",
        "Payer sur place", onSiteSub);
  }

  // ── PayPal block ────────────────────────────────────────────────────────────
  const paypalAmount = price ? Number(price).toFixed(2) : "";
  const paypalLink   = PREPAYMENT.paypalMe
    ? `https://paypal.me/${PREPAYMENT.paypalMe}${paypalAmount ? "/" + paypalAmount : ""}`
    : "";
  const paypalBlock = STATE.paymentMethod === "paypal" && paypalLink ? `
    <div class="bk-iban-block">
      <div class="bk-iban-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        Paiement PayPal
      </div>
      <div class="bk-iban-grid">
        <div class="bk-iban-row"><span>Montant</span><strong>${paypalAmount ? paypalAmount + " €" : "–"}</strong></div>
      </div>
      <p style="font-size:12px;color:var(--muted,#6b7280);margin:8px 0 10px">
        Cliquez sur le bouton ci-dessous après confirmation de votre rendez-vous pour effectuer le paiement.
      </p>
      <a class="bk-paypal-btn" href="${paypalLink}" target="_blank" rel="noopener noreferrer">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px;vertical-align:-2px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Payer ${paypalAmount ? paypalAmount + " €" : ""} via PayPal
      </a>
    </div>` : "";

  // ── IBAN details block ──────────────────────────────────────────────────────
  const bd = PREPAYMENT.bankDetails || {};
  const ibanBlock = STATE.paymentMethod === "bank_transfer" ? `
    <div class="bk-iban-block">
      <div class="bk-iban-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        Coordonnées bancaires
      </div>
      <div class="bk-iban-grid">
        ${bd.iban     ? `<div class="bk-iban-row"><span>IBAN</span><strong>${bd.iban}</strong></div>` : ""}
        ${bd.bic      ? `<div class="bk-iban-row"><span>BIC</span><strong>${bd.bic}</strong></div>` : ""}
        ${bd.bankName ? `<div class="bk-iban-row"><span>Banque</span><strong>${bd.bankName}</strong></div>` : ""}
        ${bd.note     ? `<div class="bk-iban-note">${bd.note}</div>` : ""}
      </div>
    </div>` : "";

  // La carte est aussi requise en garantie si l'utilisateur choisit de payer
  // sur place mais que la politique d'annulation de l'établissement exige
  // une carte enregistrée (frais en cas d'annulation tardive / absence).
  const cardForGuarantee = STATE.paymentMethod === "on_site" && policyRequiresCard;

  // ── Stripe card block ───────────────────────────────────────────────────────
  const stripeBlock = (STATE.paymentMethod === "online" || cardForGuarantee) ? `
    <div id="bkCardWrap">
      <div class="bk-card-label">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
        Informations de carte
      </div>
      <div id="bkStripeCard" class="bk-stripe-card-el"></div>
      <div id="bkCardError" class="bk-card-error" style="display:none"></div>
    </div>` : "";

  // ── Required badge (if only stripe and mandatory) ──────────────────────────
  const requiredBadge = isRequired && methods.length <= 1 ? `
    <div class="bk-pay-required-badge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      ${policyRequiresCard && !PREPAYMENT.enabled
        ? "Carte bancaire obligatoire pour garantir cette réservation (aucun débit immédiat)"
        : "Paiement obligatoire pour cette réservation"}
    </div>` : "";

  // ── Cancel policy (Stripe only) ─────────────────────────────────────────────
  // Paiement immédiat (prépaiement activé + "Payer maintenant par carte") :
  // l'argent est déjà débité, donc en cas d'annulation tardive on parle de
  // remboursement (partiel ou nul), pas de nouveau prélèvement.
  const immediateCharge = STATE.paymentMethod === "online" && PREPAYMENT.enabled;

  let cancelPolicyItems = "";
  const cancelRule = PREPAYMENT.cancellationRule || "free";
  if (cancelRule === "half_24h") {
    cancelPolicyItems = immediateCharge ? `
      <li>Annulation <strong>&gt; 24h</strong> : remboursement intégral</li>
      <li>Annulation <strong>&lt; 24h</strong> : 50 % remboursés, 50 % conservés</li>` : `
      <li>Annulation <strong>&gt; 24h</strong> : aucun frais</li>
      <li>Annulation <strong>&lt; 24h</strong> : 50 % du montant prélevés</li>`;
  } else if (cancelRule === "full_12h") {
    cancelPolicyItems = immediateCharge ? `
      <li>Annulation <strong>&gt; 24h</strong> : remboursement intégral</li>
      <li>Annulation entre <strong>12h et 24h</strong> : 50 % remboursés, 50 % conservés</li>
      <li>Annulation <strong>&lt; 12h</strong> : aucun remboursement</li>` : `
      <li>Annulation <strong>&gt; 24h</strong> : aucun frais</li>
      <li>Annulation entre <strong>12h et 24h</strong> : 50 % du montant prélevés</li>
      <li>Annulation <strong>&lt; 12h</strong> : 100 % du montant prélevés</li>`;
  } else {
    cancelPolicyItems = `<li>Annulation gratuite à tout moment</li>`;
  }

  const cancelPolicy = (STATE.paymentMethod === "online" || cardForGuarantee) ? `
    <div class="bk-cancel-policy">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <div>
        <strong>${immediateCharge ? `Paiement immédiat — ${priceLabel} débités maintenant` : (cardForGuarantee ? "Carte enregistrée en garantie — 0 € débité maintenant" : "Carte enregistrée — 0 € débité maintenant")}</strong>
        <ul>
          ${cancelPolicyItems}
        </ul>
      </div>
    </div>` : "";

  pane.innerHTML = `
    <div class="bk-payment-step">
      <div class="bk-payment-header">
        <div class="bk-payment-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
            <line x1="1" y1="10" x2="23" y2="10"/>
          </svg>
        </div>
        <div>
          <h3 class="bk-payment-title">Mode de paiement</h3>
          ${priceLabel ? `<p class="bk-payment-amount">Montant : <strong>${priceLabel}</strong></p>` : ""}
        </div>
      </div>
      ${requiredBadge}
      ${choicesHtml ? `<div class="bk-pay-choices">${choicesHtml}</div>` : ""}
      ${stripeBlock}
      ${paypalBlock}
      ${ibanBlock}
      ${cancelPolicy}
    </div>
  `;

  // Mount Stripe card if needed
  if (STATE.paymentMethod === "online" || cardForGuarantee) {
    mountStripeCard();
  }

  // Wire choice buttons
  document.getElementById("payChoiceOnline")?.addEventListener("click", () => selectPayMethod("online"));
  document.getElementById("payChoicePaypal")?.addEventListener("click", () => selectPayMethod("paypal"));
  document.getElementById("payChoiceOnSite")?.addEventListener("click", () => selectPayMethod("on_site"));
  document.getElementById("payChoiceBankTransfer")?.addEventListener("click", () => selectPayMethod("bank_transfer"));
}

function selectPayMethod(method) {
  // La carte reste nécessaire si on passe en "sur place" mais que la politique
  // d'annulation exige une carte en garantie (cardRequiredByPolicy).
  const keepCard = method === "online" || (method === "on_site" && cardRequiredByPolicy());
  if (!keepCard) {
    STATE.stripePaymentIntentId = null;
    STATE.stripeSetupIntentId   = null;
    if (_cardElement) {
      try { _cardElement.unmount(); } catch (_) { /* élément déjà cassé/démonté */ }
      _cardElement = null;
    }
  }
  STATE.paymentMethod = method;
  STATE.paymentError  = null;
  renderPaymentPane();
  renderCart();
}

function mountStripeCard() {
  const s = getStripe();
  if (!s) { console.warn("Stripe.js not loaded"); return; }
  const container = document.getElementById("bkStripeCard");
  if (!container) return;

  if (_cardElement) {
    try { _cardElement.unmount(); } catch (_) { /* élément déjà cassé/démonté */ }
    _cardElement = null;
  }

  const elements  = s.elements({ locale: "fr" });
  _cardElement    = elements.create("card", {
    style: {
      base: {
        fontSize:    "15px",
        color:       getComputedStyle(document.documentElement).getPropertyValue("--text-primary") || "#111",
        fontFamily:  "'Plus Jakarta Sans', sans-serif",
        "::placeholder": { color: "#aab" },
      },
      invalid: { color: "#ef4444" },
    },
    hidePostalCode: true,
  });
  _cardElement.mount(container);

  _cardElement.on("change", (e) => {
    const errEl = document.getElementById("bkCardError");
    if (e.error && errEl) {
      errEl.textContent = e.error.message;
      errEl.style.display = "block";
    } else if (errEl) {
      errEl.style.display = "none";
    }
    if (STATE.stripePaymentIntentId) {
      STATE.stripePaymentIntentId = null;
    }
    if (STATE.stripeSetupIntentId) {
      STATE.stripeSetupIntentId = null;
    }
  });
}

/* ── Payment submit (called when "Confirmer et payer" is clicked) ─────────── */
async function submitBookingWithPayment() {
  // Bank transfer or paypal → just confirm booking, no card needed
  if (STATE.paymentMethod === "bank_transfer" || STATE.paymentMethod === "paypal") {
    submitBooking();
    return;
  }

  // "Payer sur place" sans politique d'annulation exigeant une carte → rien à faire
  if (STATE.paymentMethod === "on_site" && !cardRequiredByPolicy()) {
    submitBooking();
    return;
  }

  // method === "online", ou "on_site" avec carte exigée en garantie
  const nextBtn = document.getElementById("cartNext");
  const resetBtn = () => {
    if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = "Confirmer et payer"; }
  };

  if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = "Vérification de la carte…"; }

  // Guard: Stripe must be loaded
  const s = getStripe();
  if (!s) {
    const errEl = document.getElementById("bkCardError");
    if (errEl) { errEl.textContent = "Stripe non chargé. Rechargez la page."; errEl.style.display = "block"; }
    resetBtn();
    return;
  }
  if (!_cardElement) {
    const errEl = document.getElementById("bkCardError");
    if (errEl) { errEl.textContent = "Formulaire de carte introuvable. Rechargez la page."; errEl.style.display = "block"; }
    resetBtn();
    return;
  }

  // "Payer maintenant par carte" avec prépaiement activé → on débite le montant
  // immédiatement (PaymentIntent). Sinon (carte requise uniquement en garantie
  // par la politique d'annulation, prépaiement non activé) → SetupIntent 0€.
  const chargeNow = STATE.paymentMethod === "online" && PREPAYMENT.enabled;

  try {
    const email = CLIENT?.email || STATE.form.email;
    const name  = CLIENT
      ? `${CLIENT.firstName} ${CLIENT.lastName}`.trim()
      : `${STATE.form.firstName} ${STATE.form.lastName}`.trim();

    if (chargeNow) {
      // 1. Create PaymentIntent on server (débite le montant maintenant)
      if (nextBtn) nextBtn.textContent = "Connexion sécurisée…";
      const intentRes = await fetch("/api/booking/payment-intent", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          email, name, companyId: COMPANY_ID,
          amountEur:   STATE.service?.price,
          currency:    "eur",
          serviceName: STATE.service?.name,
        }),
      });
      const intentData = await intentRes.json().catch(() => ({}));
      if (!intentRes.ok) throw new Error(intentData.message || intentData.error || `Erreur serveur (${intentRes.status}).`);
      if (!intentData.clientSecret) throw new Error(intentData.error || "Erreur Stripe.");

      // 2. Confirm payment with Stripe.js (débite la carte)
      if (nextBtn) nextBtn.textContent = "Paiement en cours…";
      const { paymentIntent, error } = await s.confirmCardPayment(intentData.clientSecret, {
        payment_method: {
          card: _cardElement,
          billing_details: { name, email },
        },
      });

      if (error) {
        const errEl = document.getElementById("bkCardError");
        if (errEl) { errEl.textContent = error.message; errEl.style.display = "block"; }
        resetBtn();
        return;
      }

      if (paymentIntent.status !== "succeeded") {
        const errEl = document.getElementById("bkCardError");
        if (errEl) { errEl.textContent = "Paiement non confirmé. Veuillez réessayer."; errEl.style.display = "block"; }
        resetBtn();
        return;
      }

      STATE.stripePaymentIntentId = paymentIntent.id;
    } else {
      // 1. Create SetupIntent on server (enregistre la carte, 0€ prélevé)
      if (nextBtn) nextBtn.textContent = "Connexion sécurisée…";
      const intentRes = await fetch("/api/booking/setup-intent", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, name, companyId: COMPANY_ID }),
      });
      const intentData = await intentRes.json().catch(() => ({}));
      if (!intentRes.ok) throw new Error(intentData.message || intentData.error || `Erreur serveur (${intentRes.status}).`);
      if (!intentData.clientSecret) throw new Error(intentData.error || "Erreur Stripe.");

      // 2. Confirm card setup with Stripe.js (enregistre la carte, aucun débit)
      if (nextBtn) nextBtn.textContent = "Validation de la carte…";
      const { setupIntent, error } = await s.confirmCardSetup(intentData.clientSecret, {
        payment_method: {
          card: _cardElement,
          billing_details: { name, email },
        },
      });

      if (error) {
        const errEl = document.getElementById("bkCardError");
        if (errEl) { errEl.textContent = error.message; errEl.style.display = "block"; }
        resetBtn();
        return;
      }

      if (setupIntent.status !== "succeeded") {
        const errEl = document.getElementById("bkCardError");
        if (errEl) { errEl.textContent = "Carte non confirmée. Veuillez réessayer."; errEl.style.display = "block"; }
        resetBtn();
        return;
      }

      STATE.stripeSetupIntentId = setupIntent.id;
    }

    // 3. Submit the booking
    await submitBooking();

  } catch (err) {
    console.error("submitBookingWithPayment:", err);
    const errEl = document.getElementById("bkCardError");
    if (errEl) { errEl.textContent = err.message || "Erreur. Veuillez réessayer."; errEl.style.display = "block"; }
    resetBtn();
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   BOOKING SUBMIT
   ═══════════════════════════════════════════════════════════════════════════ */
async function submitBooking() {
  if (!validateDetails()) return;

  // Collect form answers only if the details pane is still in the DOM
  // (i.e., we came directly from details, not from the payment step where
  //  answers were already collected in advanceStep()).
  if (pane.querySelector(".bk-question")) {
    STATE.formAnswers = collectFormAnswers();
  }

  // Sync form values (client may be logged in → use CLIENT object)
  const firstName = CLIENT ? CLIENT.firstName : STATE.form.firstName;
  const lastName  = CLIENT ? CLIENT.lastName  : STATE.form.lastName;
  const email     = CLIENT ? CLIENT.email     : STATE.form.email;
  const phone     = CLIENT ? CLIENT.phone     : STATE.form.phone;
  const message   = STATE.form.message;

  // Show loading in cart
  const nextBtn = document.getElementById("cartNext");
  if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = "Envoi…"; }

  try {
    const res = await fetch("/create-booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date:         STATE.date,
        startTime:    STATE.time,
        company:      COMPANY_ID,
        name:         firstName,
        surname:      lastName,
        email,
        phone,
        message,
        formAnswers:     STATE.formAnswers,
        serviceId:       STATE.service  ? STATE.service.id       : null,
        serviceName:     STATE.service  ? STATE.service.name     : null,
        serviceDuration: STATE.service  ? STATE.service.duration : null,
        servicePrice:    STATE.service  ? STATE.service.price    : null,
        serviceCategory: STATE.service  ? STATE.service.category : null,
        employeeId:      STATE.employee ? STATE.employee.id      : null,
        employeeName:    STATE.employee ? STATE.employee.name    : null,
        // ── Payment ──────────────────────────────────────────────────────────
        paymentMethod:          STATE.paymentMethod          || "none",
        stripePaymentIntentId:  STATE.stripePaymentIntentId  || null,
        stripeSetupIntentId:    STATE.stripeSetupIntentId    || null,
      }),
    });

    const data = await res.json();

    if (!data.success) {
      if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = "Confirmer la réservation"; }
      if (data.error === "no_employee_available") {
        alert("Ce créneau n'est plus disponible. Veuillez en choisir un autre.");
        goToStep("time");
        _currentSlots = [];
        STATE.date = null;
        STATE.time = null;
      } else if (data.error === "session_full") {
        alert(data.message || "Cette session est complète, merci de choisir un autre horaire.");
        goToStep("time");
        _currentSlots = [];
        STATE.date = null;
        STATE.time = null;
      } else if (data.error === "monthly_limit_reached") {
        showLimitReachedModal();
        goToStep("service");
      } else {
        alert("Une erreur est survenue. Veuillez réessayer.");
      }
      return;
    }

    // Success → confirmation step
    goToStep("confirm");

  } catch (err) {
    console.error(err);
    if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = "Confirmer la réservation"; }
    alert("Erreur réseau. Veuillez réessayer.");
  }
}

/* ════════════════════════════════════════════════════════════════════════════
   STEP 5 — CONFIRMATION
   ═══════════════════════════════════════════════════════════════════════════ */
function renderConfirmPane() {
  cart.innerHTML = ""; // hide cart on confirm

  const firstName = CLIENT ? CLIENT.firstName : STATE.form.firstName;
  const email     = CLIENT ? CLIENT.email     : STATE.form.email;
  const info      = window.__companyInfo || {};

  // Location row
  let locationText = "";
  if (info.serviceType === "en_ligne") {
    locationText = "En ligne";
  } else if (info.address || info.city) {
    locationText = [info.address, info.city].filter(Boolean).join(", ");
  }

  // Form answers rows
  let answersHtml = "";
  if (STATE.formAnswers && STATE.formAnswers.length > 0) {
    answersHtml = STATE.formAnswers.map(a =>
      `<div class="bk-conf__row"><span class="k">${escHtml(a.question || a.label || "Question")}</span><span class="v">${escHtml(String(a.answer ?? ""))}</span></div>`
    ).join("");
  }

  // Show account creation nudge only for guest users
  const showSignup = !CLIENT && email;

  pane.innerHTML = `<div class="bk-pane">
    <div class="bk-conf">

      <!-- ✅ Check -->
      <div class="bk-conf__check">
        <svg width="32" height="32" viewBox="0 -960 960 960" fill="currentColor">
          <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/>
        </svg>
      </div>
      <h2>Votre réservation a bien été enregistrée !</h2>
      <p class="bk-conf__lead">Un email de confirmation est en route vers <strong>${escHtml(email)}</strong>.</p>

      <!-- Recap -->
      <div class="bk-conf__recap">
        ${STATE.service ? `<div class="bk-conf__row"><span class="k">Service</span><span class="v">${escHtml(STATE.service.name)}${STATE.service.duration ? ` · ${STATE.service.duration} min` : ""}</span></div>` : ""}
        ${STATE.employee ? `<div class="bk-conf__row"><span class="k">Avec</span><span class="v">${escHtml(STATE.employee.name)}</span></div>` : ""}
        <div class="bk-conf__row"><span class="k">Quand</span><span class="v">${fmtDate(STATE.date)} · ${STATE.time}</span></div>
        ${locationText ? `<div class="bk-conf__row"><span class="k">Lieu</span><span class="v">${escHtml(locationText)}</span></div>` : ""}
        ${answersHtml}
        ${STATE.service && STATE.service.price !== null && STATE.service.price !== undefined
          ? `<hr class="bk-conf__divider" /><div class="bk-conf__row"><span class="k">Total</span><span class="v bk-conf__price">${STATE.service.price}€</span></div>`
          : ""}
      </div>

      <!-- 🎯 Account nudge -->
      ${showSignup ? `
      <div class="bk-signup-nudge" id="bkSignupNudge">
        <div class="bk-signup-nudge__top">
          <span class="bk-signup-nudge__emoji">🎉</span>
          <div>
            <p class="bk-signup-nudge__title">Sauvegardez votre réservation</p>
            <p class="bk-signup-nudge__sub">Créez votre compte en 10 secondes — gérez vos RDV depuis votre espace.</p>
          </div>
        </div>
        <div class="bk-signup-nudge__perks">
          <span>📋 Historique de vos RDV</span>
          <span>❌ Annulation en 1 clic</span>
          <span>⚡ Réservation ultra-rapide</span>
        </div>
        <div class="bk-signup-nudge__form" id="bkSignupForm">
          <div class="bk-signup-nudge__email-row">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,12 2,6"/></svg>
            <span>${escHtml(email)}</span>
          </div>
          <input class="bk-input" id="bkSignupPwd" type="password" placeholder="Choisissez un mot de passe (8 car. min.)" autocomplete="new-password" />
          <p class="bk-signup-nudge__error" id="bkSignupError" style="display:none"></p>
          <button class="bk-signup-nudge__btn" id="bkSignupBtn" type="button">
            Créer mon compte gratuitement →
          </button>
        </div>
        <div class="bk-signup-nudge__success" id="bkSignupSuccess" style="display:none">
          <svg width="18" height="18" viewBox="0 -960 960 960" fill="currentColor"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>
          Compte créé ! <a href="/espace-client" style="color:inherit;font-weight:700;">Accéder à mon espace →</a>
        </div>
        <button class="bk-signup-nudge__skip" id="bkSignupSkip" type="button">Non merci, continuer sans compte</button>
      </div>` : ""}

      <!-- 📅 Ajouter à l'agenda -->
      <div class="bk-cal-add" id="bkCalAdd">
        <button class="bk-cal-add__btn" id="bkCalToggle" type="button">
          <svg width="16" height="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M200-80q-33 0-56.5-23.5T120-160v-560q0-33 23.5-56.5T200-840h40v-80h80v80h320v-80h80v80h40q33 0 56.5 23.5T840-720v560q0 33-23.5 56.5T760-80H200Zm0-80h560v-400H200v400Zm0-480h560v-80H200v80Zm0 0v-80 80Zm280 240q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-320Zm-160 0q-17 0-28.5-11.5T280-440q0-17 11.5-28.5T320-480q17 0 28.5 11.5T360-440q0 17-11.5 28.5T320-320Zm320 0q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-320ZM480-160q-17 0-28.5-11.5T440-200q0-17 11.5-28.5T480-240q17 0 28.5 11.5T520-200q0 17-11.5 28.5T480-160Zm-160 0q-17 0-28.5-11.5T280-200q0-17 11.5-28.5T320-240q17 0 28.5 11.5T360-200q0 17-11.5 28.5T320-160Zm320 0q-17 0-28.5-11.5T600-200q0-17 11.5-28.5T640-240q17 0 28.5 11.5T680-200q0 17-11.5 28.5T640-160Z"/></svg>
          Ajouter à l'agenda
          <svg class="bk-cal-add__chevron" width="12" height="12" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-344 240-584l56-56 184 184 184-184 56 56-240 240Z"/></svg>
        </button>
        <div class="bk-cal-add__dropdown" id="bkCalDropdown" style="display:none">
          <a class="bk-cal-add__opt" id="bkCalGoogle" href="#" target="_blank" rel="noopener">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.33 0 9.25-3.65 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z" fill="#4285F4"/></svg>
            Google Agenda
          </a>
          <a class="bk-cal-add__opt" id="bkCalIcs" href="#" download="rendez-vous.ics">
            <svg width="16" height="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>
            Apple / Outlook (.ics)
          </a>
        </div>
      </div>

      <div class="bk-conf__actions">
        <button class="bk-btn bk-btn--ghost bk-btn--sm" onclick="window.location.reload()">Nouvelle réservation</button>
      </div>
    </div>
  </div>`;

  // ── Ajouter à l'agenda ─────────────────────────────────────────────────
  (function () {
    const toggle   = document.getElementById("bkCalToggle");
    const dropdown = document.getElementById("bkCalDropdown");
    const gLink    = document.getElementById("bkCalGoogle");
    const icsLink  = document.getElementById("bkCalIcs");
    if (!toggle || !STATE.date || !STATE.time) return;

    // Parse date + time → JS Date objects
    const [h, m]    = STATE.time.split(":").map(Number);
    const startDt   = new Date(`${STATE.date}T${STATE.time}:00`);
    const dur        = (STATE.service && STATE.service.duration) ? parseInt(STATE.service.duration, 10) : 60;
    const endDt     = new Date(startDt.getTime() + dur * 60000);

    function toGCalFmt(dt) {
      // YYYYMMDDTHHmmss (local, no Z)
      const pad = n => String(n).padStart(2, "0");
      return `${dt.getFullYear()}${pad(dt.getMonth()+1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(dt.getMinutes())}00`;
    }
    function toIcsFmt(dt) {
      // Same format for ICS local time
      return toGCalFmt(dt);
    }

    const title    = (STATE.service ? STATE.service.name : "Rendez-vous") + (info.businessName ? ` — ${info.businessName}` : "");
    const location = [info.address, info.city].filter(Boolean).join(", ");
    const details  = `Réservé via Branshee${info.businessName ? " · " + info.businessName : ""}`;

    // Google Calendar link
    const gcUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE` +
      `&text=${encodeURIComponent(title)}` +
      `&dates=${toGCalFmt(startDt)}/${toGCalFmt(endDt)}` +
      `&details=${encodeURIComponent(details)}` +
      (location ? `&location=${encodeURIComponent(location)}` : "");
    if (gLink) gLink.href = gcUrl;

    // ICS blob
    function buildIcs() {
      const uid  = `branshee-${Date.now()}@branshee.com`;
      const now  = toIcsFmt(new Date()).replace(/\D/g,"").slice(0,15) + "Z";
      return [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Branshee//FR",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${now}`,
        `DTSTART:${toIcsFmt(startDt)}`,
        `DTEND:${toIcsFmt(endDt)}`,
        `SUMMARY:${title}`,
        location ? `LOCATION:${location}` : "",
        `DESCRIPTION:${details}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].filter(Boolean).join("\r\n");
    }

    if (icsLink) {
      icsLink.addEventListener("click", function (e) {
        e.preventDefault();
        const blob = new Blob([buildIcs()], { type: "text/calendar;charset=utf-8" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = "rendez-vous.ics";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        dropdown.style.display = "none";
      });
    }

    // Toggle dropdown
    toggle.addEventListener("click", function (e) {
      e.stopPropagation();
      const open = dropdown.style.display !== "none";
      dropdown.style.display = open ? "none" : "block";
      toggle.classList.toggle("is-open", !open);
    });
    document.addEventListener("click", function () {
      dropdown.style.display = "none";
      toggle.classList.remove("is-open");
    });
    dropdown.addEventListener("click", function (e) { e.stopPropagation(); });
  })();

  // ── Signup nudge logic ──────────────────────────────────────────────────
  if (showSignup) {
    const signupBtn  = document.getElementById("bkSignupBtn");
    const signupSkip = document.getElementById("bkSignupSkip");
    const signupErr  = document.getElementById("bkSignupError");
    const signupOk   = document.getElementById("bkSignupSuccess");
    const signupForm = document.getElementById("bkSignupForm");
    const nudge      = document.getElementById("bkSignupNudge");

    if (signupSkip) signupSkip.onclick = () => { nudge.style.display = "none"; };

    if (signupBtn) {
      signupBtn.onclick = async () => {
        const pwd = document.getElementById("bkSignupPwd")?.value || "";
        if (pwd.length < 8 || !/[0-9]/.test(pwd) || !/[^a-zA-Z0-9]/.test(pwd)) {
          signupErr.textContent = "Mot de passe trop faible : 8 caractères minimum, avec au moins 1 chiffre et 1 caractère spécial (!, @, #…).";
          signupErr.style.display = "block";
          return;
        }
        signupBtn.disabled = true;
        signupBtn.textContent = "Création…";
        signupErr.style.display = "none";

        const fullName = `${STATE.form.firstName || ""} ${STATE.form.lastName || ""}`.trim() || email;
        try {
          const res  = await fetch("/client/register", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
            body: JSON.stringify({ fullName, email, password: pwd, confirmPassword: pwd }),
          });
          const data = await res.json();
          if (data.success) {
            signupForm.style.display  = "none";
            signupOk.style.display    = "flex";
            nudge.querySelector(".bk-signup-nudge__skip").style.display = "none";
          } else {
            signupErr.textContent = data.error || "Une erreur est survenue.";
            signupErr.style.display = "block";
            signupBtn.disabled = false;
            signupBtn.textContent = "Créer mon compte gratuitement →";
          }
        } catch (_) {
          signupErr.textContent = "Erreur réseau. Réessayez.";
          signupErr.style.display = "block";
          signupBtn.disabled = false;
          signupBtn.textContent = "Créer mon compte gratuitement →";
        }
      };

      // Enter on password
      document.getElementById("bkSignupPwd")?.addEventListener("keydown", e => {
        if (e.key === "Enter") signupBtn.click();
      });
    }
  }
}

/* ── State persistence across OAuth redirects ────────────────────────────
   Avant de quitter la page (Google OAuth), on sauvegarde l'état en
   sessionStorage. Au retour, on le restaure et on reprend à l'étape details.
   ─────────────────────────────────────────────────────────────────────── */

const BK_STATE_KEY = "bk_state_" + (COMPANY_ID || "x");

function saveStateForOAuth() {
  try {
    const snapshot = {
      service:       STATE.service,
      employee:      STATE.employee,
      date:          STATE.date,
      time:          STATE.time,
      form:          { ...STATE.form },
      paymentMethod: STATE.paymentMethod,
    };
    sessionStorage.setItem(BK_STATE_KEY, JSON.stringify(snapshot));
  } catch (_) {}
}

function restoreStateFromOAuth() {
  try {
    const raw = sessionStorage.getItem(BK_STATE_KEY);
    if (!raw) return false;
    sessionStorage.removeItem(BK_STATE_KEY);
    const snap = JSON.parse(raw);
    if (snap.service)       STATE.service       = snap.service;
    if (snap.employee !== undefined) STATE.employee = snap.employee;
    if (snap.date)          STATE.date          = snap.date;
    if (snap.time)          STATE.time          = snap.time;
    if (snap.form)          Object.assign(STATE.form, snap.form);
    if (snap.paymentMethod) STATE.paymentMethod = snap.paymentMethod;
    return !!(snap.service); // true if we had meaningful state
  } catch (_) { return false; }
}

/* ── Auto-resize iframe parent ──────────────────────────────────────────── */
(function () {
  if (window.self === window.top) return; // pas dans un iframe
  var _lastH = 0;
  var _timer = null;
  function sendHeight() {
    clearTimeout(_timer);
    _timer = setTimeout(function () {
      // Mesurer la hauteur réelle du contenu (pas du viewport)
      var h = document.documentElement.offsetHeight || document.body.offsetHeight;
      if (h === _lastH) return; // pas de changement → pas d'envoi
      _lastH = h;
      window.parent.postMessage({ type: 'branshee-resize', height: h }, '*');
    }, 60);
  }
  window.addEventListener('load', sendHeight);
  // MutationObserver sur les changements DOM réels — pas sur le layout
  new MutationObserver(sendHeight).observe(document.body, {
    childList: true, subtree: true
  });
  requestAnimationFrame(sendHeight);
})();

/* ── Init ───────────────────────────────────────────────────────────────── */
const _hadSavedState = restoreStateFromOAuth();
if (_hadSavedState) {
  // User just came back from Google OAuth — jump straight to details step
  // (they were on step 4 when they clicked the Google button)
  goToStep("details");
} else {
  render();
}
