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
  if (hourItem) {
    const panel = hourItem.closest(".panel-availability");
    const slotParent = hourItem.closest(".slot-hour");
    const display = slotParent.querySelector(".hour-container");
    const container = hourItem.closest(".time-slot");

    function timeToMinutes(time) {
      const [hours, minutes] = time.split(":").map(Number);
      return hours * 60 + minutes;
    }

    let startMinutes;
    let endMinutes;
    let endHourText;

    if (slotParent.classList.contains("start-hour")) {
      endHourText = container
        .querySelector(".end-hour .hour-container")
        .textContent.trim();

      startMinutes = timeToMinutes(hourItem.textContent);
      endMinutes = timeToMinutes(endHourText);
    } else {
      endHourText = container
        .querySelector(".start-hour .hour-container")
        .textContent.trim();

      endMinutes = timeToMinutes(hourItem.textContent);
      startMinutes = timeToMinutes(endHourText);
    }

    if (startMinutes >= endMinutes) {
      console.log("❌ L'heure de début doit être avant l'heure de fin");
    } else {
      console.log("✅ Horaire valide");
      display.textContent = hourItem.textContent;

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

      await fetch("/edit-availability", {
        headers: { "Content-Type": "application/json" },
        method: "POST",
        body: JSON.stringify({
          companyId,
          weekdayIndex,
          workingHours,
        }),
      });
    }

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
    console.log("yes sir");
    const row = dayOffBtnDelete.closest(".days-off__row");
    const attribute = JSON.parse(row.dataset.date);
    const id = attribute._id;
    console.log(attribute);
    console.log(attribute._id);

    const result = await fetch(`/company/days-off/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });

    const data = await result.json();
    console.log(data);
    if (data) {
      row.remove();
    }

    return;
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

      cloneStartHour.textContent = endHour
      cloneEndHour.textContent = `${String(nextHour).padStart(2, "0")}:00`;

      plagesWrapper.appendChild(clone);
    }
  });
}
const dayOffRowTemplate = document.getElementById("dayOffRow");
const holidaysBody = document.getElementById("holidaysBody");
const calendar = document.querySelector(".calendar");
let daysOffArray = [];

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
  const dayEl = event.target.closest(".day:not(.empty)");
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
    await fetch("/company/add-days-off", {
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
