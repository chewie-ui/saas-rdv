const availability = document.querySelector(".body-weekly-hour");

// ── Shared helpers ────────────────────────────────────────────────────────────
function timeToMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function showTimeError(msg) {
  // Remove any existing toast
  document.querySelectorAll(".avail-time-error-toast").forEach(t => t.remove());
  const toast = document.createElement("div");
  toast.className = "avail-time-error-toast";
  toast.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg>${msg}`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

const inputsListener = availability.querySelectorAll(
  ".slot-hour .panel-availability",
);

document.addEventListener("click", async (event) => {
  const slot = event.target.closest(".slot-hour");
  const hourItem = event.target.closest(".hour");
  const insideAvailability = event.target.closest(".body-weekly-hour");
  const addDaysOffBtn = event.target.closest("#addDaysOffBtn");

  const timeslotPanel = event.target.closest("#timeslotPanel");
  const slotTime = event.target.closest(".time");
  const allPanels = document.querySelectorAll(".panel-availability");

  const timeslotPanelEl = document.getElementById("timeslotPanel");
  // Guard: panel may be disabled (slot-managed) — do nothing in that case
  const slotSection = document.querySelector(".slot-time-section");
  const isManaged = slotSection && slotSection.classList.contains("slot-managed");

  if (timeslotPanel && !isManaged) {
    timeslotPanelEl?.querySelector(".panel")?.classList.toggle("open");
  } else {
    timeslotPanelEl?.querySelector(".panel")?.classList.remove("open");
  }

  if (slotTime) {
    const slot = Number(slotTime.dataset.time);

    await fetch("/edit-interval", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slot,
      }),
    });

    document
      .getElementById("timeslotPanel")
      .querySelector(".input").textContent = `${slot}min`;

    return;
  }

  // 🔥 Si on clique sur une heure dans le panel
  // if (hourItem) {
  //   const panel = hourItem.closest(".panel-availability");
  //   const slotParent = hourItem.closest(".slot-hour");
  //   const display = slotParent.querySelector(".hour-container");
  //   const container = hourItem.closest(".time-slot");

  //   function timeToMinutes(time) {
  //     const [hours, minutes] = time.split(":").map(Number);
  //     return hours * 60 + minutes;
  //   }

  //   let startMinutes;
  //   let endMinutes;
  //   let endHourText;

  //   if (slotParent.classList.contains("start-hour")) {
  //     endHourText = container
  //       .querySelector(".end-hour .hour-container")
  //       .textContent.trim();

  //     startMinutes = timeToMinutes(hourItem.textContent);
  //     endMinutes = timeToMinutes(endHourText);
  //   } else {
  //     endHourText = container
  //       .querySelector(".start-hour .hour-container")
  //       .textContent.trim();

  //     endMinutes = timeToMinutes(hourItem.textContent);
  //     startMinutes = timeToMinutes(endHourText);
  //   }

  //   if (startMinutes >= endMinutes) {
  //     console.log("❌ L'heure de début doit être avant l'heure de fin");
  //   } else {
  //     console.log("✅ Horaire valide");
  //     display.textContent = hourItem.textContent;

  //     const row = hourItem.closest(".row-weekday");
  //     const switcherInput = row.querySelector(".switch input");
  //     const weekdayIndex = switcherInput.getAttribute("data-weekday-index");
  //     const companyId = switcherInput.getAttribute("data-company");
  //     const timeSlots = row.querySelectorAll(".time-slot");

  //     const workingHours = [];

  //     timeSlots.forEach((slot) => {
  //       const start = slot
  //         .querySelector(".start-hour .hour-container")
  //         .textContent.trim();
  //       const end = slot
  //         .querySelector(".end-hour .hour-container")
  //         .textContent.trim();

  //       workingHours.push({ start, end });
  //     });

  //     await fetch("/edit-availability", {
  //       headers: { "Content-Type": "application/json" },
  //       method: "POST",
  //       body: JSON.stringify({
  //         companyId,
  //         weekdayIndex,
  //         workingHours,
  //       }),
  //     });
  //   }

  //   panel.classList.remove("open");
  //   return; // IMPORTANT → on stop ici
  // }

  if (hourItem) {
    const panel = hourItem.closest(".panel-availability");
    // Une fois le panel "portalé" (cf. openDoffPanelPortal plus bas), il n'est
    // plus un descendant de son .slot-hour / #holidaysBody d'origine — .hour
    // a été déplacé avec lui. `_portalAnchor` (l'ancien parent, resté en
    // place) sert alors de remplacement fiable pour retrouver ce contexte.
    const slotParent = panel.dataset.portaled === "1" && panel._portalAnchor
      ? panel._portalAnchor
      : hourItem.closest(".slot-hour");
    const display = slotParent.querySelector(".hour-container");
    const container = slotParent.closest(".time-slot");

    // Si le clic vient d'une ligne de congé, le handler holidaysBody gère l'API
    // On se contente de mettre à jour l'affichage et fermer le panel
    if (slotParent.closest("#holidaysBody")) {
      display.textContent = hourItem.textContent.trim();
      panel.classList.remove("open");
      return;
    }

    function validateWorkingHours(workingHours) {
      const slots = workingHours
        .map((s) => ({
          start: s.start,
          end: s.end,
          startMin: timeToMinutes(s.start),
          endMin: timeToMinutes(s.end),
        }))
        .sort((a, b) => a.startMin - b.startMin);

      // 1) start < end pour chaque slot
      for (const s of slots) {
        if (s.startMin >= s.endMin) {
          return {
            ok: false,
            reason: `Créneau invalide: ${s.start} - ${s.end}`,
          };
        }
      }

      // 2) pas de chevauchement + slot2.start >= slot1.end
      for (let i = 1; i < slots.length; i++) {
        const prev = slots[i - 1];
        const curr = slots[i];

        if (curr.startMin < prev.endMin) {
          return {
            ok: false,
            reason: `Le créneau ${curr.start}-${curr.end} doit commencer après ${prev.end}`,
          };
        }
      }

      return {
        ok: true,
        sorted: slots.map(({ start, end }) => ({ start, end })),
      };
    }

    // ---- Validation du slot courant (start < end) ----
    let startMinutes;
    let endMinutes;
    let otherHourText;

    if (slotParent.classList.contains("start-hour")) {
      otherHourText = container
        .querySelector(".end-hour .hour-container")
        .textContent.trim();

      startMinutes = timeToMinutes(hourItem.textContent.trim());
      endMinutes = timeToMinutes(otherHourText);
    } else {
      otherHourText = container
        .querySelector(".start-hour .hour-container")
        .textContent.trim();

      endMinutes = timeToMinutes(hourItem.textContent.trim());
      startMinutes = timeToMinutes(otherHourText);
    }

    if (startMinutes >= endMinutes) {
      showTimeError("L'heure de fin doit être supérieure à l'heure de début");
      panel.classList.remove("open");
      return;
    }

    // ---- On applique visuellement, mais on garde l'ancienne valeur pour rollback ----
    const previousValue = display.textContent.trim();
    display.textContent = hourItem.textContent.trim();

    // ---- Rebuild + validation globale (slot2 après slot1, pas de chevauchement) ----
    const row = hourItem.closest(".avail-day-row");
    const switcherInput = row.querySelector(".input-weekday");
    const weekdayIndex = switcherInput.getAttribute("data-weekday-index");
    const companyId = switcherInput.getAttribute("data-company");
    const employeeId = switcherInput.getAttribute("data-employee-id");
    const timeSlots = row.querySelectorAll(".time-slot");

    const workingHours = [];
    timeSlots.forEach((slot) => {
      const start = slot
        .querySelector(".start-hour .hour-container")
        .textContent.trim();
      const end = slot
        .querySelector(".end-hour .hour-container")
        .textContent.trim();
      workingHours.push({ start, end });
    });

    const check = validateWorkingHours(workingHours);

    if (!check.ok) {
      // rollback si invalide (ex: slot2 commence avant la fin du slot1)
      display.textContent = previousValue;
      showTimeError(check.reason);
      panel.classList.remove("open");
      return;
    }

    // ---- Envoi backend (trié propre) ----
    await fetch("/edit-availability", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({
        companyId,
        weekdayIndex,
        workingHours: check.sorted,
        employeeId,
      }),
    });

    panel.classList.remove("open");
    return; // IMPORTANT → on stop ici
  }

  // 🔥 Si on clique sur un slot → ouvrir
  if (slot) {
    allPanels.forEach((panel) => panel.classList.remove("open"));
    slot.querySelector(".panel-availability")?.classList.add("open");
  }

  // 🔥 Clique ailleurs → fermer tout
  else if (!insideAvailability) {
    allPanels.forEach((panel) => panel.classList.remove("open"));
  }

  if (addDaysOffBtn) {
    const isBasic = !window.__availFeatures || !window.__availFeatures.ranges;
    const currentCount = document.querySelectorAll('#holidaysBody .avail-doff-card').length;
    if (isBasic && currentCount >= 1) {
      if (typeof window.__alertModal === 'function') {
        window.__alertModal('Passez au Pro pour définir plusieurs congés.', 'upgrade');
      } else {
        const banner = document.createElement('div');
        banner.className = 'avail-upsell-toast';
        banner.innerHTML = `<span>1 congé inclus en gratuit — <a href="/subscription">Passer au Pro</a> pour en ajouter plusieurs.</span>`;
        document.body.appendChild(banner);
        setTimeout(() => banner.remove(), 4000);
      }
      return;
    }
    const renderCalendar = document.querySelector("#renderCalendar");
    renderCalendar.classList.add("show");
    getDaysOff();
  }
  const dayOffBtnDelete = event.target.closest(".days-off__button.delete-btn");

  if (dayOffBtnDelete) {
    const row = dayOffBtnDelete.closest(".days-off__row");
    let id, dateKey;
    try {
      const entry = row.dataset.date ? JSON.parse(row.dataset.date) : null;
      id = entry ? entry._id : null;
      dateKey = entry ? new Date(entry.date).toISOString().split("T")[0] : null;
    } catch { id = null; dateKey = null; }

    if (!id) {
      if (dateKey) removeDay(dateKey);
      row.remove();
      return;
    }

    const result = await fetch(`/company/days-off/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });

    const data = await result.json();
    if (data) {
      if (dateKey) removeDay(dateKey);
      row.remove();
    }

    return;
  }

  // 🔥 Fermer tous les panels si on clique en dehors
  if (
    !event.target.closest(".slot-hour") &&
    !event.target.closest(".panel-availability")
  ) {
    allPanels.forEach((panel) => panel.classList.remove("open"));
  }
});

