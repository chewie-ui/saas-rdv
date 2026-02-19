export default function () {
  const calendar = document.querySelector(
    ".content-wrapper .calendar-wrapper .calendar",
  );
  const bookingWrapper = document.getElementById("bookingWrapper");
  const scheduleWrapper = document.getElementById("scheduleWrapper");
  const calendarHeader = calendar.querySelector(".calendar-header");
  const calendarBody = calendar.querySelector(".calendar-body");
  const currentMonthTarget = calendarHeader.querySelector(".this-month h2");
  const calendarDays = calendarBody.querySelector(".days");
  const calendarWeekdays = calendarBody.querySelector(".weekdays");
  const prevMonthBtn = calendarHeader.querySelector("#prevMonthBtn");
  const nextMonthBtn = calendarHeader.querySelector("#nextMonthBtn");

  let datePicked;
  let schedulePicked;

  const weekdaysArray = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];

  weekdaysArray.forEach((weekday) => {
    const weekdayEl = document.createElement("div");
    weekdayEl.textContent = weekday.slice(0, 3);
    weekdayEl.className = "weekday";
    calendarWeekdays.appendChild(weekdayEl);
  });

  const monthsArray = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const realToday = new Date();
  let today = new Date();

  function renderSchedules(bookedTimes) {
    const rows = scheduleWrapper.querySelectorAll(".row");

    rows.forEach((row) => {
      const time = row.textContent.trim();

      if (bookedTimes.includes(time)) {
        row.classList.add("reserved");
        row.dataset.disabled = "true";
      } else {
        row.classList.remove("reserved");
        row.dataset.disabled = "false";
      }
    });
  }

  async function renderCalendar() {
    calendarDays.innerHTML = "";

    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

    currentMonthTarget.textContent =
      monthsArray[currentMonth] + " " + currentYear;

    const startDay = (firstDayOfMonth + 6) % 7;

    function addEmptyCell(dayCounter) {
      const empty = document.createElement("div");
      empty.classList.add("day");
      empty.classList.add("empty");
      empty.textContent = dayCounter;
      calendarDays.appendChild(empty);
    }

    // Prev month days
    for (let i = startDay - 1; i >= 0; i--) {
      addEmptyCell(daysInPrevMonth - i);
    }

    const daysOff = await fetch("/get-days-off", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ COMPANY_ID }),
    });

    const resultDaysOff = await daysOff.json();

    const dayOffArray = resultDaysOff.result.schedule;

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const day = document.createElement("div");
      day.textContent = i;
      day.className = "day";

      const currentDate = new Date(currentYear, currentMonth, i);

      const weekdayIndex = (currentDate.getDay() + 6) % 7;

      const dayConfig = dayOffArray.find(
        (d) => d.weekdayIndex === weekdayIndex,
      );
      currentDate.setHours(0, 0, 0, 0);

      const todayClean = new Date(realToday);
      todayClean.setHours(0, 0, 0, 0);

      if (currentDate < todayClean) {
        day.classList.add("empty");
      } else {
        day.dataset.weekdayIndex = weekdayIndex;
      }

      if (dayConfig && dayConfig.dayOff) {
        day.classList.add("empty");
        day.dataset.disabled = "true";
      }

      if (
        i === realToday.getDate() &&
        currentMonth === realToday.getMonth() &&
        currentYear === realToday.getFullYear()
      ) {
        day.classList.add("today");
      }

      calendarDays.appendChild(day);

      day.addEventListener("click", async () => {
        const index = day.dataset.weekdayIndex;

        const slots = await fetch("/get-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index, COMPANY_ID }),
        });
        const slotsToAdd = await slots.json();
        scheduleWrapper.querySelector(".schedule-rows").innerHTML = "";

        slotsToAdd.slots.forEach((slot) => {
          const div = document.createElement("div");
          div.className = "row";
          div.textContent = slot;
          scheduleWrapper.querySelector(".schedule-rows").appendChild(div);
        });

        if (day.classList.contains("empty")) return false;
        datePicked = new Date(currentYear, currentMonth, i);

        const result = await fetch(
          `/get-booking?date=${datePicked.toISOString()}`,
        );

        const response = await result.json();

        renderSchedules(response.bookedTimes);

        scheduleWrapper.classList.add("show");
        bookingWrapper.classList.remove("show");
      });
    }

    // Next month days
    const totalCells = calendarDays.children.length;
    const remainingCells = 7 * 6 - totalCells;

    for (let i = 1; i <= remainingCells; i++) {
      addEmptyCell(i);
    }
  }

  scheduleWrapper.addEventListener("click", (e) => {
    const row = e.target.closest(".row:not(.reserved)");
    if (!row) return;

    schedulePicked = row.textContent;

    scheduleWrapper.classList.remove("show");
    bookingWrapper.classList.add("show");
  });

  bookingWrapper.addEventListener("click", async (e) => {
    const button = e.target.closest("button#confirmBooking");
    if (!button) return;

    const request = await fetch("/create-booking", {
      method: "post",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: datePicked.toISOString(),
        time: schedulePicked,
        company: document
          .getElementById("bookingWrapper")
          .getAttribute("data-company-id"),
      }),
    });

    const response = await request.json();
    if (response.success) {
      // alert("all is ok");
    } else {
      alert("you ve got an error, please retry");
    }

    scheduleWrapper.classList.remove("show");
    bookingWrapper.classList.remove("show");
  });

  prevMonthBtn.addEventListener("click", () => {
    today.setMonth(today.getMonth() - 1);
    renderCalendar();
  });

  nextMonthBtn.addEventListener("click", () => {
    today.setMonth(today.getMonth() + 1);
    renderCalendar();
  });

  renderCalendar();
}
