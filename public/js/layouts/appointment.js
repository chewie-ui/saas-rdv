import {
  initDeleteAppointment,
  initCalendarHeader,
  initAppointmentPopup,
} from "../components/admin/appointment.admin.js";
import { createTimePicker } from "../utils/time-picker.js";

initDeleteAppointment();
initCalendarHeader();
initAppointmentPopup();

function toMinutes(timeStr) {
  const [h, m] = timeStr.trim().split(":").map(Number);
  return h * 60 + m;
}

function updateTimeline() {
  const timeline = document.getElementById("current-time-line");
  if (!timeline) return;

  // N'afficher la ligne que si aujourd'hui est dans la semaine visible
  const todayHeader = document.querySelector(".cell.day-header.today");
  if (!todayHeader) {
    timeline.style.display = "none";
    return;
  }

  // Use data-time attribute so half-hour cells (empty text) are also included
  const timeCells = Array.from(document.querySelectorAll(".cell.time[data-time]"));
  if (!timeCells.length) {
    timeline.style.display = "none";
    return;
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const firstMinutes = toMinutes(timeCells[0].dataset.time);
  const lastMinutes  = toMinutes(timeCells[timeCells.length - 1].dataset.time);

  if (nowMinutes < firstMinutes || nowMinutes > lastMinutes + 60) {
    timeline.style.display = "none";
    return;
  }

  const gridSection = document.querySelector(".grid-section");
  if (!gridSection) return;
  const gridRect = gridSection.getBoundingClientRect();

  // Positionnement horizontal : restreindre à la colonne du jour actuel
  const isMobile = window.matchMedia("(max-width: 819px)").matches;
  if (isMobile) {
    timeline.style.left  = "56px";
    timeline.style.width = "calc(100% - 56px)";
    timeline.style.right = "auto";
  } else {
    const todayRect = todayHeader.getBoundingClientRect();
    const leftOffset = todayRect.left - gridRect.left;
    timeline.style.left  = `${leftOffset}px`;
    timeline.style.width = `${todayRect.width}px`;
    timeline.style.right = "auto";
  }

  // Positionnement vertical — works with any row granularity (30 min, 60 min…)
  for (let i = 0; i < timeCells.length; i++) {
    const cellMin = toMinutes(timeCells[i].dataset.time);
    const nextMin =
      i < timeCells.length - 1
        ? toMinutes(timeCells[i + 1].dataset.time)
        : cellMin + 30;

    if (nowMinutes >= cellMin && nowMinutes < nextMin) {
      const cellRect = timeCells[i].getBoundingClientRect();
      const fraction = (nowMinutes - cellMin) / (nextMin - cellMin);
      const top = cellRect.top - gridRect.top + fraction * cellRect.height;
      timeline.style.top = `${top}px`;
      timeline.style.display = "block";
      return;
    }
  }

  timeline.style.display = "none";
}

updateTimeline();
setInterval(updateTimeline, 60000);

// ---- Mini month calendar ----
(function initMiniCalendar() {
  const trigger = document.getElementById("miniCalTrigger");
  const dropdown = document.getElementById("miniCalDropdown");
  const prevBtn = document.getElementById("miniCalPrev");
  const nextBtn = document.getElementById("miniCalNext");
  const title = document.getElementById("miniCalTitle");
  const daysEl = document.getElementById("miniCalDays");

  if (!trigger || !dropdown) return;

  // Portal: move dropdown to <body> to escape any overflow / transform / stacking context
  document.body.appendChild(dropdown);

  // Init current display month from URL param or today
  const params = new URLSearchParams(window.location.search);
  const paramDate = params.get("date") ? new Date(params.get("date") + "T12:00:00") : new Date();

  let displayYear = paramDate.getFullYear();
  let displayMonth = paramDate.getMonth(); // 0-based

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const focusedStr = `${paramDate.getFullYear()}-${String(paramDate.getMonth() + 1).padStart(2, "0")}-${String(paramDate.getDate()).padStart(2, "0")}`;

  const __t = window.__t || {};
  const MONTHS_FR = (__t.months && __t.months.length === 12)
    ? __t.months
    : ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];

  function renderCalendar() {
    title.textContent = `${MONTHS_FR[displayMonth]} ${displayYear}`;
    daysEl.innerHTML = "";

    const firstDay = new Date(displayYear, displayMonth, 1);
    const startDow = (firstDay.getDay() + 6) % 7; // 0=Mon
    const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();

    for (let i = 0; i < startDow; i++) {
      const empty = document.createElement("span");
      empty.className = "mini-cal-cell empty";
      daysEl.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mini-cal-cell";
      btn.textContent = d;

      const isoDate = `${displayYear}-${String(displayMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

      if (isoDate === todayStr) btn.classList.add("today");
      if (isoDate === focusedStr) btn.classList.add("focused");

      btn.addEventListener("click", () => {
        window.location.href = `/appointment?date=${isoDate}`;
      });

      daysEl.appendChild(btn);
    }
  }

  function positionDropdown() {
    const rect = trigger.getBoundingClientRect();
    const dropW = 264;
    // Aligner sur la gauche du trigger, sans déborder à droite
    let left = rect.left;
    if (left + dropW > window.innerWidth - 8) {
      left = window.innerWidth - dropW - 8;
    }
    if (left < 8) left = 8;
    dropdown.style.top  = `${rect.bottom + 6}px`;
    dropdown.style.left = `${left}px`;
  }

  // Toggle
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains("open");
    if (!isOpen) {
      renderCalendar();
      positionDropdown();
    }
    dropdown.classList.toggle("open", !isOpen);
  });

  // Repositionner si resize (pas besoin de scroll car le trigger ne bouge pas)
  window.addEventListener("resize", () => {
    if (dropdown.classList.contains("open")) positionDropdown();
  });

  // Fermer au clic hors du dropdown (un seul handler, vérifie le DOM)
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && e.target !== trigger) {
      dropdown.classList.remove("open");
    }
  });

  // Prev / Next month
  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    displayMonth--;
    if (displayMonth < 0) { displayMonth = 11; displayYear--; }
    renderCalendar();
  });

  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    displayMonth++;
    if (displayMonth > 11) { displayMonth = 0; displayYear++; }
    renderCalendar();
  });

  renderCalendar();
})();

// ── Nouveau rendez-vous (panel admin) ─────────────────────────────────────
(function () {
  const openBtn  = document.getElementById("newApptBtn");
  const overlay  = document.getElementById("newApptOverlay");
  const closeBtn = document.getElementById("newApptClose");
  const cancelBtn = document.getElementById("newApptCancel");
  const submitBtn = document.getElementById("newApptSubmit");
  const errorEl  = document.getElementById("newApptError");

  if (!openBtn || !overlay) return;

  const dateInput    = document.getElementById("newApptDate");
  const serviceSel   = document.getElementById("newApptService");
  const employeeSel  = document.getElementById("newApptEmployee");
  const nameInput    = document.getElementById("newApptName");
  const surnameInput = document.getElementById("newApptSurname");
  const emailInput   = document.getElementById("newApptEmail");
  const phoneInput   = document.getElementById("newApptPhone");
  const messageInput = document.getElementById("newApptMessage");
  const durationEl   = document.getElementById("newApptDuration");
  const endTimeEl    = document.getElementById("newApptEndTime");
  const serviceDurationHint = document.getElementById("newApptServiceDuration");
  const defaultSlotTime = window.__defaultSlotTime || 60;
  // Durée "glissée" sur le calendrier (clic-glisser) — prioritaire sur la
  // durée par défaut tant qu'aucun service n'est choisi (un service choisi
  // reprend la main, comme avant).
  let manualDurationOverride = null;

  function minutesOf(hhmm) {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }
  function hhmmOf(totalMinutes) {
    const m = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }
  function durationLabel(diff) {
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return h > 0 ? `${h} h${m ? String(m).padStart(2, "0") : ""}` : `${m} min`;
  }

  // Heure de fin et durée ne se choisissent pas à la main : elles découlent
  // toujours de l'heure de début + la durée du service sélectionné, ou — si
  // aucun service n'est choisi — de la durée par défaut des rendez-vous
  // définie dans les paramètres de l'entreprise (`defaultSlotTime`).
  function recomputeEndAndDuration() {
    const opt = serviceSel && serviceSel.options[serviceSel.selectedIndex];
    const serviceDuration = opt && opt.dataset.duration ? Number(opt.dataset.duration) : null;
    const duration = serviceDuration || manualDurationOverride || defaultSlotTime;

    if (serviceDurationHint) {
      serviceDurationHint.textContent = serviceDuration ? ` · ${serviceDuration} min` : "";
    }

    const start = minutesOf(startPicker.get());
    if (start === null) {
      endTimeEl.textContent = "--:--";
      durationEl.textContent = "—";
      return;
    }
    endTimeEl.textContent = hhmmOf(start + duration);
    durationEl.textContent = durationLabel(duration);
  }

  const startPicker = createTimePicker(
    document.getElementById("newApptStartBox"),
    document.getElementById("newApptStartPanel"),
    document.getElementById("newApptStartList"),
    () => { recomputeEndAndDuration(); }
  );

  if (serviceSel) serviceSel.addEventListener("change", recomputeEndAndDuration);

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  }

  function resetForm() {
    dateInput.value = "";
    startPicker.set("");
    if (serviceSel) serviceSel.value = "";
    if (employeeSel) employeeSel.value = "";
    nameInput.value = "";
    surnameInput.value = "";
    emailInput.value = "";
    phoneInput.value = "";
    messageInput.value = "";
    errorEl.style.display = "none";
    errorEl.textContent = "";
    if (serviceDurationHint) serviceDurationHint.textContent = "";
    endTimeEl.textContent = "--:--";
    durationEl.textContent = "—";
    manualDurationOverride = null;
  }

  function open(prefill) {
    resetForm();
    const today = new Date();
    dateInput.value = (prefill && prefill.date) ||
      `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (prefill && prefill.time) startPicker.set(prefill.time);
    if (prefill && prefill.duration) manualDurationOverride = prefill.duration;

    // Pré-sélectionne l'employé déjà filtré dans le calendrier, sauf si le
    // clic sur une case précise visait un employé différent.
    if (employeeSel) {
      const empFilter = document.getElementById("empFilterSelect");
      const wantedEmployeeId = (prefill && prefill.employeeId) ||
        (empFilter && empFilter.value !== "all" ? empFilter.value : "");
      if (wantedEmployeeId) employeeSel.value = wantedEmployeeId;
    }

    overlay.classList.add("show");
    recomputeEndAndDuration();
    nameInput.focus();
  }

  // Exposé pour le clic-glisser sur le calendrier (autre IIFE plus bas).
  window.__openNewApptModal = open;

  function close() {
    overlay.classList.remove("show");
    document.querySelectorAll(".appt-time-panel.open").forEach((p) => p.classList.remove("open"));
  }

  openBtn.addEventListener("click", () => open());
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("show")) close();
  });

  // Le clic simple ET le clic-glisser sur une case vide du calendrier sont
  // gérés ensemble plus bas (voir "Clic-glisser pour créer un RDV") — ça
  // appelle window.__openNewApptModal(...) défini juste au-dessus.

  // ── Vue Mois : bouton "+" sur une case jour (sans heure précise) ──────────
  document.querySelectorAll(".cal-month__add-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      open({ date: btn.dataset.iso });
    });
  });

  submitBtn.addEventListener("click", async () => {
    errorEl.style.display = "none";

    const date  = dateInput.value;
    const time  = startPicker.get();
    const name  = nameInput.value.trim();
    const email = emailInput.value.trim();

    if (!date || !time || !name || !email) {
      showError("Veuillez remplir les champs obligatoires (date, heure de début, prénom, email).");
      return;
    }

    const payload = {
      date,
      startTime: time,
      name,
      surname: surnameInput.value.trim(),
      email,
      phone: phoneInput.value.trim(),
      message: messageInput.value.trim(),
      serviceId: serviceSel ? serviceSel.value : "",
      employeeId: employeeSel ? employeeSel.value : "",
      // Durée glissée sur le calendrier (clic-glisser) — le serveur lui
      // donne priorité sur la durée par défaut, mais le service choisi (s'il
      // y en a un) reste prioritaire sur les deux, comme affiché ici même.
      duration: manualDurationOverride || undefined,
    };

    submitBtn.disabled = true;
    try {
      const res = await fetch("/appointment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        window.location.reload();
      } else {
        showError(data.message || "Erreur lors de la création du rendez-vous.");
        submitBtn.disabled = false;
      }
    } catch (e) {
      showError("Erreur réseau.");
      submitBtn.disabled = false;
    }
  });
})();

