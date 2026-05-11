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
    const slotParent = hourItem.closest(".slot-hour");
    const display = slotParent.querySelector(".hour-container");
    const container = hourItem.closest(".time-slot");

    // Si le clic vient d'une ligne de congé, le handler holidaysBody gère l'API
    // On se contente de mettre à jour l'affichage et fermer le panel
    if (hourItem.closest("#holidaysBody")) {
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
    const row = hourItem.closest(".row-weekday");
    const switcherInput = row.querySelector(".switch input");
    const weekdayIndex = switcherInput.getAttribute("data-weekday-index");
    const companyId = switcherInput.getAttribute("data-company");
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
    const renderCalendar = document.querySelector("#renderCalendar");
    const actionCalendar = renderCalendar.querySelector(".calendar-action");
    renderCalendar.classList.add("show");
    actionCalendar.classList.add("show");
    getDaysOff();
  }
  const dayOffBtnDelete = event.target.closest(".days-off__button.delete-btn");

  if (dayOffBtnDelete) {
    const row = dayOffBtnDelete.closest(".days-off__row");
    let id;
    try {
      id = row.dataset.date ? JSON.parse(row.dataset.date)._id : null;
    } catch { id = null; }

    if (!id) {
      // Fallback: supprimer via dateKey si data-date absent (ne devrait pas arriver)
      row.remove();
      return;
    }

    const result = await fetch(`/company/days-off/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });

    const data = await result.json();
    if (data) {
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
    const dayOff = !input.checked;

    const res = await fetch("/toggle-day", {
      headers: { "Content-Type": "application/json" },
      method: "POST",
      body: JSON.stringify({
        companyId,
        weekdayIndex,
        dayOff,
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

      // Build the hours list from the existing panel (grab from another row)
      // or fall back to a simple time-input approach
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
      const row = addPlageBtn.closest(".row-weekday");
      const plagesWrapper = row.querySelector(".weekly-hour__time");
      const template = document.getElementById("plageTemplate");
      const clone = template.content.cloneNode(true);

      const endHour = row
        .querySelector(".hour-container.end-hour-")
        .textContent.trim();

      const [hour] = endHour.split(":");
      const nextHour = parseInt(hour, 10) + 1;

      const cloneStartHour = clone.querySelector(".hour-container.start-hour-");
      const cloneEndHour = clone.querySelector(".hour-container.end-hour-");

      cloneStartHour.textContent = endHour;
      cloneEndHour.textContent = `${String(nextHour).padStart(2, "0")}:00`;

      plagesWrapper.appendChild(clone);
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
    const row = e.target.closest(".days-off__row");
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
      const wrapper   = newHour.closest(".slot-hour");
      const displayEl = wrapper.querySelector(".hour-container");
      const typeHour  = displayEl.dataset.hours;
      const setNewHour = newHour.textContent.trim();

      // ── Validate start < end before saving ───────────────────────────────
      const timeSlot = wrapper.closest(".time-slot");
      if (timeSlot) {
        const startText = typeHour === "start"
          ? setNewHour
          : (timeSlot.querySelector(".start-hour .hour-container")?.textContent.trim() || "00:00");
        const endText = typeHour === "end"
          ? setNewHour
          : (timeSlot.querySelector(".end-hour .hour-container")?.textContent.trim() || "23:59");
        if (timeToMinutes(startText) >= timeToMinutes(endText)) {
          newHour.closest(".panel-availability").classList.remove("open");
          showTimeError("L'heure de fin doit être supérieure à l'heure de début");
          return;
        }
      }

      newHour.closest(".panel-availability").classList.remove("open");

      // Mettre à jour l'affichage
      displayEl.textContent = setNewHour;

      // Sauvegarder en BDD
      await fetch(`/company/set-schedule-day-off`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: typeHour,
          dateId,
          time: setNewHour,
        }),
      });

      return;
    }

    if (scheduleBtn) {
      const template = document.querySelector("#plageTemplate");
      const clone = template.content.cloneNode(true);
      container.innerHTML = ``;
      container.appendChild(clone);

      // Lire les heures par défaut du clone qu'on vient d'insérer
      const startHour = container.querySelector(".start-hour-").textContent.trim();
      const endHour = container.querySelector(".end-hour-").textContent.trim();
      const schedule = { start: startHour, end: endHour };

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
    daysOffArray = data.dates.map(
      (d) => new Date(d.date).toISOString().split("T")[0],
    );
  }
}

getDaysOff();

// ── "Réactiver" slot-time button ─────────────────────────────────────────────
const reenableBtn = document.querySelector(".slot-reenable-btn");
if (reenableBtn) {
  reenableBtn.addEventListener("click", async () => {
    // Désactiver tous les services pour libérer le contrôle du slot time
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
    reenableBtn.closest(".slot-managed-info").style.display = "none";
  });
}

import { getDays, addDay, removeDay } from "/js/components/calendarState.js";
calendar.addEventListener("click", async (event) => {
  const dayEl = event.target.closest(".day:not(.empty):not(.clicked)");
  if (!dayEl) return;

  const { day, month, year } = dayEl.dataset;

  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const isAlreadyOff = getDays().includes(dateKey);

  if (isAlreadyOff) {
    await fetch("/company/remove-days-off", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateKey }),
    });

    removeDay(dateKey);
    dayEl.classList.remove("clicked");
  } else {
    const response = await fetch("/company/add-days-off", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateKey }),
    });

    const data = await response.json();

    addDay(dateKey);
    dayEl.classList.add("clicked");

    const clone = dayOffRowTemplate.content.cloneNode(true);
    // Update date label in new design (span.avail-doff-date-label) + legacy p.input
    const MONTHS_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const DAYS_ABBR   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const dateObj     = new Date(`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`);
    const dateFormatted = `${DAYS_ABBR[dateObj.getDay()]}, ${MONTHS_ABBR[dateObj.getMonth()]} ${parseInt(day)}`;
    const labelEl = clone.querySelector(".avail-doff-date-label");
    if (labelEl) labelEl.textContent = dateFormatted;
    const pInput = clone.querySelector("p.input");
    if (pInput) pInput.textContent = `${day}/${month.padStart(2,"0")}/${year}`;

    // Stocker le dateEntry (avec _id) pour pouvoir supprimer/éditer ensuite
    const rowEl = clone.querySelector(".days-off__row");
    if (rowEl && data.dateEntry) {
      rowEl.dataset.date = JSON.stringify(data.dateEntry);
    }

    holidaysBody.appendChild(clone);
  }
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

/* ── Buffer between bookings slider ─────────────────────────── */
const bufferRange = document.getElementById("bufferRange");
const bufferVal   = document.getElementById("bufferVal");

if (bufferRange) {
  // Live update display
  bufferRange.addEventListener("input", () => {
    if (bufferVal) bufferVal.textContent = `${bufferRange.value} min`;
  });

  // Save on release
  bufferRange.addEventListener("change", async () => {
    await fetch("/company/buffer", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bufferTime: Number(bufferRange.value) }),
    }).catch(() => {});
  });
}
