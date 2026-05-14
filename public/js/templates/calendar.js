const weekdaysArray = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const monthsArray = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

import { getDays, setDays } from "/js/components/calendarState.js";

async function getDaysOff() {
  const res = await fetch("/company/get-days-off");
  const data = await res.json();
  if (data?.dates) {
    setDays(data.dates.map((d) => new Date(d.date).toISOString().split("T")[0]));
  }
}

async function initCalendar() {
  await getDaysOff();

  const renderCalendar = document.getElementById("renderCalendar");
  const prevBtn        = document.getElementById("prevMonthBtn");
  const nextBtn        = document.getElementById("nextMonthBtn");
  const closeCalendar  = document.getElementById("closeCalendar");
  const monthLabel     = document.getElementById("calMonthLabel");
  const weekdayRow     = renderCalendar.querySelector(".avail-cal-week");
  const daysGrid       = renderCalendar.querySelector(".avail-cal-days");

  const currentDate = new Date();
  let today = new Date();

  // Build weekday headers once
  weekdaysArray.forEach((d) => {
    const el = document.createElement("div");
    el.className = "avail-cal-dow";
    el.textContent = d;
    weekdayRow.appendChild(el);
  });

  function loadCalendar() {
    const daysOffArray  = getDays();
    const currentMonth  = today.getMonth();
    const currentYear   = today.getFullYear();
    const firstDayOfMonth  = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth      = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrevMonth  = new Date(currentYear, currentMonth, 0).getDate();

    monthLabel.textContent = monthsArray[currentMonth] + " " + currentYear;
    daysGrid.innerHTML = "";

    function addEmpty(n) {
      const el = document.createElement("div");
      el.className = "avail-cal-cell is-empty";
      el.textContent = n;
      daysGrid.appendChild(el);
    }

    for (let i = firstDayOfMonth - 1; i >= 0; i--) addEmpty(daysInPrevMonth - i);

    for (let i = 1; i <= daysInMonth; i++) {
      const el = document.createElement("div");
      el.className = "avail-cal-cell day";
      el.textContent = i;
      el.dataset.day   = i;
      el.dataset.month = currentMonth + 1;
      el.dataset.year  = currentYear;

      const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2,"0")}-${String(i).padStart(2,"0")}`;
      if (daysOffArray.includes(dateKey)) el.classList.add("clicked");
      if (
        i === currentDate.getDate() &&
        currentMonth === currentDate.getMonth() &&
        currentYear === currentDate.getFullYear()
      ) el.classList.add("today");

      daysGrid.appendChild(el);
    }

    const remaining = 7 * 6 - daysGrid.children.length;
    for (let i = 1; i <= remaining; i++) addEmpty(i);
  }

  prevBtn.addEventListener("click", () => { today.setMonth(today.getMonth() - 1); loadCalendar(); });
  nextBtn.addEventListener("click", () => { today.setMonth(today.getMonth() + 1); loadCalendar(); });
  closeCalendar.addEventListener("click", () => renderCalendar.classList.remove("show"));

  loadCalendar();
}

initCalendar();