const inputsWeekday = document.querySelectorAll(".input-weekday");

inputsWeekday.forEach((input) => {
  input.addEventListener("click", async () => {
    const weekdayIndex = input.getAttribute("data-weekday-index");
    const companyId = input.getAttribute("data-company");
    const employeeId = input.getAttribute("data-employee-id");
    const dayOff = !input.checked;

    const res = await fetch("/toggle-day", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({
        companyId,
        weekdayIndex,
        dayOff,
        employeeId,
      }),
    });
    const data = await res.json();

    // ── Update DOM immediately — no page refresh needed ──────────────
    const row = input.closest(".avail-day-row");
    if (!row) return;

    const timesContainer = row.querySelector(".avail-day-times");
    if (!timesContainer) return;

    if (dayOff) {
      // Day turned OFF → add class + replace slots with dashes
      row.classList.add("day-off");
      timesContainer.innerHTML =
        '<span class="avail-dash">—</span>' +
        '<span class="avail-dash">—</span>' +
        '<span class="avail-dash">—</span>';
    } else {
      // Day turned ON → remove class + insert default 09:00–18:00 slot
      row.classList.remove("day-off");

      // Build the hours list from an existing panel or generate them
      const existingPanel = document.querySelector(".panel-availability");
      const hoursHTML = existingPanel
        ? existingPanel.innerHTML
        : Array.from({ length: 25 }, (_, i) => `<div class="hour">${String(i).padStart(2,"0")}:00</div>`).join("");

      timesContainer.innerHTML = `
        <div class="time-slot flex-c" data-weekday-index="${weekdayIndex}">
          <div class="start-hour slot-hour">
            <div class="avail-time-box hour-container start-hour-" data-hours="start">09:00</div>
            <div class="panel-availability">${hoursHTML}</div>
          </div>
          <span class="avail-sep">—</span>
          <div class="end-hour slot-hour">
            <div class="avail-time-box hour-container end-hour-" data-hours="end">18:00</div>
            <div class="panel-availability">${hoursHTML}</div>
          </div>
        </div>`;

      // Observe new panels so the compact time picker works on freshly activated days
      timesContainer.querySelectorAll('.panel-availability').forEach(function(p) {
        _panelObserver.observe(p, { attributes: true });
        injectPanelSearch(p);
      });

      // Restore the Range button — respect plan limits
      const actionsContainer = row.querySelector(".avail-day-actions");
      if (actionsContainer && !actionsContainer.querySelector(".avail-range-btn")) {
        const hasRanges = window.__availFeatures && window.__availFeatures.ranges;
        if (hasRanges) {
          actionsContainer.insertAdjacentHTML("afterbegin", `
            <button class="avail-range-btn option-add-plage" type="button">
              <svg viewBox="0 -960 960 960" height="14" width="14" fill="currentColor">
                <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z"/>
              </svg>
              Range
            </button>`);
        } else {
          actionsContainer.insertAdjacentHTML("afterbegin", `
            <a class="avail-range-btn avail-range-btn--locked" href="/subscription" title="Fonctionnalité Pro">
              <svg viewBox="0 -960 960 960" height="13" width="13" fill="currentColor">
                <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm240-120q33 0 56.5-23.5T560-360q0-33-23.5-56.5T480-440q-33 0-56.5 23.5T400-360q0 33 23.5 56.5T480-280ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80Z"/>
              </svg>
              Range
            </a>`);
        }
      }
    }
  });
});