// ── Marquer une absence (panel admin) ───────────────────────────────────────
// Ouverte depuis le choix "Absence" après un clic-glisser sur le calendrier
// (voir "Clic-glisser pour créer un RDV" plus bas, qui appelle
// window.__openBlockApptModal). Occupe le créneau comme un vrai RDV côté
// serveur (mêmes règles de chevauchement) mais sans client.
(function () {
  const overlay   = document.getElementById("blockApptOverlay");
  const closeBtn  = document.getElementById("blockApptClose");
  const cancelBtn = document.getElementById("blockApptCancel");
  const submitBtn = document.getElementById("blockApptSubmit");
  const errorEl   = document.getElementById("blockApptError");
  if (!overlay || !submitBtn) return;

  const dateEl      = document.getElementById("blockApptDate");
  const rangeEl     = document.getElementById("blockApptRange");
  const employeeSel = document.getElementById("blockApptEmployee");
  const noteInput   = document.getElementById("blockApptNote");

  let current = null; // { date, time, endTime }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  }

  function close() {
    overlay.classList.remove("show");
  }

  function open(info) {
    current = info;
    errorEl.style.display = "none";
    errorEl.textContent = "";
    noteInput.value = "";
    if (employeeSel) employeeSel.value = "";
    if (dateEl) {
      const [y, m, d] = info.date.split("-");
      dateEl.textContent = `${d}/${m}/${y}`;
    }
    if (rangeEl) rangeEl.textContent = `${info.time} – ${info.endTime}`;
    overlay.classList.add("show");
    noteInput.focus();
  }

  // Exposé pour le clic-glisser sur le calendrier (autre IIFE plus bas).
  window.__openBlockApptModal = open;

  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("show")) close();
  });

  submitBtn.addEventListener("click", async () => {
    if (!current) return;
    errorEl.style.display = "none";
    submitBtn.disabled = true;
    try {
      const res = await fetch("/appointment/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: current.date,
          startTime: current.time,
          endTime: current.endTime,
          employeeId: employeeSel ? employeeSel.value : "",
          note: noteInput.value.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        window.location.reload();
      } else {
        showError(data.message || "Erreur lors de la création de l'absence.");
        submitBtn.disabled = false;
      }
    } catch (e) {
      showError("Erreur réseau.");
      submitBtn.disabled = false;
    }
  });
})();

