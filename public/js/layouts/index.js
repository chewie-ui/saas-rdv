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
const BOOKING_QUESTION = window.__bookingQuestion || { enabled: false, question: "", newLabel: "", existingLabel: "" };
const BK_TEXTS = window.__bkTexts || { calendarHelp: "", slotHeading: "", timezone: "" };

/* ── Question préalable ("Première fois ?" etc.) ───────────────────────────
   Posée AVANT le choix du service si l'admin l'a activée. Deux réponses
   fixes : "new" (nouveau) / "existing" (déjà venu). Chaque service peut être
   limité à l'une des deux (service.answerVisibility) — "all" (par défaut)
   reste visible quelle que soit la réponse choisie. ──────────────────────── */
function questionStepNeeded() {
  return !!BOOKING_QUESTION.enabled;
}
function matchesAnswer(s) {
  if (!questionStepNeeded() || !STATE.answer) return true;
  const vis = s.answerVisibility || "all";
  return vis === "all" || vis === STATE.answer;
}

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

/* ── Popup générique d'erreur de réservation (remplace les alert() natifs
   moches — créneau pris entre-temps, session complète, erreur réseau...).
   Réutilise le même style que showLimitReachedModal() ci-dessus. ────────── */
function showBookingErrorModal(title, text) {
  let modal = document.getElementById("bkErrorModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "bkErrorModal";
    modal.className = "bk-limit-modal";
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="bk-limit-modal__backdrop"></div>
    <div class="bk-limit-modal__card">
      <div class="bk-limit-modal__icon">
        <svg xmlns="http://www.w3.org/2000/svg" height="28px" viewBox="0 -960 960 960" width="28px" fill="currentColor">
          <path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/>
        </svg>
      </div>
      <h3 class="bk-limit-modal__title">${title}</h3>
      <p class="bk-limit-modal__text">${text}</p>
      <button type="button" class="bk-limit-modal__btn" id="bkErrorModalClose">J'ai compris</button>
    </div>
  `;
  modal.classList.add("is-open");
  document.body.style.overflow = "hidden";

  function close() {
    modal.classList.remove("is-open");
    document.body.style.overflow = "";
  }
  modal.querySelector(".bk-limit-modal__backdrop").addEventListener("click", close);
  modal.querySelector("#bkErrorModalClose").addEventListener("click", close);
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
  answer:     null,      // réponse choisie à la question préalable (ex: "Nouveau patient")
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
  if (questionStepNeeded()) steps.push({ id: "question", label: "Profil" });
  if (SERVICES.length > 0)  steps.push({ id: "service",  label: "Service" });
  if (EMPLOYEES.length > 1 || hasAnyServiceEmployees()) steps.push({ id: "employee", label: "Avec" });
  steps.push({ id: "time",    label: "Créneau" });
  steps.push({ id: "details", label: "Détails" });
  if (anyServiceNeedsPayment()) steps.push({ id: "payment",  label: "Paiement" });
  steps.push({ id: "confirm", label: "Confirmer" });
  return steps;
}

function hasAnyServiceEmployees() {
  return SERVICES.some(s => s.employees && s.employees.length > 1);
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
  // "Choix" effectif = liste spécifique au service si elle existe, sinon
  // l'équipe globale — on n'affiche l'étape que s'il y a un VRAI choix (2+).
  const effectiveLen = svcEmployees.length > 0 ? svcEmployees.length : EMPLOYEES.length;

  // Les sessions collectives ne dépendent pas d'un employé en particulier.
  const showEmployeeStep = STATE.service?.type !== "group" && effectiveLen > 1;

  const steps = [];
  if (questionStepNeeded()) steps.push({ id: "question", label: "Profil" });
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
  question: "Répondez à cette question pour qu'on vous propose les bonnes prestations.",
  service:  "Choisissez un service pour commencer votre réservation.",
  employee: "Sélectionnez le prestataire de votre choix (ou laissez-nous choisir).",
  time:     BK_TEXTS.calendarHelp || "Choisissez une date sur le calendrier puis un créneau horaire.",
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
  if (sid === "question")      renderQuestionPane();
  else if (sid === "service")  renderServicePane();
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
   STEP 0 — QUESTION PRÉALABLE (ex: "Êtes-vous un nouveau patient ?")
   ═══════════════════════════════════════════════════════════════════════════ */
function renderQuestionPane() {
  const choices = [
    { value: "new",      label: BOOKING_QUESTION.newLabel      || "Oui, je suis nouveau" },
    { value: "existing", label: BOOKING_QUESTION.existingLabel || "Non, j'ai déjà consulté" },
  ];
  const optionsHtml = choices.map(c => `
    <button class="bk-question-opt${STATE.answer === c.value ? " is-selected" : ""}" data-answer="${c.value}">
      <span>${escHtml(c.label)}</span>
      <svg width="16" height="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></svg>
    </button>`).join("");

  pane.innerHTML = `<div class="bk-pane">
    <h2 class="bk-pane-title">${escHtml(BOOKING_QUESTION.question || "Une petite question avant de commencer")}</h2>
    <p class="bk-pane-sub">Cela nous permet de vous proposer les bonnes prestations.</p>
    <div class="bk-question-options">${optionsHtml}</div>
  </div>`;

  pane.querySelectorAll("[data-answer]").forEach(btn => {
    btn.onclick = () => {
      STATE.answer = btn.dataset.answer;
      // Si le service déjà sélectionné ne correspond plus à la réponse, on
      // réinitialise pour éviter de réserver un service qui ne devrait plus
      // être proposé (ex: "Intro kiné" alors qu'on vient de dire "pas nouveau").
      if (STATE.service) {
        const svc = SERVICES.find(s => s._id === STATE.service.id);
        if (!svc || !matchesAnswer(svc)) {
          STATE.service = null;
          STATE.employee = undefined;
        }
      }
      goToStep("service");
    };
  });
}

/* ── Durée approximative ("30-40 min") — pour l'affichage uniquement. Tout
   le calcul de créneaux utilise toujours la borne haute (durationMax si
   définie, sinon duration) pour ne jamais sur-réserver un pro. ──────────── */
function formatDuration(s) {
  if (s.durationMax && s.durationMax > s.duration) return `${s.duration}-${s.durationMax} min`;
  return `${s.duration} min`;
}
function bookableDuration(s) {
  return (s.durationMax && s.durationMax > s.duration) ? s.durationMax : s.duration;
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
      <span class="bk-svc__dur">${formatDuration(s)}</span>
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
      STATE.service  = { id: svc._id, name: svc.name, price: svc.price, duration: bookableDuration(svc), durationLabel: formatDuration(svc), category: svc.category || "", type: svc.type || "individual", capacity: svc.capacity || null, location: svc.location || "" };
      STATE.employee = undefined;
      STATE.date     = null;
      STATE.time     = null;
      recomputeSteps();
      const effectiveLen = (svc.employees || []).length > 0 ? svc.employees.length : EMPLOYEES.length;
      // Les sessions collectives ne sont pas liées à un employé en particulier.
      if (svc.type !== "group" && effectiveLen > 1) goToStep("employee");
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
function getOrderedCats(list) {
  const services = list || SERVICES;
  const META = window.__categoriesMeta || [];
  // Categories explicitly ordered by admin
  const ordered = META.map(m => m.name).filter(Boolean);
  // Any categories on services not in META (appended at end)
  services.forEach(s => {
    const cat = (s.category || "").trim();
    if (cat && !ordered.includes(cat)) ordered.push(cat);
  });
  // Only keep cats that actually have services
  return ordered.filter(cat => services.some(s => (s.category || "").trim() === cat));
}

function renderServicePane() {
  // Ne garde que les services compatibles avec la réponse choisie à la
  // question préalable (ou tous, si la question est désactivée / pas encore
  // répondue / le service n'a aucune restriction).
  const visibleServices = SERVICES.filter(matchesAnswer);
  const hasCategories = visibleServices.some(s => s.category && s.category.trim() !== "");
  const style = window.__bookingCategoryStyle || "pills";

  let bodyHtml;

  if (visibleServices.length === 0) {
    bodyHtml = `<div class="bk-svc-empty">Aucune prestation ne correspond à votre réponse pour le moment.</div>`;
  } else if (!hasCategories) {
    // No categories → flat grid
    bodyHtml = `<div class="bk-svc-grid">${visibleServices.map(renderSvcCard).join("")}</div>`;
  } else if (style === "accordion") {
    // ── Accordion style ───────────────────────────────────────────────────
    const cats = getOrderedCats(visibleServices);
    const uncategorized = visibleServices.filter(s => !(s.category || "").trim());

    if (STATE._openCat === null && cats.length > 0) STATE._openCat = cats[0];

    const groupsHtml = cats.map(cat => {
      const svcs      = visibleServices.filter(s => (s.category || "").trim() === cat);
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
    const cats = getOrderedCats(visibleServices);
    const groupsHtml = cats.map(cat => {
      const svcs = visibleServices.filter(s => (s.category || "").trim() === cat);
      return `<div class="bk-cat-section">
        <h3 class="bk-cat-section__title">${escHtml(cat)}</h3>
        <div class="bk-svc-grid">${svcs.map(renderSvcCard).join("")}</div>
      </div>`;
    }).join("");
    const uncategorized = visibleServices.filter(s => !(s.category || "").trim());
    const uncatHtml = uncategorized.length > 0
      ? `<div class="bk-svc-grid" style="margin-top:8px">${uncategorized.map(renderSvcCard).join("")}</div>` : "";
    bodyHtml = `<div class="bk-cat-sections">${groupsHtml}${uncatHtml}</div>`;

  } else {
    // ── Pills style (default) — filter by category ────────────────────────
    const cats = getOrderedCats(visibleServices);

    // If selected service is in a category, pre-select it
    if (STATE._activeCat === null && STATE.service) {
      const selSvc = visibleServices.find(s => s._id === STATE.service.id);
      if (selSvc && selSvc.category && selSvc.category.trim()) {
        STATE._activeCat = selSvc.category.trim();
      }
    }

    const filtered = STATE._activeCat
      ? visibleServices.filter(s => (s.category || "").trim() === STATE._activeCat)
      : visibleServices;

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
          ? visibleServices.filter(s => (s.category || "").trim() === STATE._activeCat)
          : visibleServices;
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
        const role = e.role ? `<div class="bk-emp__role">${escHtml(e.role)}</div>` : "";
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
let _leadTimeMinutes  = 0;
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

    const dayBookings = _specificBookings ? _specificBookings.filter(b => toDateStr(b.date) === iso) : [];
    const markedFull  = dayBookings.find(b => b.isFull);
    const { free, total } = countFreeSlots(activeWH, slotT, dayBookings, cutoffMinutesForDate(c));

    if (total > 0 && free === 0) continue;
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
  const lead          = info.minBookingLeadTime;
  _leadTimeMinutes    = (lead && lead.enabled) ? Math.max(0, Number(lead.minutes) || 0) : 0;
  _calDataLoaded      = true;
}

// Minute-du-jour (0–1440, voire au-delà si le délai dépasse minuit ce
// jour-là) avant laquelle AUCUN créneau n'est réservable pour la date
// donnée — combine "c'est déjà passé" (si c'est aujourd'hui) et le délai
// minimum de réservation configuré par l'admin. Même logique que le serveur
// (controllers/booking.controller.js) pour que le calendrier et le panneau
// de créneaux ne se contredisent jamais.
function cutoffMinutesForDate(dateObj) {
  const now = new Date();
  const isSameDay = dateObj.getFullYear() === now.getFullYear()
    && dateObj.getMonth() === now.getMonth()
    && dateObj.getDate()  === now.getDate();
  const nowMinutesOfDay = isSameDay ? now.getHours() * 60 + now.getMinutes() : -1;
  const cutoffMs = now.getTime() + (_leadTimeMinutes || 0) * 60000;
  const dayMidnightMs = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate()).getTime();
  const leadCutoffForDay = Math.ceil((cutoffMs - dayMidnightMs) / 60000);
  return Math.min(Math.max(nowMinutesOfDay, leadCutoffForDay), 24 * 60);
}

// Compte les créneaux réellement libres pour UNE durée de service donnée —
// contrairement à un simple ratio "nombre de RDV / nombre de créneaux max",
// ça tient compte du fait qu'un seul RDV long peut bloquer plusieurs
// créneaux courts (et inversement, qu'un service plus court peut encore
// tenir dans les trous laissés par des RDV plus longs), ET du délai minimum
// de réservation (cutoffMinutes).
function countFreeSlots(workingHours, slotTime, dayBookings, cutoffMinutes) {
  if (!workingHours || workingHours.length === 0) return { free: 0, total: 0 };
  const cutoff = cutoffMinutes || 0;
  const occupied = (dayBookings || []).map(b => {
    const [h, m] = b.startTime.split(":").map(Number);
    const startMin = h * 60 + m;
    return [startMin, startMin + (b.slotTime || slotTime)];
  });
  let free = 0, total = 0;
  workingHours.forEach(p => {
    const [sh, sm] = p.start.split(":").map(Number);
    const [eh, em] = p.end.split(":").map(Number);
    const startMin = sh * 60 + sm, endMin = eh * 60 + em;
    for (let t = startMin; t + slotTime <= endMin; t += slotTime) {
      total++;
      if (t < cutoff) continue; // passé ou trop proche (délai minimum)
      const overlaps = occupied.some(([os, oe]) => t < oe && (t + slotTime) > os);
      if (!overlaps) free++;
    }
  });
  return { free, total };
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

        // Full day (plus aucun créneau libre POUR LA DURÉE DU SERVICE choisi)
        const slotT = STATE.service ? STATE.service.duration : (_slotTime || 30);
        const dayBookings = _specificBookings ? _specificBookings.filter(b => toDateStr(b.date) === iso) : [];
        const markedFull = dayBookings.find(b => b.isFull);
        const { free, total } = countFreeSlots(activeWH, slotT, dayBookings, cutoffMinutesForDate(c));
        const isFull = total > 0 && free === 0;
        // "si un jour est full met le en rouge et si la moitié des rdv est
        // pris met orange" — taux de remplissage RÉEL (créneaux libres pour
        // cette durée précise, pas juste le nombre de RDV) donné en couleur
        // pour un repère visuel rapide avant même d'ouvrir le créneau.
        const fillRatio = total > 0 ? 1 - (free / total) : 0;
        const isHalfBooked = !isFull && !markedFull && fillRatio >= 0.5;

        const isDisabled = isPast || isDayOff || (exception && (!exception.workingHours || exception.workingHours.length === 0));
        const isToday    = c.getTime() === realToday.getTime();
        const isSelected = STATE.date === iso;

        let cls = "bk-cal-cell";
        if (isDisabled)      cls += " is-disabled";
        else if (isFull || markedFull) cls += " is-full";
        else if (isHalfBooked) cls += " is-busy";
        else cls += " is-available";
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
  // Le serveur ne renvoie déjà que des créneaux recommandés réellement libres
  // (cf. computeRecommendedTimes côté serveur) — donc ici on n'a plus besoin
  // de mélanger les créneaux pris/passés dans la liste principale : ça
  // donnait l'impression que le regroupement "recommandait" des horaires
  // indisponibles. Tout le reste (pris, passé, libre non-recommandé) part
  // sous "Voir plus".
  const mainSlots  = groupingOn ? visible.filter(s => s.recommended) : visible;
  const extraSlots = groupingOn ? visible.filter(s => !s.recommended) : [];

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

/* ── Cours collectif : liste de séances (à la place du calendrier) ────────
   Remplace entièrement le calendrier pour un service "group" — l'admin a
   défini des séances précises (récurrentes ou ponctuelles) côté
   /group-sessions, donc le client choisit directement parmi cette liste au
   lieu de chercher une date au hasard sur un calendrier classique. ────── */
let _groupSessions     = [];
let _groupLocationText = "";

async function renderGroupSessionsPane() {
  pane.innerHTML = `<div class="bk-pane">
    <h2 class="bk-pane-title">Choisissez votre séance</h2>
    <p class="bk-pane-sub">${escHtml(STATE.service.name)}</p>
    <div class="bk-loading"><div class="bk-spinner"></div> Chargement…</div>
  </div>`;

  try {
    const res  = await fetch(`/get-group-sessions/${STATE.service.id}`);
    const data = await res.json();
    _groupSessions     = (data && data.sessions) || [];
    _groupLocationText = (data && data.locationText) || "";
  } catch (e) {
    _groupSessions     = [];
    _groupLocationText = "";
  }

  renderGroupSessionsList();
}

function renderGroupSessionsList() {
  const body = _groupSessions.length === 0
    ? `<div class="bk-gs-empty">Aucune séance programmée pour le moment — revenez bientôt !</div>`
    : `<div class="bk-gs-list">${_groupSessions.map(renderGroupSessionCard).join("")}</div>`;

  pane.innerHTML = `<div class="bk-pane">
    <h2 class="bk-pane-title">Choisissez votre séance</h2>
    <p class="bk-pane-sub">${escHtml(STATE.service.name)}</p>
    ${body}
  </div>`;

  bindGroupSessionCards();
}

function renderGroupSessionCard(s) {
  const iso      = toDateStr(s.date);
  const selected = STATE.date === iso && STATE.time === s.startTime;
  const full     = !!s.full || s.remaining === 0;

  let pillClass = "is-ok";
  let pillLabel = "";
  if (full) {
    pillClass = "is-full";
    pillLabel = "Complet";
  } else if (s.remaining !== null && s.remaining !== undefined) {
    // "Bas" = dernière place dispo (urgence universelle, quelle que soit la
    // capacité) OU moins d'un quart des places pour les cours à grande
    // capacité. Un simple seuil absolu ("≤ 2 restantes") déclenchait à tort
    // l'orange pour un cours à 2 places qui vient d'ouvrir (2 restantes sur
    // 2 = complètement vide, pas "presque plein") — cas réel pour les petits
    // ateliers (4-5 personnes) que cette fonctionnalité cible en premier lieu.
    const ratio = s.capacity ? s.remaining / s.capacity : 1;
    pillClass = (s.remaining === 1 || ratio <= 0.25) ? "is-low" : "is-ok";
    pillLabel = `${s.remaining} place${s.remaining > 1 ? "s" : ""}`;
  }

  return `<button class="bk-gs-card ${selected ? "is-selected" : ""} ${full ? "is-disabled" : ""}"
    data-date="${iso}" data-start="${escHtml(s.startTime)}" ${full ? "disabled" : ""}>
    <div class="bk-gs-card__main">
      <div class="bk-gs-card__date">${fmtDate(iso)}</div>
      <div class="bk-gs-card__time">${escHtml(s.startTime)}${s.endTime ? ` – ${escHtml(s.endTime)}` : ""}</div>
      ${_groupLocationText ? `<div class="bk-gs-card__loc">📍 ${escHtml(_groupLocationText)}</div>` : ""}
    </div>
    ${pillLabel ? `<span class="bk-gs-pill ${pillClass}">${pillLabel}</span>` : ""}
  </button>`;
}

function bindGroupSessionCards() {
  pane.querySelectorAll(".bk-gs-card[data-date]").forEach(el => {
    el.onclick = () => {
      if (el.disabled) return;
      STATE.date = el.dataset.date;
      STATE.time = el.dataset.start;
      pane.querySelectorAll(".bk-gs-card").forEach(c => c.classList.remove("is-selected"));
      el.classList.add("is-selected");
      renderCart();
    };
  });
}

let _currentSlots = [];
let _smartGrouping = { active: false, recommended: new Set() };

async function renderTimePane() {
  if (STATE.service && STATE.service.type === "group") {
    return renderGroupSessionsPane();
  }

  pane.innerHTML = `<div class="bk-pane">
    <h2 class="bk-pane-title">${escHtml(BK_TEXTS.slotHeading || "Choisissez votre créneau")}</h2>
    <p class="bk-pane-sub">${escHtml(BK_TEXTS.timezone || "Heure de Bruxelles (GMT+1).")}</p>
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
    <h2 class="bk-pane-title">${escHtml(BK_TEXTS.slotHeading || "Choisissez votre créneau")}</h2>
    <p class="bk-pane-sub">${escHtml(BK_TEXTS.timezone || "Heure de Bruxelles (GMT+1).")}</p>
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
      body: JSON.stringify({ index: dayOfWeek, COMPANY_ID, date: STATE.date, serviceDuration: serviceDur, employeeId: empId, serviceId }),
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
  // "Obligatoire" ne reflète QUE le réglage admin "Rendre le paiement
  // obligatoire" — la politique d'annulation exige une carte en garantie,
  // mais ne doit jamais forcer un paiement immédiat ni retirer au client le
  // choix de payer sur place (carte enregistrée, 0 € débité maintenant).
  const policyRequiresCard = cardRequiredByPolicy();
  const isRequired = !!PREPAYMENT.required;

  // Build the list of available payment methods from admin config
  const methods = [];
  if (PREPAYMENT.enabled && PREPAYMENT.stripeActive && STRIPE_KEY) {
    methods.push("online");
  }
  if (PREPAYMENT.paypal && PREPAYMENT.paypalMe) {
    methods.push("paypal");
  }
  if (PREPAYMENT.bankTransfer) {
    methods.push("bank_transfer");
  }
  if (PREPAYMENT.qrCode) {
    methods.push("qr_code");
  }
  // "Payer sur place" apparaît dès que la politique d'annulation exige une
  // carte en garantie (même si l'admin n'a coché ni espèces ni CB sur
  // place) — c'est ce choix qui enregistre la carte sans rien débiter.
  if (PREPAYMENT.cash || PREPAYMENT.cardOnSite || (policyRequiresCard && !isRequired)) {
    methods.push("on_site");
  }

  // Si le paiement est réellement obligatoire (réglage admin), un seul choix
  // possible : payer maintenant par carte.
  if (isRequired) {
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
    let onSiteSub = [PREPAYMENT.cash && "espèces", PREPAYMENT.cardOnSite && "CB sur place"].filter(Boolean).join(" · ") || "sur place";
    if (policyRequiresCard) onSiteSub += " · carte enregistrée, rien débité maintenant";
    if (methods.includes("online"))
      choicesHtml += choiceBtn("payChoiceOnline", "online", "💳",
        "Payer maintenant par carte", "Sécurisé via Stripe · Paiement immédiat");
    if (methods.includes("paypal"))
      choicesHtml += choiceBtn("payChoicePaypal", "paypal", "🅿️",
        "PayPal", "Un lien de paiement vous sera envoyé");
    if (methods.includes("bank_transfer"))
      choicesHtml += choiceBtn("payChoiceBankTransfer", "bank_transfer", "🏦",
        "Virement bancaire", "Coordonnées affichées après confirmation");
    if (methods.includes("qr_code"))
      choicesHtml += choiceBtn("payChoiceQrCode", "qr_code", "📱",
        "QR code", "Scannez avec votre application bancaire");
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

  // ── QR code block ───────────────────────────────────────────────────────────
  const qrCodeBlock = STATE.paymentMethod === "qr_code" && PREPAYMENT.qrCodeImage ? `
    <div class="bk-iban-block">
      <div class="bk-iban-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="14" y2="21"/><line x1="21" y1="14" x2="21" y2="21"/><line x1="14" y1="21" x2="21" y2="21"/></svg>
        Scanner pour payer
      </div>
      <div style="display:flex;justify-content:center;margin:8px 0">
        <img src="${PREPAYMENT.qrCodeImage}" alt="QR code de paiement" style="width:160px;height:160px;object-fit:contain;border:1px solid var(--border,#e5e7eb);border-radius:10px;background:#fff" />
      </div>
      ${PREPAYMENT.qrCodeNote ? `<div class="bk-iban-note">${PREPAYMENT.qrCodeNote}</div>` : ""}
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

  // ── Required badge (paiement réellement obligatoire) ───────────────────────
  const requiredBadge = isRequired ? `
    <div class="bk-pay-required-badge">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      Paiement obligatoire pour cette réservation
    </div>` : "";

  // ── Info note (carte demandée en garantie, mais paiement pas obligatoire) ──
  // Explique au client POURQUOI une carte lui est demandée même quand il
  // garde le choix de payer sur place — sans ça, ça ressemble à un bug.
  const cardInfoNote = (policyRequiresCard && !isRequired) ? `
    <div class="bk-pay-info-note">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      Une carte vous sera demandée pour garantir cette réservation, conformément à la politique d'annulation de l'établissement. Rien n'est débité maintenant — elle ne sera utilisée qu'en cas d'annulation tardive ou d'absence.
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
      ${cardInfoNote}
      ${choicesHtml ? `<div class="bk-pay-choices">${choicesHtml}</div>` : ""}
      ${stripeBlock}
      ${paypalBlock}
      ${ibanBlock}
      ${qrCodeBlock}
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
  document.getElementById("payChoiceQrCode")?.addEventListener("click", () => selectPayMethod("qr_code"));
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
        showBookingErrorModal(
          "Créneau déjà réservé",
          "Ce créneau vient d'être réservé par quelqu'un d'autre entre-temps. Merci de choisir un autre horaire."
        );
        goToStep("time");
        _currentSlots = [];
        STATE.date = null;
        STATE.time = null;
      } else if (data.error === "session_full") {
        showBookingErrorModal(
          "Session complète",
          data.message || "Cette session est complète, merci de choisir un autre horaire."
        );
        goToStep("time");
        _currentSlots = [];
        STATE.date = null;
        STATE.time = null;
      } else if (data.error === "monthly_limit_reached") {
        showLimitReachedModal();
        goToStep("service");
      } else {
        showBookingErrorModal("Erreur", "Une erreur est survenue. Veuillez réessayer.");
      }
      return;
    }

    // Success → confirmation step
    goToStep("confirm");

  } catch (err) {
    console.error(err);
    if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = "Confirmer la réservation"; }
    showBookingErrorModal("Erreur réseau", "Une erreur réseau est survenue. Veuillez réessayer.");
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

  // Location row — un cours collectif peut avoir un lieu spécifique (ex: un
  // studio loué pour un atelier) qui remplace l'adresse par défaut affichée ici.
  let locationText = "";
  if (STATE.service && STATE.service.location) {
    locationText = STATE.service.location;
  } else if (info.serviceType === "en_ligne") {
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
        ${STATE.service ? `<div class="bk-conf__row"><span class="k">Service</span><span class="v">${escHtml(STATE.service.name)}${STATE.service.durationLabel ? ` · ${STATE.service.durationLabel}` : ""}</span></div>` : ""}
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
