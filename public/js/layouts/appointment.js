import {
  initDeleteAppointment,
  initCalendarHeader,
  initAppointmentPopup,
} from "../components/admin/appointment.admin.js";

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
  const timeInput    = document.getElementById("newApptTime");
  const serviceSel   = document.getElementById("newApptService");
  const employeeSel  = document.getElementById("newApptEmployee");
  const nameInput    = document.getElementById("newApptName");
  const surnameInput = document.getElementById("newApptSurname");
  const emailInput   = document.getElementById("newApptEmail");
  const phoneInput   = document.getElementById("newApptPhone");
  const messageInput = document.getElementById("newApptMessage");

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  }

  function resetForm() {
    dateInput.value = "";
    timeInput.value = "";
    if (serviceSel) serviceSel.value = "";
    if (employeeSel) employeeSel.value = "";
    nameInput.value = "";
    surnameInput.value = "";
    emailInput.value = "";
    phoneInput.value = "";
    messageInput.value = "";
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }

  function open() {
    resetForm();
    const today = new Date();
    dateInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    overlay.classList.add("show");
  }

  function close() {
    overlay.classList.remove("show");
  }

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("show")) close();
  });

  submitBtn.addEventListener("click", async () => {
    errorEl.style.display = "none";

    const date  = dateInput.value;
    const time  = timeInput.value;
    const name  = nameInput.value.trim();
    const email = emailInput.value.trim();

    if (!date || !time || !name || !email) {
      showError("Veuillez remplir les champs obligatoires (date, heure, prénom, email).");
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