const rowOptions = document.querySelector(".body-weekly-hour");
if (rowOptions) {
  rowOptions.addEventListener("click", async (event) => {
    const deleteBtn = event.target.closest(".delete-time-slot");
    const addPlageBtn = event.target.closest(".option-add-plage");

    if (deleteBtn) {
      const row = deleteBtn.closest(".time-slot");
      const slotId = deleteBtn.dataset.id;

      const weekdayIndex = row.dataset.weekdayIndex;

      const result = await fetch(`/company/time-slot`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotId,
          weekdayIndex,
        }),
      });
      const data = await result.json();
      console.log(data);

      row.remove();
    }

    if (!addPlageBtn) return;

    if (addPlageBtn) {
      const row = addPlageBtn.closest(".avail-day-row");
      const plagesWrapper = row.querySelector(".avail-day-times");
      const template = document.getElementById("plageTemplate");
      const clone = template.content.cloneNode(true);

      // Get the last end-hour displayed in this row
      const allEndHours = row.querySelectorAll(".hour-container.end-hour-");
      const lastEnd = allEndHours[allEndHours.length - 1];
      const endHour = lastEnd ? lastEnd.textContent.trim() : "18:00";

      const [hour] = endHour.split(":");
      const nextHour = Math.min(parseInt(hour, 10) + 1, 23);

      const cloneStartHour = clone.querySelector(".hour-container.start-hour-");
      const cloneEndHour = clone.querySelector(".hour-container.end-hour-");

      cloneStartHour.textContent = endHour;
      cloneEndHour.textContent = `${String(nextHour).padStart(2, "0")}:00`;

      plagesWrapper.appendChild(clone);

      // Observe panels in the newly added range so the compact time picker works
      const newSlot = plagesWrapper.lastElementChild;
      if (newSlot) {
        newSlot.querySelectorAll('.panel-availability').forEach(function(p) {
          _panelObserver.observe(p, { attributes: true });
          injectPanelSearch(p);
        });
      }

      // Save updated working hours to backend
      const switcherInput = row.querySelector(".input-weekday");
      const weekdayIndex = switcherInput?.getAttribute("data-weekday-index");
      const companyId = switcherInput?.getAttribute("data-company");
      const employeeId = switcherInput?.getAttribute("data-employee-id");

      if (weekdayIndex != null && companyId) {
        const timeSlots = row.querySelectorAll(".time-slot");
        const workingHours = [];
        timeSlots.forEach((slot) => {
          const start = slot.querySelector(".start-hour .hour-container")?.textContent.trim();
          const end   = slot.querySelector(".end-hour .hour-container")?.textContent.trim();
          if (start && end) workingHours.push({ start, end });
        });

        await fetch("/edit-availability", {
          headers: { "Content-Type": "application/json" },
          method: "POST",
          body: JSON.stringify({ companyId, weekdayIndex, workingHours, employeeId }),
        });
      }
    }
  });
}
const dayOffRowTemplate = document.getElementById("dayOffRow");
const holidaysBody = document.getElementById("holidaysBody");
const calendar = document.querySelector(".calendar");
let daysOffArray = [];

if (holidaysBody) {
  holidaysBody.addEventListener("click", async (e) => {
    const deleteTimeSlot = e.target.closest(".delete-time-slot");
    const scheduleBtn = e.target.closest(".schedule-btn");
    const newHour = e.target.closest(".hour");

    // Un panel d'heures "portalé" (cf. openDoffPanelPortal plus bas, qui le
    // déplace hors de la carte pour échapper à son overflow:hidden) n'est
    // plus un descendant de sa .days-off__row d'origine — .hour non plus,
    // puisqu'il a été déplacé avec le panel. `_portalAnchor` (l'ancien
    // parent du panel, resté en place dans la ligne) permet de la retrouver
    // quand même, sans quoi `row` valait null et l'heure choisie n'était
    // jamais sauvegardée (seul l'affichage semblait se mettre à jour).
    let row = e.target.closest(".days-off__row");
    if (!row && newHour) {
      const panel = newHour.closest(".panel-availability");
      if (panel && panel.dataset.portaled === "1" && panel._portalAnchor) {
        row = panel._portalAnchor.closest(".days-off__row");
      }
    }
    if (!row) return;
    const container = row.querySelector(".days-off__schedule");
    const attributeRow = row.dataset.date;

    // Protéger contre les lignes sans data-date (ne devrait plus arriver mais sécurité)
    let dateId;
    try {
      dateId = attributeRow ? JSON.parse(attributeRow)._id : null;
    } catch {
      dateId = null;
    }

    if (!dateId && (deleteTimeSlot || scheduleBtn || newHour)) {
      console.warn("Impossible d'identifier ce congé (pas de dateId)");
      return;
    }

    if (deleteTimeSlot) {
      const dayOffLabel = document.querySelector('#dayOffRow')?.content?.querySelector('.schedule-status')?.textContent || 'Congé';
      container.innerHTML = `<div class="day-card__badge"><svg xmlns="http://www.w3.org/2000/svg" height="14px" viewBox="0 -960 960 960" width="14px" fill="currentColor"><path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg><span>${dayOffLabel}</span></div>`;
      await fetch(`/company/schedule-day-off`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateId,
          schedule: [],
        }),
      });
      return;
    }

    if (newHour) {
      const newHourPanel = newHour.closest(".panel-availability");
      const wrapper = (newHourPanel.dataset.portaled === "1" && newHourPanel._portalAnchor)
        ? newHourPanel._portalAnchor
        : newHour.closest(".slot-hour");
      const displayEl = wrapper.querySelector(".hour-container");
      const typeHour  = displayEl.dataset.hours;
      const setNewHour = newHour.textContent.trim();

      newHour.closest(".panel-availability").classList.remove("open");

      // On affiche toujours la valeur choisie — même invalide — au lieu de
      // la rejeter silencieusement : sinon, corriger ensuite l'AUTRE heure
      // pour rendre la paire valide se basait sur l'ancienne valeur restée
      // en place (jamais sur ce que l'utilisateur venait de saisir), et le
      // changement voulu ne se sauvegardait donc jamais (cf. retour client:
      // "j'ai mis 9h30 en fin, rejeté car début=14h30 ; j'ai corrigé le
      // début à minuit, mais après refresh la fin était revenue à 10h30").
      displayEl.textContent = setNewHour;

      const timeSlot = wrapper.closest(".time-slot");
      const startEl = timeSlot?.querySelector(".start-hour .hour-container");
      const endEl   = timeSlot?.querySelector(".end-hour .hour-container");
      const startText = (startEl?.textContent.trim()) || "00:00";
      const endText   = (endEl?.textContent.trim())   || "23:59";

      if (timeSlot && timeToMinutes(startText) >= timeToMinutes(endText)) {
        startEl?.classList.add("avail-time-box--error");
        endEl?.classList.add("avail-time-box--error");
        showTimeError("L'heure de fin doit être supérieure à l'heure de début");
        return;
      }
      startEl?.classList.remove("avail-time-box--error");
      endEl?.classList.remove("avail-time-box--error");

      // Sauvegarder en BDD — les deux heures du créneau, pas seulement
      // celle qu'on vient de cliquer : si l'autre heure avait été rejetée
      // plus tôt (paire alors invalide) et attend toujours d'être
      // persistée, ce recalcul la sauvegarde maintenant qu'elle est valide.
      await fetch(`/company/set-schedule-day-off`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "start", dateId, time: startText }),
      });
      await fetch(`/company/set-schedule-day-off`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "end", dateId, time: endText }),
      });

      return;
    }

    if (scheduleBtn) {
      e.stopPropagation(); // Prevent the main document click handler from interfering

      const template = document.querySelector("#plageTemplate");
      const clone = template.content.cloneNode(true);
      container.innerHTML = ``;
      container.appendChild(clone);

      // Use template defaults directly — never read from DOM (avoids interference
      // from open time-picker panels elsewhere on the page)
      const startHour = "09:00";
      const endHour   = "18:00";
      const schedule  = { start: startHour, end: endHour };

      // Observe new panels so the compact time picker (search/type-in) works here too
      container.querySelectorAll('.panel-availability').forEach(function(p) {
        _panelObserver.observe(p, { attributes: true });
        injectPanelSearch(p);
      });

      await fetch(`/company/schedule-day-off`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateId, schedule }),
      });

      return;
    }
  });
}

