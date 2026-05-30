/* ============================================================
   BranShee — Client Booking Wizard
   Step flow: Service? → Employee? → Time → Details → Payment? → Confirm
   All API calls preserved from the original implementation.
   ============================================================ */

const __t        = window.__t        || {};
const SERVICES   = window.__services  || [];
const EMPLOYEES  = window.__employees || [];
const CLIENT     = window.__clientUser || null; // { firstName, lastName, email, phone }
const PREPAYMENT = window.__prepayment || { enabled: false, required: false };
const STRIPE_KEY = window.__stripeKey  || "";

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
  paymentError:         null,
};

/* ── DOM refs ───────────────────────────────────────────────────────────── */
const stepper = document.getElementById("bkStepper");
const pane    = document.getElementById("bkPane");
const cart    = document.getElementById("bkCart");

/* ── Steps ──────────────────────────────────────────────────────────────── */
function needsPaymentStep() {
  if (!PREPAYMENT.enabled) return false;
  // Only show payment step if the selected service has a price > 0
  const price = STATE.service?.price;
  return price !== null && price !== undefined && Number(price) > 0;
}

function buildSteps() {
  const steps = [];
  if (SERVICES.length > 0)  steps.push({ id: "service",  label: "Service" });
  if (EMPLOYEES.length > 0 || hasAnyServiceEmployees()) steps.push({ id: "employee", label: "Avec" });
  steps.push({ id: "time",    label: "Créneau" });
  steps.push({ id: "details", label: "Détails" });
  if (needsPaymentStep())     steps.push({ id: "payment",  label: "Paiement" });
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
  const showEmployeeStep = svcEmployees.length > 0 || globalEmps;

  const steps = [];
  if (SERVICES.length > 0) steps.push({ id: "service",  label: "Service" });
  if (showEmployeeStep)     steps.push({ id: "employee", label: "Avec" });
  steps.push({ id: "time",    label: "Créneau" });
  steps.push({ id: "details", label: "Détails" });
  if (needsPaymentStep())   steps.push({ id: "payment",  label: "Paiement" });
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

  const detailsOk = CLIENT
    ? !!(CLIENT.firstName && CLIENT.email)
    : !!(STATE.form.firstName && STATE.form.lastName && STATE.form.email);

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

/* ── Master render ──────────────────────────────────────────────────────── */
function render() {
  renderStepper();
  const sid = stepId();
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
  return `<div class="bk-svc ${sel}" data-svc="${s._id}">
    <div>
      <div class="bk-svc__name">${escHtml(s.name)}</div>
      ${s.description ? `<div class="bk-svc__desc">${escHtml(s.description)}</div>` : ""}
      <span class="bk-svc__dur">${s.duration} min</span>
    </div>
    ${price}
    <div class="bk-svc__check">
      <svg width="13" height="13" viewBox="0 -960 960 960" fill="currentColor"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>
    </div>
  </div>`;
}

/* ── Shared: pick a service card ─────────────────────────────────────────── */
function bindSvcCards(container) {
  container.querySelectorAll("[data-svc]").forEach(el => {
    el.onclick = () => {
      const svc = SERVICES.find(s => s._id === el.dataset.svc);
      if (!svc) return;
      STATE.service  = { id: svc._id, name: svc.name, price: svc.price, duration: svc.duration };
      STATE.employee = undefined;
      STATE.date     = null;
      STATE.time     = null;
      recomputeSteps();
      const svcHasEmps    = (svc.employees || []).length > 0;
      const globalHasEmps = EMPLOYEES.length > 0;
      if (svcHasEmps || globalHasEmps) goToStep("employee");
      else goToStep("time");
    };
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
        return `<div class="bk-emp ${sel}" data-emp="${e._id}">
          <div class="bk-emp__av">${pic}</div>
          <div class="bk-emp__name">${escHtml(fullName)}</div>
        </div>`;
      }).join("")}
    </div>
  </div>`;

  pane.querySelectorAll("[data-emp]").forEach(el => {
    el.onclick = () => {
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

        const isDisabled = isPast || isDayOff || (exception && (!exception.workingHours || exception.workingHours.length === 0));
        const isToday    = c.getTime() === realToday.getTime();
        const isSelected = STATE.date === iso;

        let cls = "bk-cal-cell";
        if (isDisabled)      cls += " is-disabled";
        else if (isFull || markedFull) cls += " is-full";
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
  const available = visible.filter(s => !s.taken).length;

  return `<div class="bk-slots">
    <h3>${fmtDate(STATE.date)}</h3>
    <p class="bk-slots__sub">${available} créneaux disponibles</p>
    <div class="bk-dayparts">
      ${dayparts.map(([id,lbl]) => `<button class="bk-daypart ${STATE.daypart===id?"is-active":""}" data-dp="${id}">${lbl}</button>`).join("")}
    </div>
    <div class="bk-slot-list">
      ${visible.length === 0
        ? `<div style="grid-column:1/-1; text-align:center; color:var(--bk-muted); font-size:12.5px; padding:20px 0;">Aucun créneau</div>`
        : visible.map(s => `<button class="bk-slot ${s.taken?"is-disabled":""} ${STATE.time===s.time?"is-selected":""}"
            data-time="${s.time}" ${s.taken?"disabled":""}>${s.time}</button>`).join("")
      }
    </div>
  </div>`;
}

let _currentSlots = [];

async function renderTimePane() {
  pane.innerHTML = `<div class="bk-pane">
    <h2 class="bk-pane-title">Choisissez votre créneau</h2>
    <p class="bk-pane-sub">Heure de Bruxelles (GMT+1).</p>
    <div class="bk-booker">
      <div class="bk-loading"><div class="bk-spinner"></div> Chargement…</div>
    </div>
  </div>`;

  await loadCalendarData();
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

  const [slotsRes, bookedRes] = await Promise.all([
    fetch("/get-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ index: dayOfWeek, COMPANY_ID, date: STATE.date, serviceDuration: serviceDur, employeeId: empId }),
    }),
    fetch(`/get-booking?date=${STATE.date}&companyId=${COMPANY_ID}&employeeId=${empId}${serviceDur ? `&serviceDuration=${serviceDur}` : ""}`),
  ]);

  const slotsData  = await slotsRes.json();
  const bookedData = await bookedRes.json();
  const booked     = new Set(bookedData.bookedTimes || []);

  _currentSlots = (slotsData.slots || []).map(t => ({ time: t, taken: booked.has(t) }));

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
            inputHtml = `<input class="bk-input bk-choice-input" data-qi="${i}" type="text" placeholder="" />`;
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
        <div class="bk-form-row">
          <div class="bk-field">
            <label class="bk-label">Prénom *</label>
            <input class="bk-input" id="bkFirstName" type="text" placeholder="Jean" value="${escHtml(f.firstName)}" />
          </div>
          <div class="bk-field">
            <label class="bk-label">Nom *</label>
            <input class="bk-input" id="bkLastName" type="text" placeholder="Dupont" value="${escHtml(f.lastName)}" />
          </div>
        </div>
        <div class="bk-field">
          <label class="bk-label">Email *</label>
          <input class="bk-input" id="bkEmail" type="email" placeholder="jean@email.com" value="${escHtml(f.email)}" />
        </div>
        <div class="bk-field">
          <label class="bk-label">Téléphone</label>
          <input class="bk-input" id="bkPhone" type="tel" placeholder="+32 …" value="${escHtml(f.phone)}" />
        </div>`}

      ${questionsHtml}

      <div class="bk-field">
        <label class="bk-label">Message (optionnel)</label>
        <textarea class="bk-textarea" id="bkMessage" rows="3" placeholder="Informations utiles…">${escHtml(f.message)}</textarea>
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
  // Personal info inputs — sync to STATE.form
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
    answers.push({ question: formQ.label, answer });
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
  const isRequired = PREPAYMENT.required;

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

  // If required and only Stripe available → force online
  if (isRequired && methods.includes("online") && STATE.paymentMethod !== "online") {
    STATE.paymentMethod = "online";
  }
  // Auto-select if only one method available and nothing selected yet
  if (!STATE.paymentMethod && methods.length === 1) {
    STATE.paymentMethod = methods[0];
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

  // ── Stripe card block ───────────────────────────────────────────────────────
  const stripeBlock = STATE.paymentMethod === "online" ? `
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
      Paiement obligatoire pour cette réservation
    </div>` : "";

  // ── Cancel policy (Stripe only) ─────────────────────────────────────────────
  const cancelPolicy = STATE.paymentMethod === "online" ? `
    <div class="bk-cancel-policy">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <div>
        <strong>Politique d'annulation</strong>
        <ul>
          <li>Annulation <strong>&gt; 24h</strong> : remboursement complet</li>
          <li>Annulation <strong>&lt; 24h</strong> : 50 % prélevés</li>
          <li>Absence sans annulation : 100 % prélevés</li>
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
  if (STATE.paymentMethod === "online") {
    mountStripeCard();
  }

  // Wire choice buttons
  document.getElementById("payChoiceOnline")?.addEventListener("click", () => selectPayMethod("online"));
  document.getElementById("payChoicePaypal")?.addEventListener("click", () => selectPayMethod("paypal"));
  document.getElementById("payChoiceOnSite")?.addEventListener("click", () => selectPayMethod("on_site"));
  document.getElementById("payChoiceBankTransfer")?.addEventListener("click", () => selectPayMethod("bank_transfer"));
}

function selectPayMethod(method) {
  if (method !== "online") {
    STATE.stripePaymentIntentId = null;
    if (_cardElement) { _cardElement.unmount(); _cardElement = null; }
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

  if (_cardElement) { _cardElement.unmount(); _cardElement = null; }

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
  });
}

/* ── Payment submit (called when "Confirmer et payer" is clicked) ─────────── */
async function submitBookingWithPayment() {
  // On-site, bank transfer or paypal → just confirm booking, no card charge needed
  if (STATE.paymentMethod === "on_site" || STATE.paymentMethod === "bank_transfer" || STATE.paymentMethod === "paypal") {
    submitBooking();
    return;
  }

  // method === "online"
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

  try {
    const email = CLIENT?.email || STATE.form.email;
    const name  = CLIENT
      ? `${CLIENT.firstName} ${CLIENT.lastName}`.trim()
      : `${STATE.form.firstName} ${STATE.form.lastName}`.trim();

    // 1. Create PaymentIntent on server (amount = service price)
    if (nextBtn) nextBtn.textContent = "Connexion sécurisée…";
    const amountEur   = STATE.service?.price || 0;
    const serviceName = STATE.service?.name  || "";
    const intentRes = await fetch("/api/booking/payment-intent", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email, name, amountEur, currency: "eur", companyId: COMPANY_ID, serviceName }),
    });
    const intentData = await intentRes.json().catch(() => ({}));
    if (!intentRes.ok) throw new Error(intentData.message || intentData.error || `Erreur serveur (${intentRes.status}).`);
    if (!intentData.clientSecret) throw new Error(intentData.error || "Erreur Stripe.");

    // 2. Confirm card payment with Stripe.js (charges the card immediately)
    if (nextBtn) nextBtn.textContent = "Validation du paiement…";
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

    // Payment succeeded → store intentId in state
    STATE.stripePaymentIntentId = paymentIntent.id;

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
        employeeId:      STATE.employee ? STATE.employee.id      : null,
        employeeName:    STATE.employee ? STATE.employee.name    : null,
        // ── Payment ──────────────────────────────────────────────────────────
        paymentMethod:          STATE.paymentMethod          || "none",
        stripePaymentIntentId:  STATE.stripePaymentIntentId  || null,
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
      } else if (data.error === "monthly_limit_reached") {
        alert("Ce professionnel ne peut plus accepter de nouvelles réservations ce mois-ci. Revenez le mois prochain ou contactez-les directement.");
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

  pane.innerHTML = `<div class="bk-pane">
    <div class="bk-conf">
      <div class="bk-conf__check">
        <svg width="32" height="32" viewBox="0 -960 960 960" fill="currentColor">
          <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/>
        </svg>
      </div>
      <h2>Vous êtes réservé·e !</h2>
      <p class="bk-conf__lead">Un email de confirmation est en route vers <strong>${escHtml(email)}</strong>.</p>

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

      <div class="bk-conf__actions">
        <button class="bk-btn bk-btn--ghost bk-btn--sm" onclick="window.location.reload()">Nouvelle réservation</button>
      </div>
    </div>
  </div>`;
}

/* ── Init ───────────────────────────────────────────────────────────────── */
// render() already dispatches to the right pane based on the first step id
render();
