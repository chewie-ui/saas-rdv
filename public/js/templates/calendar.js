const weekdaysArray = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

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

import { getDays, setDays } from "/js/components/calendarState.js";

async function getDaysOff() {
  const res = await fetch("/company/get-days-off");
  const data = await res.json();

  if (data?.dates) {
    const formatted = data.dates.map(
      (d) => new Date(d.date).toISOString().split("T")[0],
    );

    setDays(formatted);
  }
}

async function initCalendar() {
  await getDaysOff();
  const renderCalendar = document.getElementById("renderCalendar");

  const calHeader = renderCalendar.querySelector(".calendar-header");
  const prevBtn = renderCalendar.querySelector(".prev-month .btn#prevMonthBtn");
  const nextBtn = renderCalendar.querySelector(".next-month .btn#nextMonthBtn");
  const calBody = renderCalendar.querySelector(".calendar-body");
  const closeCalendar = document.querySelector("#closeCalendar");

  const currentDate = new Date();
  let today = new Date();

  const weekdays = calBody.querySelector(".weekdays");
  const days = calBody.querySelector(".days");
  weekdaysArray.forEach((element) => {
    const weekday = document.createElement("div");
    weekday.textContent = element.slice(0, 3);
    weekday.className = "weekday";
    weekdays.appendChild(weekday);
  });

  function loadCalendar() {
    const daysOffArray = getDays();

    days.innerHTML = ``;

    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

    const currentMonthText = calHeader.querySelector(".this-month h2");

    // const savedDays = JSON.parse(localStorage.getItem("daysOff")) || [];

    currentMonthText.textContent =
      monthsArray[currentMonth] + " " + currentYear;

    function addEmptyCell(dayCounter) {
      const empty = document.createElement("div");
      empty.classList.add("day");
      empty.classList.add("empty");
      empty.textContent = dayCounter;
      days.appendChild(empty);
    }

    for (let i = firstDayOfMonth - 1; i >= 0; i--) {
      addEmptyCell(daysInPrevMonth - i);
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const day = document.createElement("div");
      day.className = "day";
      day.textContent = i;
      day.dataset.day = i;
      day.dataset.month = currentMonth + 1;
      day.dataset.year = currentYear;
      const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      if (daysOffArray.includes(dateKey)) {
        day.classList.add("clicked");
      }

      if (
        i === currentDate.getDate() &&
        currentMonth === currentDate.getMonth() &&
        currentYear === currentDate.getFullYear()
      ) {
        day.classList.add("today");
      }
      days.appendChild(day);
    }

    const totalCells = days.children.length;
    console.log(totalCells);

    const remainingCells = 7 * 6 - totalCells;

    for (let i = 1; i <= remainingCells; i++) {
      addEmptyCell(i);
    }
  }

  prevBtn.addEventListener("click", () => {
    today.setMonth(today.getMonth() - 1);
    loadCalendar();
  });

  nextBtn.addEventListener("click", () => {
    today.setMonth(today.getMonth() + 1);
    loadCalendar();
  });

  closeCalendar.addEventListener("click", () => {
    renderCalendar.classList.remove("show");
  });

  loadCalendar();
}

initCalendar();
