const availability = document.querySelector(".body-weekly-hour");

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

  if (timeslotPanel) {
    document
      .getElementById("timeslotPanel")
      .querySelector(".panel")
      .classList.toggle("open");
  } else {
    document
      .getElementById("timeslotPanel")
      .querySelector(".panel")
      .classList.remove("open");
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

    function timeToMinutes(time) {
      const [hours, minutes] = time.split(":").map(Number);
      return hours * 60 + minutes;
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
      console.log("❌ L'heure de début doit être avant l'heure de fin");
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
      console.log("❌", check.reason);

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
    const attribute = JSON.parse(row.dataset.date);
    const id = attribute._id;

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
    console.log(data);
  });
});

const rowOptions = document.querySelector(
  ".availability-section .availability-section__body .body-weekly-hour",
);
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
    const container = row.querySelector(".days-off__schedule");
    const attributeRow = row.dataset.date;
    const dateId = JSON.parse(attributeRow)._id;

    if (deleteTimeSlot) {
      container.innerHTML = `<p>Day off</p>`;
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
      newHour.closest(".panel-availability").classList.remove("open");

      const wrapper = newHour.closest(".slot-hour");
      const container = wrapper.querySelector(".hour-container");
      console.log(container);

      const typeHour = container.dataset.hours;
      const setNewHour = newHour.textContent;
      console.log(typeHour);
      console.log(setNewHour);

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

      const startHour = row.querySelector(".start-hour-").textContent;
      const endHour = row.querySelector(".end-hour-").textContent;
      const schedule = { start: startHour, end: endHour };
      console.log(schedule);

      const scheduleDayOff = await fetch(`/company/schedule-day-off`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateId,
          schedule,
        }),
      });

      console.log(await scheduleDayOff.json());
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

    addDay(dateKey);
    dayEl.classList.add("clicked");

    const clone = dayOffRowTemplate.content.cloneNode(true);
    clone.querySelector("p.input").textContent =
      `${day}/${month.padStart(2, "0")}/${year}`;
    holidaysBody.appendChild(clone);
  }
});
