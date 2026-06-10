export default function () {
  const templateDialog      = document.getElementById("templateDialog");
  const calendar            = document.querySelector(".calendar-wrapper .calendar");
  const bookingWrapper      = document.getElementById("bookingWrapper")      || undefined;
  const scheduleWrapper     = document.getElementById("scheduleWrapper")     || undefined;
  const formStepWrapper     = document.getElementById("formStepWrapper")     || undefined;
  const serviceStepWrapper  = document.getElementById("serviceStepWrapper")  || undefined;
  const employeeStepWrapper = document.getElementById("employeeStepWrapper") || undefined;

  const calendarHeader = calendar.querySelector(".calendar-header");
  const calendarBody = calendar.querySelector(".calendar-body");
  const currentMonthTarget = calendarHeader.querySelector(".this-month h2");
  const calendarDays = calendarBody.querySelector(".days");
  const calendarWeekdays = calendarBody.querySelector(".weekdays");
  const prevMonthBtn = calendarHeader.querySelector("#prevMonthBtn");
  const nextMonthBtn = calendarHeader.querySelector("#nextMonthBtn");

  // ── State ────────────────────────────────────────────────────────────────
  let datePicked;
  let weekdayIndexPicked;
  let schedulePicked;
  let activeForm  = null;
  let formAnswers = [];
  window.__selectedService  = null;
  window.__selectedEmployee = null;

  const __t = window.__t || {};

  const weekdaysArray = (__t.weekdays_abbr && __t.weekdays_abbr.length === 7)
    ? __t.weekdays_abbr
    : ["Mo","Tu","We","Th","Fr","Sa","Su"];

  weekdaysArray.forEach((day) => {
    const weekdayEl = document.createElement("div");
    weekdayEl.textContent = day;
    weekdayEl.className = "weekday";
    calendarWeekdays.appendChild(weekdayEl);
  });

  const monthsArray = (__t.months && __t.months.length === 12)
    ? __t.months
    : ["January","February","March","April","May","June","July","August","September","October","November","December"];

  const realToday = new Date();
  let today = new Date();

  // ── Mark reserved slots ──────────────────────────────────────────────────
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

  // ── Hide all step panels ─────────────────────────────────────────────────
  function hideAllSteps() {
    scheduleWrapper     && scheduleWrapper.classList.remove("show");
    serviceStepWrapper  && serviceStepWrapper.classList.remove("show");
    employeeStepWrapper && employeeStepWrapper.classList.remove("show");
    formStepWrapper     && formStepWrapper.classList.remove("show");
    bookingWrapper      && bookingWrapper.classList.remove("show");
  }

  // ── Fetch slots for the stored date, then show scheduleWrapper ───────────
  async function fetchAndShowSlots() {
    if (!scheduleWrapper || !datePicked) return;

    scheduleWrapper.querySelector(".schedule-rows").innerHTML = "";

    // Pass service duration so the backend uses it as the slot step
    const serviceDuration = window.__selectedService?.duration || null;

    const slotsRes = await fetch("/get-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        index: weekdayIndexPicked,
        COMPANY_ID,
        date: datePicked,
        serviceDuration,
      }),
    });
    const slotsData = await slotsRes.json();

    slotsData.slots.forEach((slot) => {
      const div = document.createElement("div");
      div.className = "row";
      div.textContent = slot;
      scheduleWrapper.querySelector(".schedule-rows").appendChild(div);
    });

    // Pass selected employee + service duration so blocking granularity matches slot step
    const empId = window.__selectedEmployee?.id || "";
    const durationParam = serviceDuration ? `&serviceDuration=${serviceDuration}` : "";
    const bookedRes  = await fetch(`/get-booking?date=${datePicked}&companyId=${COMPANY_ID}&employeeId=${empId}${durationParam}`);
    const bookedData = await bookedRes.json();
    renderSchedules(bookedData.bookedTimes);

    // Show schedule, hide everything else
    serviceStepWrapper  && serviceStepWrapper.classList.remove("show");
    employeeStepWrapper && employeeStepWrapper.classList.remove("show");
    bookingWrapper      && bookingWrapper.classList.remove("show");
    scheduleWrapper.classList.add("show");
  }

  // ── After time slot picked: go to form or booking ────────────────────────
  function proceedAfterSlot() {
    scheduleWrapper && scheduleWrapper.classList.remove("show");
    if (activeForm && formStepWrapper) {
      renderFormStep();
      formStepWrapper.classList.add("show");
    } else {
      bookingWrapper && bookingWrapper.classList.add("show");
    }
  }

  // ── Calendar rendering ───────────────────────────────────────────────────
  async function renderCalendar() {
    calendarDays.innerHTML = "";

    const currentMonth = today.getMonth();
    const currentYear  = today.getFullYear();

    const isCurrentMonth =
      currentYear === realToday.getFullYear() &&
      currentMonth === realToday.getMonth();
    prevMonthBtn.disabled = isCurrentMonth;
    prevMonthBtn.style.cursor = isCurrentMonth ? "not-allowed" : "pointer";

    const firstDayOfMonth  = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth      = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysInPrevMonth  = new Date(currentYear, currentMonth, 0).getDate();

    currentMonthTarget.textContent = monthsArray[currentMonth] + " " + currentYear;

    const startDay = (firstDayOfMonth + 6) % 7;

    function addEmptyCell(dayCounter) {
      const empty = document.createElement("div");
      empty.classList.add("day", "empty");
      empty.textContent = dayCounter;
      calendarDays.appendChild(empty);
    }

    for (let i = startDay - 1; i >= 0; i--) {
      addEmptyCell(daysInPrevMonth - i);
    }

    const daysOff = await fetch("/get-days-off", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ COMPANY_ID }),
    });

    const disabledDays     = await fetch(`/get-disabled-days/${COMPANY_ID}`);
    const arrayDisabledDays = await disabledDays.json();
    const resultDaysOff    = await daysOff.json();
    const dayOffArray      = resultDaysOff.result.schedule;
    const responseBookings = await fetch(`/get-booking/${COMPANY_ID}`);
    const specificExceptions = await responseBookings.json();

    function countPossibleSlots(workingHours, slotTime) {
      if (!workingHours || workingHours.length === 0) return 0;
      let count = 0;
      workingHours.forEach((period) => {
        const [startH, startM] = period.start.split(":").map(Number);
        const [endH, endM]     = period.end.split(":").map(Number);
        const totalMinutes     = endH * 60 + endM - (startH * 60 + startM);
        count += Math.floor(totalMinutes / slotTime);
      });
      return count;
    }

    const companyInfos = await fetch(`/company/get-infos/${COMPANY_ID}`);
    const res          = await companyInfos.json();
    const slotTime     = res.slotTime;

    const toUTCDateStr = (d) => new Date(d).toISOString().split("T")[0];

    for (let i = 1; i <= daysInMonth; i++) {
      const day = document.createElement("div");
      day.textContent = i;
      day.className = "day";

      const currentDate = new Date(currentYear, currentMonth, i);
      currentDate.setHours(0, 0, 0, 0);

      const currentDateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      const weekdayIndex   = currentDate.getDay();
      const jsWeekdayIndex = currentDate.getDay();
      const todayClean     = new Date(realToday);
      todayClean.setHours(0, 0, 0, 0);

      const exception = arrayDisabledDays.find((d) => toUTCDateStr(d.date) === currentDateStr);
      const isFull    = specificExceptions.find(
        (d) => toUTCDateStr(d.date) === currentDateStr && d.isFull === true,
      );

      if (isFull) {
        day.classList.add("over-booked");
        day.dataset.disabled = "true";
      }

      const dayConfig = dayOffArray.find((d) => d.weekdayIndex === jsWeekdayIndex);

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
        day.classList.add("empty");
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

      const maxSlots = countPossibleSlots(activeWorkingHours, slotTime);
      const existingBookingsCount = specificExceptions.filter(
        (booking) => toUTCDateStr(booking.date) === currentDateStr,
      ).length;

      if (maxSlots > 0 && existingBookingsCount >= maxSlots) {
        day.classList.add("over-booked");
        day.dataset.disabled = "true";
      } else if (maxSlots > 0 && existingBookingsCount >= maxSlots / 2) {
        // Environ la moitié des créneaux sont déjà pris → avertissement orange
        day.classList.add("half-booked");
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

      // ── Day click ────────────────────────────────────────────────────────
      day.addEventListener("click", async () => {
        if (day.dataset.disabled === "true") return;
        if (day.classList.contains("empty")) return;

        const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
        datePicked         = dateStr;
        weekdayIndexPicked = day.dataset.weekdayIndex;

        // Reset previous selections
        window.__selectedService  = null;
        window.__selectedEmployee = null;
        schedulePicked = null;

        const services  = window.__services  || [];
        const employees = window.__employees || [];

        if (services.length > 0) {
          // Services ON → show service step first (employee step comes after, if linked)
          hideAllSteps();
          renderServiceStep();
          serviceStepWrapper && serviceStepWrapper.classList.add("show");
        } else if (employees.length > 0) {
          // Services OFF, employees ON → skip service step, pick employee directly
          hideAllSteps();
          renderEmployeeStep(employees);
          employeeStepWrapper && employeeStepWrapper.classList.add("show");
        } else {
          // Neither active → straight to time slots
          await fetchAndShowSlots();
        }
      });
    }

    // Next month trailing cells
    const totalCells    = calendarDays.children.length;
    const remainingCells = 7 * 6 - totalCells;
    for (let i = 1; i <= remainingCells; i++) {
      addEmptyCell(i);
    }
  }

  // ── Load form (once on init) ─────────────────────────────────────────────
  const COMPANY_ID_FOR_FORM = bookingWrapper
    ? bookingWrapper.getAttribute("data-company-id")
    : null;

  if (COMPANY_ID_FOR_FORM) {
    fetch(`/get-form/${COMPANY_ID_FOR_FORM}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.form && data.form.active && data.form.questions && data.form.questions.length > 0) {
          activeForm = data.form;
        }
      })
      .catch(() => {});
  }

  // ── Form step rendering ──────────────────────────────────────────────────
  function renderFormStep() {
    if (!formStepWrapper) return;
    const container = formStepWrapper.querySelector("#formStepQuestions");
    if (!container || !activeForm) return;

    container.innerHTML = "";
    const yes = __t.yes || "Oui";
    const no  = __t.no  || "Non";

    activeForm.questions.forEach((q, i) => {
      const div = document.createElement("div");
      div.className = "form-step-question";
      div.dataset.index    = i;
      div.dataset.type     = q.type;
      div.dataset.required = q.required ? "true" : "false";

      const labelEl = document.createElement("label");
      labelEl.innerHTML = `${q.label}${q.required ? ' <span class="req">✱</span>' : ""}`;
      div.appendChild(labelEl);

      if (q.type === "text") {
        const input = document.createElement("input");
        input.className = "input form-step-input";
        input.type = "text";
        div.appendChild(input);
      } else if (q.type === "choice") {
        const opts = document.createElement("div");
        opts.className = "choice-options";
        (q.options || []).forEach((opt) => {
          const radio = document.createElement("input");
          radio.type  = "radio";
          radio.name  = `q_${i}`;
          radio.value = opt;
          radio.style.display = "none";
          opts.appendChild(radio);

          const btn = document.createElement("button");
          btn.type      = "button";
          btn.className = "choice-option-btn";
          btn.textContent = opt;
          btn.addEventListener("click", () => {
            opts.querySelectorAll(".choice-option-btn").forEach((b) => b.classList.remove("selected"));
            opts.querySelectorAll("input[type=radio]").forEach((r) => (r.checked = false));
            btn.classList.add("selected");
            radio.checked = true;
          });
          opts.appendChild(btn);
        });
        div.appendChild(opts);
      } else if (q.type === "yes_no") {
        const yesno = document.createElement("div");
        yesno.className = "yesno-options";

        const yesBtn = document.createElement("button");
        yesBtn.type = "button"; yesBtn.className = "yesno-btn"; yesBtn.dataset.value = "yes"; yesBtn.textContent = yes;

        const noBtn = document.createElement("button");
        noBtn.type = "button"; noBtn.className = "yesno-btn"; noBtn.dataset.value = "no"; noBtn.textContent = no;

        [yesBtn, noBtn].forEach((btn) => {
          btn.addEventListener("click", () => {
            yesno.querySelectorAll(".yesno-btn").forEach((b) => b.classList.remove("selected"));
            btn.classList.add("selected");
          });
        });
        yesno.appendChild(yesBtn);
        yesno.appendChild(noBtn);
        div.appendChild(yesno);
      }

      container.appendChild(div);
    });
  }

  function collectFormAnswers() {
    const answers = [];
    if (!formStepWrapper || !activeForm) return answers;
    formStepWrapper.querySelectorAll(".form-step-question").forEach((q, i) => {
      const formQ = activeForm.questions[i];
      if (!formQ) return;
      let answer = "";
      if (formQ.type === "text") {
        const inp = q.querySelector(".form-step-input");
        answer = inp ? inp.value.trim() : "";
      } else if (formQ.type === "choice") {
        const checked = q.querySelector("input[type=radio]:checked");
        answer = checked ? checked.value : "";
      } else if (formQ.type === "yes_no") {
        const selected = q.querySelector(".yesno-btn.selected");
        answer = selected ? selected.dataset.value : "";
      }
      answers.push({ question: formQ.label, answer });
    });
    return answers;
  }

  function validateFormStep() {
    if (!formStepWrapper || !activeForm) return true;
    const questions = formStepWrapper.querySelectorAll(".form-step-question");
    let valid = true;
    questions.forEach((q, i) => {
      const formQ = activeForm.questions[i];
      if (!formQ || !formQ.required) return;
      let answer = "";
      if (formQ.type === "text") {
        const inp = q.querySelector(".form-step-input");
        answer = inp ? inp.value.trim() : "";
        if (!answer) inp && inp.classList.add("field-error");
      } else if (formQ.type === "choice") {
        const checked = q.querySelector("input[type=radio]:checked");
        answer = checked ? checked.value : "";
      } else if (formQ.type === "yes_no") {
        const selected = q.querySelector(".yesno-btn.selected");
        answer = selected ? selected.dataset.value : "";
      }
      if (!answer) valid = false;
    });
    if (!valid) {
      alert(__t.form_required_error || "Veuillez répondre à toutes les questions obligatoires");
    }
    return valid;
  }

  // ── Form step: back → schedule ───────────────────────────────────────────
  if (formStepWrapper) {
    const formBackBtn = formStepWrapper.querySelector(".back-btn");
    if (formBackBtn) {
      formBackBtn.addEventListener("click", () => {
        formStepWrapper.classList.remove("show");
        scheduleWrapper && scheduleWrapper.classList.add("show");
      });
    }

    const formNextBtn = formStepWrapper.querySelector("#formStepNextBtn");
    if (formNextBtn) {
      formNextBtn.addEventListener("click", () => {
        if (!validateFormStep()) return;
        formAnswers = collectFormAnswers();
        formStepWrapper.classList.remove("show");
        bookingWrapper && bookingWrapper.classList.add("show");
      });
    }

    formStepWrapper.addEventListener("input", (e) => {
      if (e.target.classList.contains("field-error")) {
        e.target.classList.remove("field-error");
      }
    });
  }

  // ── Render service selection ─────────────────────────────────────────────
  function renderServiceStep() {
    if (!serviceStepWrapper) return;
    const list = serviceStepWrapper.querySelector("#serviceStepList");
    if (!list) return;
    list.innerHTML = "";

    const services = window.__services || [];
    services.forEach((svc) => {
      const card = document.createElement("div");
      card.className = "svc-card";

      let metaHtml = "";
      if (svc.price !== null && svc.price !== undefined) {
        metaHtml += `<span class="svc-card__price">${svc.price}€</span>`;
      }
      metaHtml += `<span class="svc-card__dur">${svc.duration} min</span>`;

      const infoBtn = svc.description
        ? `<button class="bk-svc__info-btn" type="button" aria-label="Description du service"
              data-svc-name="${svc.name.replace(/"/g,'&quot;')}"
              data-svc-desc="${svc.description.replace(/"/g,'&quot;').replace(/\n/g,'&#10;')}">
            <svg width="16" height="16" viewBox="0 -960 960 960" fill="currentColor"><path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>
          </button>`
        : "";
      card.innerHTML = `
        <div class="svc-card__info">
          <div class="bk-svc__name-row">
            <span class="svc-card__name">${svc.name}</span>
            ${infoBtn}
          </div>
        </div>
        <div class="svc-card__meta">${metaHtml}</div>`;

      card.addEventListener("click", (e) => {
        // Ne pas sélectionner le service si on clique sur le bouton info
        if (e.target.closest(".bk-svc__info-btn")) return;
        onServiceSelected(svc);
      });

      // Bouton info → ouvre le bottom sheet (sans sélectionner le service)
      const btn = card.querySelector(".bk-svc__info-btn");
      if (btn) {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openSvcDescModal(btn.dataset.svcName, btn.dataset.svcDesc);
        });
      }

      list.appendChild(card);
    });
  }

  // ── Modale description service ──────────────────────────────────────────────
  function openSvcDescModal(name, desc) {
    // Supprimer une modale existante
    const old = document.getElementById("svcDescOverlay");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.className = "svc-desc-overlay";
    overlay.id = "svcDescOverlay";
    overlay.innerHTML = `
      <div class="svc-desc-sheet" role="dialog" aria-modal="true" aria-label="${name}">
        <div class="svc-desc-sheet__handle"></div>
        <div class="svc-desc-sheet__header">
          <span class="svc-desc-sheet__name">${name}</span>
          <button class="svc-desc-sheet__close" aria-label="Fermer">
            <svg viewBox="0 -960 960 960" width="16" height="16" fill="currentColor">
              <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
            </svg>
          </button>
        </div>
        <div class="svc-desc-sheet__body">${desc.replace(/&#10;/g, '\n')}</div>
      </div>`;

    document.body.appendChild(overlay);

    function close() { overlay.remove(); }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".svc-desc-sheet__close").addEventListener("click", close);
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
    });
  }

  function onServiceSelected(svc) {
    window.__selectedService  = { id: svc._id, name: svc.name, duration: svc.duration };
    window.__selectedEmployee = null;

    serviceStepWrapper && serviceStepWrapper.classList.remove("show");

    // If the service has specific employees → use those; otherwise fall back
    // to ALL active company employees so the "Avec" step always appears when
    // there are employees in the company.
    const svcEmployees     = svc.employees || [];
    const allEmployees     = window.__employees || [];
    const employeesToShow  = svcEmployees.length > 0 ? svcEmployees : allEmployees;

    if (employeesToShow.length > 0) {
      renderEmployeeStep(employeesToShow);
      employeeStepWrapper && employeeStepWrapper.classList.add("show");
    } else {
      // No employees at all — fetch slots right away
      fetchAndShowSlots();
    }
  }

  // ── Render employee selection ────────────────────────────────────────────
  function renderEmployeeStep(employees) {
    if (!employeeStepWrapper) return;
    const body = employeeStepWrapper.querySelector("#employeeStepBody");
    if (!body) return;
    body.innerHTML = "";

    employees.forEach((emp) => {
      const fullName = `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
      const card = document.createElement("div");
      card.className = "emp-step-card";
      card.innerHTML = `<img src="${emp.profilePicture || "/images/no-user.webp"}" alt="${fullName}"><span>${fullName}</span>`;
      card.addEventListener("click", () => {
        window.__selectedEmployee = { id: emp._id, name: fullName };
        employeeStepWrapper.classList.remove("show");
        fetchAndShowSlots();
      });
      body.appendChild(card);
    });

    // "No preference" option
    const skip = document.createElement("div");
    skip.className = "emp-step-skip";
    skip.textContent = __t.skip_employee || "Sans préférence";
    skip.addEventListener("click", () => {
      window.__selectedEmployee = null;
      employeeStepWrapper.classList.remove("show");
      fetchAndShowSlots();
    });
    body.appendChild(skip);
  }

  // ── Back: employee → service (or calendar if no services) ───────────────
  if (employeeStepWrapper) {
    const empBack = document.getElementById("empBackBtn");
    if (empBack) {
      empBack.addEventListener("click", () => {
        employeeStepWrapper.classList.remove("show");
        const services = window.__services || [];
        if (services.length > 0 && serviceStepWrapper) {
          renderServiceStep();
          serviceStepWrapper.classList.add("show");
        }
        // If no services, calendar is always visible — nothing more needed
      });
    }
    employeeStepWrapper.addEventListener("click", (e) => {
      if (e.target === employeeStepWrapper) employeeStepWrapper.classList.remove("show");
    });
  }

  // ── Back: service → (calendar stays visible) ────────────────────────────
  if (serviceStepWrapper) {
    const svcBack = document.getElementById("serviceBackBtn");
    if (svcBack) {
      svcBack.addEventListener("click", () => {
        serviceStepWrapper.classList.remove("show");
        // Calendar is always in DOM, nothing else needed
      });
    }
    serviceStepWrapper.addEventListener("click", (e) => {
      if (e.target === serviceStepWrapper) serviceStepWrapper.classList.remove("show");
    });
  }

  // ── Schedule: back → service step, employee step, or calendar ───────────
  if (scheduleWrapper) {
    const scheduleBackBtn = scheduleWrapper.querySelector(".back-btn");
    if (scheduleBackBtn) {
      scheduleBackBtn.addEventListener("click", () => {
        scheduleWrapper.classList.remove("show");
        const services  = window.__services  || [];
        const employees = window.__employees || [];
        if (services.length > 0 && serviceStepWrapper) {
          // Services ON: go back to service step
          renderServiceStep();
          serviceStepWrapper.classList.add("show");
        } else if (employees.length > 0 && employeeStepWrapper) {
          // Services OFF, employees ON: go back to employee picker
          renderEmployeeStep(employees);
          employeeStepWrapper.classList.add("show");
        }
        // Both off: calendar is always visible — nothing more needed
      });
    }
  }

  // ── Schedule: time slot click → form or booking ──────────────────────────
  if (scheduleWrapper) {
    scheduleWrapper.addEventListener("click", (e) => {
      const row = e.target.closest(".row:not(.reserved)");
      if (!row) return;

      schedulePicked = row.textContent.trim();
      proceedAfterSlot();
    });
  }

  // ── Booking wrapper: confirm (back is handled by booking.index.js) ────────
  if (bookingWrapper) {
    bookingWrapper.addEventListener("click", async (e) => {
      const button = e.target.closest("button#confirmBooking");
      if (!button) return;

      const name    = document.getElementById("bookingName");
      const surname = document.getElementById("bookingSurname");
      const email   = document.getElementById("bookingEmail");
      const phone   = document.getElementById("bookingPhone");
      const message = document.getElementById("bookingMsg");
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      const isClientLoggedIn = !!window.__clientUser;
      if (!isClientLoggedIn) {
        if (!emailPattern.test(email.value)) {
          const tmp = templateDialog.content.cloneNode(true);
          const parent = tmp.querySelector("#dialogWrp");
          function rmvParent() { parent.remove(); }
          tmp.querySelector(".dialog__h2").textContent = __t.invalid_email_title || "Email invalide";
          tmp.querySelector(".dialog__p").textContent  = __t.invalid_email_desc  || "Veuillez modifier l'email et mettre un email valide.";
          tmp.querySelector(".dialog__icon").onclick   = rmvParent;
          tmp.querySelector(".dialog__btn2").innerHTML = `<span>${__t.close || "Fermer"}</span>`;
          tmp.querySelector(".dialog__btn2").onclick   = rmvParent;
          document.querySelector("body").appendChild(tmp);
          email.style.border = "1px solid red";
          return;
        }
        const fields = [name, surname, email, phone];
        let isFormValid = true;
        fields.forEach((field) => {
          if (!field || field.value.trim() === "") {
            if (field) field.classList.add("empty-field");
            isFormValid = false;
          } else {
            if (field) field.classList.remove("empty-field");
          }
        });
        if (!isFormValid) return;
      }

      const popup    = document.querySelector(".confirm-popup");
      const newPopup = popup.cloneNode(true);
      newPopup.classList.add("show");
      newPopup.querySelector(".confirm-popup__title").textContent = "Your booking has been confirmed !";
      newPopup.querySelector(".confirm-popup__description").textContent = "You have received an email in your inbox";
      newPopup.querySelector(".cancel-btn").style.display = "none";
      document.body.appendChild(newPopup);
      newPopup.querySelector(".confirm-btn").onclick = () => newPopup.remove();

      const selectedService  = window.__selectedService  || null;
      const selectedEmployee = window.__selectedEmployee || null;

      const request = await fetch("/create-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date:         datePicked,
          startTime:    schedulePicked,
          company:      bookingWrapper.getAttribute("data-company-id"),
          name:         name.value,
          surname:      surname.value,
          email:        email.value,
          phone:        phone.value,
          message:      message.value,
          formAnswers,
          serviceId:       selectedService  ? selectedService.id       : null,
          serviceName:     selectedService  ? selectedService.name     : null,
          serviceDuration: selectedService  ? selectedService.duration : null,
          employeeId:      selectedEmployee ? selectedEmployee.id      : null,
          employeeName:    selectedEmployee ? selectedEmployee.name    : null,
        }),
      });

      const response = await request.json();
      if (!response.success) {
        if (response.error === "no_employee_available") {
          alert("Ce créneau n'est plus disponible : tous les employés sont déjà réservés à cet horaire.");
        } else if (response.error === "monthly_limit_reached") {
          alert("Ce professionnel ne peut plus accepter de nouvelles réservations ce mois-ci. Revenez le mois prochain ou contactez-les directement.");
        } else {
          alert("Une erreur est survenue, veuillez réessayer.");
        }
        return;
      }

      scheduleWrapper && scheduleWrapper.classList.remove("show");
      bookingWrapper.classList.remove("show");
    });
  }

  // ── Month navigation ─────────────────────────────────────────────────────
  prevMonthBtn.addEventListener("click", () => {
    prevMonthBtn.style.pointerEvents = "none";
    prevMonthBtn.style.opacity = "0.5";
    const currentMonth = today.getMonth();
    const currentYear  = today.getFullYear();
    setTimeout(() => {
      prevMonthBtn.style.pointerEvents = "all";
      prevMonthBtn.style.opacity = "1";
    }, 500);
    if (currentYear > realToday.getFullYear() || currentMonth > realToday.getMonth()) {
      today.setMonth(today.getMonth() - 1);
      renderCalendar();
    }
  });

  nextMonthBtn.addEventListener("click", () => {
    nextMonthBtn.style.pointerEvents = "none";
    nextMonthBtn.style.opacity = "0.5";
    today.setMonth(today.getMonth() + 1);
    renderCalendar();
    setTimeout(() => {
      nextMonthBtn.style.pointerEvents = "all";
      nextMonthBtn.style.opacity = "1";
    }, 500);
  });

  renderCalendar();
}