// ---- Densité du calendrier (Confort / Compact) ---------------------------
// Les RDV sont positionnés en continu (top + height) à partir de leur heure
// de début exacte (`data-start-minutes`) et de leur durée (`data-slot-minutes`),
// rapportées à la hauteur réelle (rendue) d'une ligne de 30 min — jamais une
// valeur figée — afin que TOUT s'adapte automatiquement : durée de service,
// RDV à une minute "impaire" (9h20 reste positionné dans sa case 9h–9h30 sans
// jamais resserrer toute la grille), mode Confort/Compact, redimensionnement.
(function initCalendarDensity() {
  const section = document.getElementById("calendarSection");
  if (!section) return;

  const STORAGE_KEY = "branshee_calendar_density";
  const gridStep = Number(section.dataset.gridStep) || 30;
  const minHourMinutes = (Number(section.dataset.minHour) || 0) * 60;
  const toggle = document.getElementById("calDensityToggle");

  function currentRowHeightPx() {
    const sample = section.querySelector(".cell.time:not(.time--half)") || section.querySelector(".cell.time");
    if (!sample) return 52;
    const h = sample.getBoundingClientRect().height;
    return h > 0 ? h : 52;
  }

  // Positionne chaque colonne "RDV" (une par jour) en mesurant la vraie
  // cellule d'en-tête correspondante — pas de placement CSS Grid, qui
  // perturbait l'auto-placement des cellules de fond.
  function positionDayColumns() {
    const gridSection = section.querySelector(".grid-section");
    if (!gridSection) return;
    const gridRect = gridSection.getBoundingClientRect();
    const headerCell = section.querySelector(".cell.time-header, .cell.day-header");
    const headerH = headerCell ? headerCell.getBoundingClientRect().height : 0;

    section.querySelectorAll(".day-events-col").forEach((col) => {
      const iso = col.dataset.iso;
      const headerForDay = gridSection.querySelector(`.cell.day-header[data-iso="${iso}"]`);
      if (!headerForDay || headerForDay.offsetParent === null) {
        col.style.display = "none";
        return;
      }
      const dayRect = headerForDay.getBoundingClientRect();
      col.style.display = "block";
      col.style.left = `${Math.round(dayRect.left - gridRect.left)}px`;
      col.style.width = `${Math.round(dayRect.width)}px`;
      col.style.top = `${Math.round(headerH)}px`;
      col.style.height = `${Math.round(gridRect.height - headerH)}px`;
    });
  }

  function applyApptHeights() {
    positionDayColumns();
    const rowH = currentRowHeightPx();
    const pxPerMin = rowH / gridStep;
    // Inset haut ET bas (pas juste en bas) pour que le RDV ne touche jamais
    // la ligne de grille du dessus — sinon ça colle visuellement à la case.
    const inset = Math.min(3, rowH * 0.06);
    section.querySelectorAll("[data-start-minutes]").forEach((el) => {
      const startMin = Number(el.dataset.startMinutes) || 0;
      const slotMin = Number(el.dataset.slotMinutes) || gridStep;
      const top = Math.round((startMin - minHourMinutes) * pxPerMin) + inset;
      const rawH = Math.round(slotMin * pxPerMin);
      const h = Math.max(rawH - inset * 2, Math.min(20, rowH - 2));
      el.style.top = `${top}px`;
      el.style.height = `${h}px`;
    });
  }

  function setCompact(enabled) {
    section.classList.toggle("is-compact", enabled);
    if (toggle) {
      toggle.querySelectorAll(".cal-view-btn").forEach((btn) => {
        btn.classList.toggle("is-active", (btn.dataset.density === "compact") === enabled);
      });
    }

    if (enabled) {
      const headerCell = section.querySelector(".cell.time-header, .cell.day-header");
      const headerH = headerCell ? headerCell.getBoundingClientRect().height : 0;
      const rowCells = section.querySelectorAll(".cell.time");
      const numRows = rowCells.length || 1;

      // Hauteur minimale de 22px par ligne — sous cette limite, le libellé
      // d'heure (ex: "08:00") n'a plus la place de s'afficher proprement.
      const MIN_ROW_H = 22;
      const top = section.getBoundingClientRect().top;
      const available = Math.max(window.innerHeight - top - 24, 200);
      const neededBody = numRows * MIN_ROW_H;
      const fitsWithoutScroll = headerH + neededBody <= available;

      // Si même à la hauteur minimale les heures ne rentrent pas (plage de
      // disponibilité très large), on autorise un léger scroll interne plutôt
      // que de couper silencieusement les heures en fin de journée.
      const bodyHeight = fitsWithoutScroll ? Math.max(available - headerH, neededBody) : neededBody;
      const rowH = Math.max(Math.floor(bodyHeight / numRows), MIN_ROW_H);

      section.style.height = `${available}px`;
      section.style.overflowY = fitsWithoutScroll ? "hidden" : "auto";
      section.style.setProperty("--cal-row-h", `${rowH}px`);
    } else {
      section.style.height = "";
      section.style.overflowY = "";
      section.style.removeProperty("--cal-row-h");
    }

    // Attendre que le reflow CSS soit appliqué avant de mesurer les lignes
    requestAnimationFrame(applyApptHeights);
  }

  if (toggle) {
    toggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".cal-view-btn");
      if (!btn) return;
      const compact = btn.dataset.density === "compact";
      localStorage.setItem(STORAGE_KEY, compact ? "compact" : "comfort");
      setCompact(compact);
    });
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  setCompact(saved === "compact");

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      setCompact(section.classList.contains("is-compact"));
    }, 150);
  });
})();