async function getDaysOff() {
  const res = await fetch("/company/get-days-off");
  const data = await res.json();

  if (data?.dates) {
    const mapped = data.dates.map(
      (d) => new Date(d.date).toISOString().split("T")[0],
    );
    daysOffArray = mapped;
    setDays(mapped);
  }
}

getDaysOff();

// ── Supprimer automatiquement les congés passés ──────────────────────────────
(async function cleanupPastDaysOff() {
  try {
    const res  = await fetch('/company/get-days-off');
    const data = await res.json();
    if (!data?.dates) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const past = data.dates.filter(function(d) { return d._id && new Date(d.date) < today; });
    for (var i = 0; i < past.length; i++) {
      var entry = past[i];
      await fetch('/company/days-off/' + entry._id, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
      var row = document.querySelector('[data-date*="' + entry._id + '"]');
      if (row) row.remove();
    }
    if (past.length > 0) console.log('[BranShee] ' + past.length + ' congé(s) passé(s) supprimé(s).');
  } catch(e) {}
})();

// ── "Réactiver" slot-time button ─────────────────────────────────────────────
const reenableBtn = document.querySelector(".slot-reenable-btn");
if (reenableBtn) {
  reenableBtn.addEventListener("click", () => {
    // Afficher un popup de confirmation avant de désactiver tous les services
    showSlotReenableConfirm();
  });
}

function showSlotReenableConfirm() {
  // Créer le modal s'il n'existe pas déjà
  let overlay = document.getElementById("slotReenableOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "slotReenableOverlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px)";
    overlay.innerHTML = `
      <div style="background:var(--surface-card,#fff);border-radius:14px;padding:28px 28px 24px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.2);display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#f59e0b"><path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z"/></svg>
          <h3 style="font-size:16px;font-weight:700;color:var(--ink,#111);margin:0;">Réactiver la durée globale ?</h3>
        </div>
        <p style="font-size:13.5px;color:var(--text-muted,#666);line-height:1.6;margin:0;">
          Cette action va <strong>désactiver tous vos services</strong> afin de libérer le contrôle de la durée globale des créneaux.<br><br>
          Vos services seront désactivés et n'apparaîtront plus sur votre page de réservation jusqu'à ce que vous les réactiviez manuellement.
        </p>
        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:4px;">
          <button id="slotReenableCancel" style="padding:8px 18px;border-radius:8px;border:1px solid var(--border-light,#e5e5e5);background:none;font-size:13px;cursor:pointer;color:var(--text-secondary,#555);">Annuler</button>
          <button id="slotReenableConfirm" style="padding:8px 18px;border-radius:8px;border:none;background:#f59e0b;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">Désactiver et réactiver</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById("slotReenableCancel").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById("slotReenableConfirm").addEventListener("click", async () => {
      overlay.remove();
      try {
        await fetch("/api/services/bulk-toggle", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: false }),
        });
      } catch (e) {
        console.warn("Impossible de désactiver les services:", e);
      }
      const section = document.querySelector(".slot-time-section");
      if (section) section.classList.remove("slot-managed");
      const info = document.querySelector(".slot-managed-info");
      if (info) info.style.display = "none";
    });
  }
}

import { getDays, setDays, addDay, removeDay } from "/js/components/calendarState.js";

/* ── Employee picker ─────────────────────────────────────────────────────── */
const EMPLOYEES = window.__employees || [];
const empPickerModal   = document.getElementById("empPickerModal");
const empPickerCancel  = document.getElementById("empPickerCancel");
const empPickerConfirm = document.getElementById("empPickerConfirm");
const empPickerList    = document.getElementById("empPickerList");
const empModeAll       = document.getElementById("empModeAll");
const empModeSpecific  = document.getElementById("empModeSpecific");

// Show/hide the specific employee list when mode changes
if (empModeAll && empModeSpecific && empPickerList) {
  const toggleList = () => {
    empPickerList.classList.toggle("is-open", empModeSpecific.checked);
  };
  empModeAll.addEventListener("change", toggleList);
  empModeSpecific.addEventListener("change", toggleList);
}

// Return selected employee IDs ([] = all)
function getSelectedEmployeeIds() {
  if (!empModeSpecific || !empModeSpecific.checked) return [];
  return Array.from(
    empPickerList?.querySelectorAll("input[type=checkbox]:checked") || []
  ).map(cb => cb.dataset.id);
}

// Pending state
let _pendingDayEl   = null;
let _pendingDateKey = null;
let _pendingEditId  = null; // null = add mode, string = edit mode

// Multi-select: array of { dateKey, dayEl } accumulated before opening empPicker
let _pendingDates = [];

function updateMultiSelectUI() {
  let floatBtn = document.getElementById("multiDayOffConfirm");
  if (_pendingDates.length === 0) {
    if (floatBtn) floatBtn.remove();
    return;
  }
  if (!floatBtn) {
    floatBtn = document.createElement("button");
    floatBtn.id = "multiDayOffConfirm";
    floatBtn.type = "button";
    floatBtn.style.cssText = [
      "position:fixed", "bottom:24px", "left:50%", "transform:translateX(-50%)",
      "z-index:500", "background:var(--main-color,#22c55e)", "color:#fff",
      "border:none", "border-radius:50px", "padding:12px 28px",
      "font-size:14px", "font-weight:600", "cursor:pointer",
      "box-shadow:0 4px 24px rgba(0,0,0,0.22)", "display:flex",
      "align-items:center", "gap:10px", "white-space:nowrap",
    ].join(";");
    floatBtn.innerHTML = `
      <svg viewBox="0 -960 960 960" height="18" width="18" fill="currentColor">
        <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/>
      </svg>
      <span></span>
      <button id="multiDayOffCancel" type="button" style="background:rgba(255,255,255,0.25);border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:16px;line-height:1;padding:0;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff;">×</button>
    `;
    document.body.appendChild(floatBtn);

    floatBtn.addEventListener("click", (e) => {
      if (e.target.id === "multiDayOffCancel" || e.target.closest("#multiDayOffCancel")) {
        clearMultiSelect();
        return;
      }
      if (!_pendingDates.length) return;
      // Pas d'employés → sauvegarder directement sans popup
      if (!EMPLOYEES.length) {
        const datesToSave = [..._pendingDates];
        clearMultiSelect();
        saveMultipleDaysOff(datesToSave, []);
      } else {
        _pendingDayEl   = null;
        _pendingDateKey = null;
        _pendingEditId  = null;
        const count = _pendingDates.length;
        const titleEl = document.getElementById("empPickerTitle");
        if (titleEl) titleEl.textContent = `Pour qui sont ces ${count} jour${count > 1 ? "s" : ""} de congé ?`;
        if (empModeAll) empModeAll.checked = true;
        if (empPickerList) {
          empPickerList.classList.remove("is-open");
          empPickerList.querySelectorAll("input[type=checkbox]").forEach(cb => (cb.checked = false));
        }
        if (empPickerModal) empPickerModal.style.display = "flex";
      }
    });
  }
  const count = _pendingDates.length;
  floatBtn.querySelector("span").textContent = `Valider ${count} jour${count > 1 ? "s" : ""} de congé`;
}

function clearMultiSelect() {
  _pendingDates.forEach(({ dayEl }) => dayEl.classList.remove("selected-day-off"));
  _pendingDates = [];
  updateMultiSelectUI();
}

async function saveMultipleDaysOff(dates, employeeIds) {
  for (const { dateKey, dayEl } of dates) {
    await saveDayOff(dayEl, dateKey, employeeIds);
  }
}

// ── Open picker in ADD mode ───────────────────────────────────────────────
function openEmpPicker(dayEl, dateKey) {
  _pendingDayEl   = dayEl;
  _pendingDateKey = dateKey;
  _pendingEditId  = null;

  if (!EMPLOYEES.length) {
    // No employees configured → save immediately (applies to whole company)
    saveDayOff(dayEl, dateKey, []);
    return;
  }

  // Reset state
  if (empModeAll) empModeAll.checked = true;
  if (empPickerList) {
    empPickerList.classList.remove("is-open");
    empPickerList.querySelectorAll("input[type=checkbox]").forEach(cb => (cb.checked = false));
  }
  const titleEl = document.getElementById("empPickerTitle");
  if (titleEl) titleEl.textContent = "Pour qui est ce congé ?";
  if (empPickerModal) empPickerModal.style.display = "flex";
}

// ── Open picker in EDIT mode (pre-fill current employees) ────────────────
function openEmpPickerEdit(dayEl, dateKey, entryId, currentEmployees) {
  if (!EMPLOYEES.length) return; // nothing to configure

  _pendingDayEl   = dayEl;
  _pendingDateKey = dateKey;
  _pendingEditId  = entryId;

  // Normalize current employee IDs (they may be objects or plain strings)
  const currentIds = (currentEmployees || []).map(e =>
    typeof e === "object" ? String(e._id) : String(e)
  );

  if (currentIds.length === 0) {
    if (empModeAll) empModeAll.checked = true;
    if (empPickerList) empPickerList.classList.remove("is-open");
  } else {
    if (empModeSpecific) empModeSpecific.checked = true;
    if (empPickerList) {
      empPickerList.classList.add("is-open");
      empPickerList.querySelectorAll("input[type=checkbox]").forEach(cb => {
        cb.checked = currentIds.includes(cb.dataset.id);
      });
    }
  }
  const titleEl = document.getElementById("empPickerTitle");
  if (titleEl) titleEl.textContent = "Modifier le congé";
  if (empPickerModal) empPickerModal.style.display = "flex";
}

// ── Close picker ──────────────────────────────────────────────────────────
function closeEmpPicker() {
  if (empPickerModal) empPickerModal.style.display = "none";
  _pendingDayEl   = null;
  _pendingDateKey = null;
  _pendingEditId  = null;
}

if (empPickerCancel) empPickerCancel.addEventListener("click", closeEmpPicker);
if (empPickerModal) {
  empPickerModal.addEventListener("click", e => {
    if (e.target === empPickerModal || e.target.classList.contains("emp-picker__backdrop")) {
      closeEmpPicker();
    }
  });
}

if (empPickerConfirm) {
  empPickerConfirm.addEventListener("click", () => {
    const ids = getSelectedEmployeeIds();
    if (empPickerModal) empPickerModal.style.display = "none";

    if (_pendingDates.length > 0) {
      // ── Multi-date mode ──────────────────────────────────────────
      const datesToSave = [..._pendingDates];
      clearMultiSelect();
      saveMultipleDaysOff(datesToSave, ids);
    } else if (_pendingEditId) {
      // ── Edit mode ────────────────────────────────────────────────
      updateDayOffEmployees(_pendingDateKey, _pendingEditId, ids);
      _pendingDayEl   = null;
      _pendingDateKey = null;
      _pendingEditId  = null;
    } else if (_pendingDayEl && _pendingDateKey) {
      // ── Single add mode ──────────────────────────────────────────
      saveDayOff(_pendingDayEl, _pendingDateKey, ids);
      _pendingDayEl   = null;
      _pendingDateKey = null;
      _pendingEditId  = null;
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

// Build employee chips HTML
function buildEmpChips(employeeIds) {
  if (!employeeIds || employeeIds.length === 0) {
    return `<span class="emp-chip emp-chip--all">Tous</span>`;
  }
  return employeeIds.map(id => {
    const emp = EMPLOYEES.find(e => String(e._id) === String(id));
    const name = emp ? `${emp.firstName} ${emp.lastName}` : String(id);
    return `<span class="emp-chip">${name}</span>`;
  }).join("");
}

// Find the card in holidaysBody matching a dateKey
function findCardByDateKey(dateKey) {
  return Array.from(holidaysBody.querySelectorAll(".days-off__row")).find(card => {
    try {
      const entry = JSON.parse(card.dataset.date);
      return new Date(entry.date).toISOString().split("T")[0] === dateKey;
    } catch { return false; }
  });
}

// ── ADD: save a new day-off ───────────────────────────────────────────────
async function saveDayOff(dayEl, dateKey, employeeIds) {
  const [year, month, day] = dateKey.split("-");

  const response = await fetch("/company/add-days-off", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dateKey, employeeIds }),
  });
  const data = await response.json();

  addDay(dateKey);
  dayEl.classList.add("clicked");

  const clone = dayOffRowTemplate.content.cloneNode(true);
  const MONTHS_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DAYS_ABBR   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const dateObj     = new Date(`${year}-${month}-${day}`);
  const dateFormatted = `${DAYS_ABBR[dateObj.getDay()]}, ${MONTHS_ABBR[dateObj.getMonth()]} ${parseInt(day)}`;

  const labelEl = clone.querySelector(".avail-doff-date-label");
  if (labelEl) labelEl.textContent = dateFormatted;

  const empsEl = clone.querySelector(".avail-doff-emps");
  if (empsEl) empsEl.innerHTML = buildEmpChips(employeeIds);

  const rowEl = clone.querySelector(".days-off__row");
  if (rowEl && data.dateEntry) {
    rowEl.dataset.date = JSON.stringify(data.dateEntry);
  }
  holidaysBody.appendChild(clone);
}

// ── EDIT: update employees on an existing day-off ─────────────────────────
async function updateDayOffEmployees(dateKey, entryId, employeeIds) {
  await fetch(`/company/days-off/${entryId}/employees`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeIds }),
  });

  // Update chips on the card
  const card = findCardByDateKey(dateKey);
  if (card) {
    const empsEl = card.querySelector(".avail-doff-emps");
    if (empsEl) empsEl.innerHTML = buildEmpChips(employeeIds);

    // Keep data-date in sync so the next edit has fresh employee IDs
    try {
      const entry = JSON.parse(card.dataset.date);
      entry.employees = employeeIds.map(id => {
        const emp = EMPLOYEES.find(e => String(e._id) === String(id));
        return emp ? { _id: id, firstName: emp.firstName, lastName: emp.lastName } : { _id: id };
      });
      card.dataset.date = JSON.stringify(entry);
    } catch (_) {}
  }
}

// ── Calendar click: multi-select add OR edit ──────────────────────────────
calendar.addEventListener("click", async (event) => {
  const dayEl = event.target.closest(".day:not(.empty)");
  if (!dayEl) return;

  const { day, month, year } = dayEl.dataset;
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const isAlreadyOff = getDays().includes(dateKey);

  if (isAlreadyOff) {
    // ── Edit mode: find entry and open picker pre-filled ──────────────────
    // Only available if employees are configured
    if (!EMPLOYEES.length) return;
    const card = findCardByDateKey(dateKey);
    if (!card) return;
    try {
      const entry = JSON.parse(card.dataset.date);
      openEmpPickerEdit(dayEl, dateKey, String(entry._id), entry.employees || []);
    } catch (_) {}
    return;
  }

  // ── Multi-select mode: toggle this date ──────────────────────────────────
  const existingIdx = _pendingDates.findIndex(d => d.dateKey === dateKey);
  if (existingIdx >= 0) {
    // Deselect
    _pendingDates.splice(existingIdx, 1);
    dayEl.classList.remove("selected-day-off");
  } else {
    // Select
    _pendingDates.push({ dateKey, dayEl });
    dayEl.classList.add("selected-day-off");
  }
  updateMultiSelectUI();
});

/* ── Slot duration pill buttons ──────────────────────────────── */
document.querySelectorAll(".slot-pill").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const slotSection = document.querySelector(".slot-time-section");
    if (slotSection && slotSection.classList.contains("slot-managed")) return;

    const slot = Number(btn.dataset.time);

    await fetch("/edit-interval", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot }),
    });

    document.querySelectorAll(".slot-pill").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");

    // Keep legacy hidden input in sync
    const legacyInput = document.querySelector("#timeslotPanel .input");
    if (legacyInput) legacyInput.textContent = `${slot}min`;
  });
});

/* ── Buffer before/after bookings sliders ───────────────────── */
const bufferBeforeRange = document.getElementById("bufferBeforeRange");
const bufferBeforeVal   = document.getElementById("bufferBeforeVal");
const bufferAfterRange  = document.getElementById("bufferAfterRange");
const bufferAfterVal    = document.getElementById("bufferAfterVal");

async function saveBufferTimes() {
  await fetch("/company/buffer", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bufferBefore: Number(bufferBeforeRange ? bufferBeforeRange.value : 0),
      bufferAfter: Number(bufferAfterRange ? bufferAfterRange.value : 0),
    }),
  }).catch(() => {});
}

if (bufferBeforeRange) {
  bufferBeforeRange.addEventListener("input", () => {
    if (bufferBeforeVal) bufferBeforeVal.textContent = `${bufferBeforeRange.value} min`;
  });
  bufferBeforeRange.addEventListener("change", saveBufferTimes);
}

if (bufferAfterRange) {
  bufferAfterRange.addEventListener("input", () => {
    if (bufferAfterVal) bufferAfterVal.textContent = `${bufferAfterRange.value} min`;
  });
  bufferAfterRange.addEventListener("change", saveBufferTimes);
}

/* ── Slot generation mode (fixed vs. interval) ─────────────── */
const slotModeOptions = document.getElementById("slotModeOptions");
const slotIntervalRow = document.getElementById("slotIntervalRow");
const slotIntervalInput = document.getElementById("slotIntervalInput");

if (slotModeOptions) {
  slotModeOptions.querySelectorAll(".slot-mode-option").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mode = btn.dataset.mode;
      slotModeOptions.querySelectorAll(".slot-mode-option").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (slotIntervalRow) {
        slotIntervalRow.style.display = mode === "interval" ? "" : "none";
      }

      await fetch("/company/slot-mode", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotMode: mode }),
      }).catch(() => {});
    });
  });
}

if (slotIntervalInput) {
  slotIntervalInput.addEventListener("change", async () => {
    let value = Math.max(5, Math.min(120, Number(slotIntervalInput.value) || 30));
    slotIntervalInput.value = value;

    await fetch("/company/slot-mode", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotInterval: value }),
    }).catch(() => {});
  });
}

/* ── Regroupement des rendez-vous ("smart grouping") ───────────────────── */
const sgEnabled    = document.getElementById("sgEnabled");
const sgWindowRow   = document.getElementById("sgWindowRow");
const sgWindowPills = document.getElementById("sgWindowPills");
const sgExample     = document.querySelector(".sg-example");

if (sgEnabled) {
  sgEnabled.addEventListener("change", async () => {
    const enabled = sgEnabled.checked;
    if (sgWindowRow) sgWindowRow.style.display = enabled ? "" : "none";
    if (sgExample) sgExample.classList.toggle("sg-example--off", !enabled);

    try {
      const res = await fetch("/company/smart-grouping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json();
      const newWindowHours = data?.["smartGrouping.windowHours"];
      if (newWindowHours !== undefined && sgWindowPills) {
        sgWindowPills.querySelectorAll(".sg-window-pill").forEach((b) => {
          b.classList.toggle("active", Number(b.dataset.hours) === newWindowHours);
        });
      }
    } catch (_) {}
  });
}

if (sgWindowPills) {
  sgWindowPills.querySelectorAll(".sg-window-pill").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const hours = Number(btn.dataset.hours);
      sgWindowPills.querySelectorAll(".sg-window-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      await fetch("/company/smart-grouping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowHours: hours }),
      }).catch(() => {});
    });
  });
}

/* ── Regroupement : jours de la semaine ("uniquement ces jours") ─────────
   Plusieurs jours peuvent être actifs en même temps (ce n'est pas un choix
   unique comme la fenêtre horaire) — aucun coché = tous les jours. */
const sgWeekdayPills = document.getElementById("sgWeekdayPills");
if (sgWeekdayPills) {
  sgWeekdayPills.querySelectorAll(".sg-window-pill").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.classList.toggle("active");
      const weekdays = Array.from(sgWeekdayPills.querySelectorAll(".sg-window-pill.active"))
        .map((b) => Number(b.dataset.day));

      await fetch("/company/smart-grouping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekdays }),
      }).catch(() => {});
    });
  });
}

/* ── Délai minimum de réservation ─────────────────────────────────────────
   Modulable de 0 (aucun délai) à plusieurs mois : presets rapides + champ
   personnalisé (valeur + unité minutes/heures/jours), tout converti en
   minutes avant l'envoi au serveur. */
const ltEnabled      = document.getElementById("ltEnabled");
const ltRow          = document.getElementById("ltRow");
const ltPresetPills  = document.getElementById("ltPresetPills");
const ltValueInput   = document.getElementById("ltValue");
const ltUnitSelect   = document.getElementById("ltUnit");

const LT_UNIT_TO_MINUTES = { minutes: 1, hours: 60, days: 1440 };

function ltSyncActivePill(minutes) {
  if (!ltPresetPills) return;
  ltPresetPills.querySelectorAll(".sg-window-pill").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.minutes) === minutes);
  });
}

async function ltSaveMinutes(minutes) {
  ltSyncActivePill(minutes);
  await fetch("/company/booking-lead-time", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minutes }),
  }).catch(() => {});
}

if (ltEnabled) {
  ltEnabled.addEventListener("change", async () => {
    const enabled = ltEnabled.checked;
    if (ltRow) ltRow.style.display = enabled ? "" : "none";

    await fetch("/company/booking-lead-time", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => {});
  });
}

if (ltPresetPills) {
  ltPresetPills.querySelectorAll(".sg-window-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const minutes = Number(btn.dataset.minutes);
      // Reflète le preset choisi dans le champ personnalisé (unité la plus lisible).
      if (ltValueInput && ltUnitSelect) {
        if (minutes > 0 && minutes % 1440 === 0) { ltValueInput.value = minutes / 1440; ltUnitSelect.value = "days"; }
        else if (minutes > 0 && minutes % 60 === 0) { ltValueInput.value = minutes / 60; ltUnitSelect.value = "hours"; }
        else { ltValueInput.value = minutes; ltUnitSelect.value = "minutes"; }
      }
      ltSaveMinutes(minutes);
    });
  });
}

function ltCommitCustomValue() {
  if (!ltValueInput || !ltUnitSelect) return;
  const raw = Math.max(0, Math.round(Number(ltValueInput.value) || 0));
  ltValueInput.value = raw;
  const minutes = raw * (LT_UNIT_TO_MINUTES[ltUnitSelect.value] || 1);
  ltSaveMinutes(minutes);
}

if (ltValueInput) {
  ltValueInput.addEventListener("change", ltCommitCustomValue);
}
if (ltUnitSelect) {
  ltUnitSelect.addEventListener("change", ltCommitCustomValue);
}

// ── Saisie intelligente des heures ────────────────────────────────────────────
// Quand un panel d'heures s'ouvre, injecte un input de recherche en haut
// L'utilisateur peut taper "18" → filtre sur "18:XX", "1800" → "18:00"

function formatHourInput(raw) {
  // Garder seulement chiffres et ":"
  var digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.length <= 2) {
    // "18" → afficher tel quel pour le filtre
    return digits;
  }
  // "1800" ou "180" → "18:00"
  var h = digits.slice(0, 2);
  var m = (digits.slice(2, 4) || '00').padEnd(2, '0');
  return h + ':' + m;
}

function injectPanelSearch(panel) {
  if (panel.querySelector('.panel-search-input')) return; // déjà injecté

  var inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'panel-search-input';
  inp.placeholder = 'Heure… (ex : 18 ou 1800)';
  inp.autocomplete = 'off';
  // Style propre — border-radius en haut seulement pour s'intégrer au panel
  inp.style.cssText = [
    'display:block',
    'width:100%',
    'padding:9px 12px',
    'border:none',
    'border-bottom:1px solid var(--border-light,#e5e7eb)',
    'border-radius:10px 10px 0 0',
    'font-size:13px',
    'font-weight:500',
    'font-family:inherit',
    'outline:none',
    'background:var(--surface-card,#fff)',
    'color:var(--ink,#111)',
    'box-sizing:border-box',
    'transition:background .12s',
  ].join(';');

  // Envelopper les heures existantes dans un div scrollable
  if (!panel.querySelector('.panel-hours-scroll')) {
    var scroll = document.createElement('div');
    scroll.className = 'panel-hours-scroll';
    scroll.style.cssText = 'overflow-y:auto;max-height:180px;';
    // Déplacer toutes les .hour dans le scroll wrapper
    Array.from(panel.querySelectorAll('.hour')).forEach(function(h) {
      scroll.appendChild(h);
    });
    panel.appendChild(scroll);
  }

  panel.insertBefore(inp, panel.firstChild);

  inp.addEventListener('input', function(e) {
    var raw    = this.value;
    var digits = raw.replace(/[^0-9]/g, '');

    // Auto-insérer ":" après le 2ème chiffre → "12:2" au lieu de "122"
    if (digits.length >= 3 && raw.indexOf(':') === -1) {
      var formatted = digits.slice(0, 2) + ':' + digits.slice(2, 4);
      this.value = formatted;
    } else if (digits.length === 2 && raw.slice(-1) !== ':') {
      // Optionnel : ne pas forcer les 2 chiffres seuls
    }

    var hours = panel.querySelectorAll('.hour');

    if (!digits) {
      hours.forEach(function(h) { h.style.display = ''; });
      return;
    }

    // Construire pattern de recherche
    var pattern;
    if (digits.length <= 2) {
      pattern = digits; // "18" → cherche toutes heures commençant par "18"
    } else {
      var h = digits.slice(0, 2);
      var m = digits.slice(2, 4).padEnd(2, '0');
      pattern = h + ':' + m;
    }

    hours.forEach(function(h) {
      h.style.display = h.textContent.startsWith(pattern) ? '' : 'none';
    });
  });

  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      // Trouver le premier heure visible et la sélectionner
      var visible = Array.from(panel.querySelectorAll('.hour')).filter(function(h) {
        return h.style.display !== 'none';
      });
      if (visible.length > 0) {
        visible[0].click();
        this.value = '';
      }
    }
    if (e.key === 'Escape') {
      panel.classList.remove('open');
    }
    e.stopPropagation();
  });

  // Focus automatique à l'ouverture
  setTimeout(function() { inp.focus(); }, 50);
}

// ── Portail (congés uniquement) ─────────────────────────────────────────────
// `.avail-doff-card` garde `overflow:hidden` (coins arrondis + barre verte,
// INCHANGÉS) — uniquement le panel ouvert est déplacé dans <body> en position
// fixed pour échapper au clip. Les autres panels (horaires par défaut, plages)
// ne sont jamais touchés par ce code.
function positionDoffPortalPanel(panel, anchor) {
  var rect = anchor.getBoundingClientRect();
  var panelWidth  = panel.offsetWidth  || 140;
  var panelHeight = panel.offsetHeight || 220;
  var vw = window.innerWidth, vh = window.innerHeight;

  var left = rect.left + rect.width / 2 - panelWidth / 2;
  if (left < 4) left = 4;
  if (left + panelWidth > vw - 4) left = Math.max(4, vw - panelWidth - 4);

  var top = rect.bottom + 6;
  if (top + panelHeight > vh - 4) {
    var above = rect.top - panelHeight - 6;
    top = above > 4 ? above : Math.max(4, vh - panelHeight - 4);
  }

  panel.style.left = left + 'px';
  panel.style.top  = top + 'px';
}

function openDoffPanelPortal(panel) {
  if (panel.dataset.portaled === '1') return;
  var anchor = panel.parentElement;
  if (!anchor) return;
  panel._portalAnchor = anchor;
  panel._portalNextSibling = panel.nextSibling;
  panel.dataset.portaled = '1';
  panel.style.position = 'fixed';
  panel.style.transform = 'none';
  // Important : on ancre dans #holidaysBody (pas document.body) — sinon le
  // panel n'est plus un descendant de #holidaysBody et les handlers de clic
  // qui font `hourItem.closest("#holidaysBody")` (ici + dans le listener de
  // holidaysBody plus haut) ne matchent plus. Les heures restaient alors
  // visibles mais cliquer dessus ne sauvegardait plus rien (le clic tombait
  // dans la logique des horaires hebdomadaires, prévue pour .avail-day-row,
  // qui échoue silencieusement sur une ligne de congé). #holidaysBody n'a
  // pas d'overflow:hidden, donc position:fixed y échappe quand même au clip
  // de la carte .avail-doff-card.
  var portalRoot = document.getElementById('holidaysBody') || document.body;
  portalRoot.appendChild(panel);
  positionDoffPortalPanel(panel, anchor);
}

function closeDoffPanelPortal(panel) {
  if (panel.dataset.portaled !== '1') return;
  var anchor = panel._portalAnchor;
  if (anchor && anchor.isConnected) {
    if (panel._portalNextSibling && panel._portalNextSibling.isConnected) {
      anchor.insertBefore(panel, panel._portalNextSibling);
    } else {
      anchor.appendChild(panel);
    }
  }
  panel.style.position = '';
  panel.style.left = '';
  panel.style.top = '';
  panel.style.transform = '';
  delete panel.dataset.portaled;
}

// Observer l'ouverture des panels
var _panelObserver = new MutationObserver(function(mutations) {
  mutations.forEach(function(m) {
    if (m.type === 'attributes' && m.attributeName === 'class') {
      var panel = m.target;
      if (panel.classList.contains('open')) {
        // Reconstruire le contenu (search input + scroll wrapper) AVANT toute
        // mesure/portail, sinon la hauteur mesurée est celle de la liste brute
        // (25 heures non wrappées) au lieu du panel final scrollable.
        injectPanelSearch(panel);
        var inp = panel.querySelector('.panel-search-input');
        if (inp) { inp.value = ''; setTimeout(function(){ inp.focus(); }, 50); }
        // Ré-afficher toutes les heures
        panel.querySelectorAll('.hour').forEach(function(h) { h.style.display = ''; });

        if (panel.closest('.avail-doff-card')) openDoffPanelPortal(panel);
      } else if (panel.dataset.portaled === '1') {
        closeDoffPanelPortal(panel);
      }
    }
  });
});

document.querySelectorAll('.panel-availability').forEach(function(panel) {
  _panelObserver.observe(panel, { attributes: true });
});
