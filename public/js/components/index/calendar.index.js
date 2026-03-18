export default function () {
  const calendar = document.querySelector(".calendar-wrapper .calendar");
  const bookingWrapper = document.getElementById("bookingWrapper") || undefined;
  const scheduleWrapper =
    document.getElementById("scheduleWrapper") || undefined;

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
      console.log(time);

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

    const isCurrentMonth =
      currentYear === realToday.getFullYear() &&
      currentMonth === realToday.getMonth();
    prevMonthBtn.disabled = isCurrentMonth;
    // Optionnel : ajoute une classe pour le style CSS
    prevMonthBtn.style.opacity = isCurrentMonth ? "0.5" : "1";
    prevMonthBtn.style.cursor = isCurrentMonth ? "not-allowed" : "pointer";

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

    const disabledDays = await fetch(`/get-disabled-days/${COMPANY_ID}`);
    const arrayDisabledDays = await disabledDays.json();

    const resultDaysOff = await daysOff.json();

    const dayOffArray = resultDaysOff.result.schedule;

    const responseBookings = await fetch(`/get-booking/${COMPANY_ID}`);
    const specificExceptions = await responseBookings.json();
    console.log(specificExceptions);
    function countPossibleSlots(workingHours, slotTime) {
      if (!workingHours || workingHours.length === 0) return 0;
      let count = 0;
      workingHours.forEach((period) => {
        const [startH, startM] = period.start.split(":").map(Number);
        const [endH, endM] = period.end.split(":").map(Number);
        const totalMinutes = endH * 60 + endM - (startH * 60 + startM);
        count += Math.floor(totalMinutes / slotTime);
      });
      return count;
    }
    const companyInfos = await fetch(`/company/get-infos/${COMPANY_ID}`);
    const res = await companyInfos.json();
    console.log(res);

    const slotTime = res.slotTime;
    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      const day = document.createElement("div");
      day.textContent = i;
      day.className = "day";

      const currentDate = new Date(currentYear, currentMonth, i);
      currentDate.setHours(0, 0, 0, 0);

      const weekdayIndex = (currentDate.getDay() + 6) % 7;
      const todayClean = new Date(realToday);
      todayClean.setHours(0, 0, 0, 0);

      const exception = arrayDisabledDays.find((d) => {
        const dDate = new Date(d.date);
        dDate.setHours(0, 0, 0, 0);
        return dDate.getTime() === currentDate.getTime();
      });

      const isFull = specificExceptions.find((d) => {
        const dDate = new Date(d.date);
        dDate.setHours(0, 0, 0, 0);
        return dDate.getTime() === currentDate.getTime() && d.isFull === true;
      });

      if (isFull) {
        day.classList.add("over-booked");
        day.dataset.disabled = "true";
      }

      const dayConfig = dayOffArray.find(
        (d) => d.weekdayIndex === weekdayIndex,
      );

      if (currentDate < todayClean) {
        day.classList.add("empty");
      } else if (exception) {
        if (!exception.workingHours || exception.workingHours.length === 0) {
          day.classList.add("empty");
          day.dataset.disabled = "true";
        } else {
          day.dataset.weekdayIndex = weekdayIndex;
          day.classList.add("special-day");
        }
      } else if (dayConfig && dayConfig.dayOff) {
        day.classList.add("empty"); // Repos hebdomadaire normal
        day.dataset.disabled = "true";
      } else {
        day.dataset.weekdayIndex = weekdayIndex;
      }

      let activeWorkingHours = [];
      if (exception && exception.workingHours) {
        activeWorkingHours = exception.workingHours;
      } else if (dayConfig && !dayConfig.dayOff) {
        activeWorkingHours = dayConfig.workingHours;
      }

      // 2. Calculer le nombre maximum de créneaux possibles
      const maxSlots = countPossibleSlots(activeWorkingHours, slotTime);

      // 3. Compter combien de réservations existent déjà pour ce jour i
      // Note : specificExceptions doit contenir TOUS les bookings renvoyés par ton serveur
      const existingBookingsCount = specificExceptions.filter((booking) => {
        const bDate = new Date(booking.date);
        bDate.setHours(0, 0, 0, 0);
        return bDate.getTime() === currentDate.getTime();
      }).length;

      // 4. Si c'est plein, on ajoute la classe over-booked
      if (maxSlots > 0 && existingBookingsCount >= maxSlots) {
        day.classList.add("over-booked");
        day.dataset.disabled = "true";
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
        if (day.dataset.disabled === "true") return;
        const index = day.dataset.weekdayIndex;
        const clickedDate = new Date(currentYear, currentMonth, i);
        datePicked = clickedDate;

        const dateIso = clickedDate.toISOString();
        const slots = await fetch("/get-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            index,
            COMPANY_ID,
            date: dateIso,
          }),
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

        const result = await fetch(`/get-booking?date=${dateIso}`);

        const response = await result.json();
        console.log(response);

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

  if (scheduleWrapper) {
    scheduleWrapper.addEventListener("click", (e) => {
      const row = e.target.closest(".row:not(.reserved)");
      if (!row) return;

      schedulePicked = row.textContent;

      scheduleWrapper.classList.remove("show");
      bookingWrapper.classList.add("show");
    });
  }

  if (bookingWrapper) {
    bookingWrapper.addEventListener("click", async (e) => {
      const button = e.target.closest("button#confirmBooking");
      if (!button) return;
      const name = document.getElementById("bookingName");
      const surname = document.getElementById("bookingSurname");
      const email = document.getElementById("bookingEmail");
      const phone = document.getElementById("bookingPhone");
      const message = document.getElementById("bookingMsg");
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailPattern.test(email)) {
        alert("Veuillez entrer une adresse email valide.");
        bookingEmail.style.border = "1px solid red"; // Petit feedback visuel
        return; // On "dégage" : le reste du code n'est pas exécuté
      }
      const fields = [name, surname, email, phone, message];
      let isFormValid = true;

      fields.forEach((field) => {
        if (field.value.trim() === "") {
          field.classList.add("empty-field");
          isFormValid = false; // On lève un drapeau d'erreur
        } else {
          field.classList.remove("empty-field"); // On enlève le rouge s'il a corrigé
        }
      });

      if (!isFormValid) {
        // Optionnel : un petit message ou scroll vers le haut
        return;
      }

      const popup = document.querySelector(".confirm-popup");

      const newPopup = popup.cloneNode(true);
      newPopup.classList.add("show");
      newPopup.querySelector(".confirm-popup__title").textContent =
        "Your booking has been confirmed !";
      ((newPopup.querySelector(".confirm-popup__description").textContent =
        "You have received an email in your inbox "),
        email);

      newPopup.classList.add("show");
      document.body.appendChild(newPopup);

      newPopup.querySelector(".confirm-btn").onclick = () => {
        // onConfirm();
        newPopup.remove();
      };

      const request = await fetch("/create-booking", {
        method: "post",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: datePicked.toISOString(),
          startTime: schedulePicked,
          company: document
            .getElementById("bookingWrapper")
            .getAttribute("data-company-id"),
          name: name.value,
          surname: surname.value,
          email: email.value,
          phone: phone.value,
          message: message.value,
        }),
      });

      const response = await request.json();
      if (response.success) {
        // envoie email + popup
      } else {
        alert("you ve got an error, please retry");
      }

      scheduleWrapper.classList.remove("show");
      bookingWrapper.classList.remove("show");
    });
  }

  prevMonthBtn.addEventListener("click", () => {
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    if (
      currentYear > realToday.getFullYear() ||
      currentMonth > realToday.getMonth()
    ) {
      today.setMonth(today.getMonth() - 1);
      renderCalendar();
    }
  });

  nextMonthBtn.addEventListener("click", () => {
    today.setMonth(today.getMonth() + 1);
    renderCalendar();
  });

  renderCalendar();
}