// ── Clic-glisser pour créer un RDV (façon Google Calendar) ─────────────────
// Glisser sur une case vide dessine un aperçu qui suit la durée glissée,
// puis ouvre "Nouveau rendez-vous" pré-rempli avec cette durée — un simple
// clic (sans glisser) garde l'ancien comportement (1 créneau de la grille).
// L'aperçu passe en rouge si la plage glissée chevauche déjà un RDV ce
// jour-là — un repère visuel seulement : la vraie validation (avec la
// logique employé : un employé B libre reste autorisé même si A est pris)
// se fait côté serveur à l'envoi du formulaire.
(function initDragToCreate() {
  const section = document.getElementById("calendarSection");
  if (!section) return;
  const gridSection = section.querySelector(".grid-section");
  if (!gridSection) return;

  const gridStep = Number(section.dataset.gridStep) || 30;
  const minHourMinutes = (Number(section.dataset.minHour) || 0) * 60;

  function rowHeightPx() {
    const sample = section.querySelector(".cell.time:not(.time--half)") || section.querySelector(".cell.time");
    const h = sample ? sample.getBoundingClientRect().height : 0;
    return h > 0 ? h : 52;
  }

  function minutesToHHMM(min) {
    const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }

  function timeToMinutes(hhmm) {
    const [h, m] = (hhmm || "0:0").split(":").map(Number);
    return h * 60 + m;
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && aEnd > bStart;
  }

  function getEventsCol(iso) {
    return section.querySelector(`.day-events-col[data-iso="${iso}"]`);
  }

  function existingRangesForDay(iso) {
    const col = getEventsCol(iso);
    if (!col) return [];
    return Array.from(col.querySelectorAll("[data-start-minutes]")).map((el) => {
      const s = Number(el.dataset.startMinutes) || 0;
      const d = Number(el.dataset.slotMinutes) || gridStep;
      return [s, s + d];
    });
  }

  // Cellule .cell.day du même jour la plus proche verticalement du point Y.
  function cellAt(iso, clientY) {
    const cells = gridSection.querySelectorAll(`.cell.day[data-iso="${iso}"]`);
    let closest = null;
    let bestDist = Infinity;
    cells.forEach((c) => {
      const r = c.getBoundingClientRect();
      const dist = Math.abs(clientY - (r.top + r.height / 2));
      if (dist < bestDist) { bestDist = dist; closest = c; }
    });
    return closest;
  }

  let drag = null;

  function updateGhost(currentMin) {
    if (!drag) return;
    const rowH = rowHeightPx();
    const pxPerMin = rowH / gridStep;
    const startMin = Math.min(drag.startMin, currentMin);
    const endMin = Math.max(drag.startMin, currentMin) + gridStep;

    drag.ghost.style.top = `${Math.round((startMin - minHourMinutes) * pxPerMin)}px`;
    drag.ghost.style.height = `${Math.round((endMin - startMin) * pxPerMin)}px`;
    drag.ghost.textContent = `${minutesToHHMM(startMin)} – ${minutesToHHMM(endMin)}`;

    const conflict = existingRangesForDay(drag.iso).some(([rs, re]) => rangesOverlap(startMin, endMin, rs, re));
    drag.ghost.classList.toggle("cal-drag-ghost--conflict", conflict);

    drag.finalStart = startMin;
    drag.finalEnd = endMin;
  }

  function onMouseMove(e) {
    if (!drag) return;
    const cell = cellAt(drag.iso, e.clientY);
    const currentMin = cell ? timeToMinutes(cell.dataset.time) : drag.startMin;
    updateGhost(currentMin);
  }

  function showDragChoice(anchorRect, info) {
    const menu = document.getElementById("dragChoice");
    const apptBtn = document.getElementById("dragChoiceAppt");
    const blockBtn = document.getElementById("dragChoiceBlock");

    function openApptModal() {
      if (typeof window.__openNewApptModal === "function") {
        window.__openNewApptModal({
          date: info.date,
          time: minutesToHHMM(info.startMin),
          duration: Math.max(gridStep, info.endMin - info.startMin),
        });
      }
    }

    // Pas de choix dispo sur cette page (page sans la modale d'absence) →
    // ancien comportement, ouvre directement "Nouveau rendez-vous".
    if (!menu || !apptBtn || !blockBtn) { openApptModal(); return; }

    const top = Math.max(8, Math.min(anchorRect.bottom + 6, window.innerHeight - 100));
    const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 200));
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.display = "flex";

    function cleanup() {
      menu.style.display = "none";
      apptBtn.removeEventListener("click", onApptChoice);
      blockBtn.removeEventListener("click", onBlockChoice);
      document.removeEventListener("mousedown", onOutside, true);
    }
    function onApptChoice() { cleanup(); openApptModal(); }
    function onBlockChoice() {
      cleanup();
      if (typeof window.__openBlockApptModal === "function") {
        window.__openBlockApptModal({
          date: info.date,
          time: minutesToHHMM(info.startMin),
          endTime: minutesToHHMM(info.endMin),
        });
      }
    }
    function onOutside(e) { if (!menu.contains(e.target)) cleanup(); }

    apptBtn.addEventListener("click", onApptChoice);
    blockBtn.addEventListener("click", onBlockChoice);
    // Capture + délai : sinon le mouseup qui vient de déclencher ce menu le referme aussitôt.
    setTimeout(() => document.addEventListener("mousedown", onOutside, true), 0);
  }

  // Annule un glisser en cours sans rien ouvrir — utilisé en filet de
  // sécurité (voir plus bas) quand le navigateur ne reçoit jamais le
  // "mouseup" qui termine normalement le glisser (ex: l'outil de capture
  // Windows "Win+Maj+S" pris EN PLEIN glisser garde la souris "enfoncée"
  // du point de vue de la page — sans ça, le ghost reste affiché pour
  // toujours et un nouveau glisser s'empile par-dessus au lieu de le
  // remplacer).
  function cancelDrag() {
    if (!drag) return;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    drag.ghost.remove();
    drag = null;
  }

  function onMouseUp() {
    if (!drag) return;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);

    const { iso, finalStart, finalEnd, ghost } = drag;
    const anchorRect = ghost.getBoundingClientRect();
    ghost.remove();
    drag = null;

    showDragChoice(anchorRect, { date: iso, startMin: finalStart, endMin: finalEnd });
  }

  // La fenêtre perd le focus (capture d'écran, alt-tab, autre appli au
  // premier plan...) → on ne saura jamais si le bouton de la souris a été
  // relâché ailleurs, donc on annule plutôt que de laisser un ghost orphelin.
  window.addEventListener("blur", cancelDrag);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelDrag();
  });

  gridSection.querySelectorAll(".cell.day").forEach((cell) => {
    cell.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return; // clic gauche uniquement
      cancelDrag(); // au cas où un glisser précédent serait resté coincé
      const iso = cell.dataset.iso;
      const startMin = timeToMinutes(cell.dataset.time);
      const col = getEventsCol(iso);
      if (!col) return;

      const ghost = document.createElement("div");
      ghost.className = "cal-drag-ghost";
      col.appendChild(ghost);

      drag = { iso, startMin, ghost, finalStart: startMin, finalEnd: startMin + gridStep };
      updateGhost(startMin);

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      e.preventDefault();
    });
  });
})();
