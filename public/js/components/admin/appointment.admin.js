export const initDeleteAppointment = function () {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".appointment-action");
    if (!btn) return;

    const { link, method } = btn.dataset;

    try {
      const result = await fetch(link, { method });
      const data = await result.json();

      if (data.success) {
        location.href = "/appointment";
      } else {
        alert(data.message);
      }
    } catch (err) {
      console.error("Network error", err);
    }
  });
};

// ── Appointment popup (Google Calendar style) ─────────────────────────────
export const initAppointmentPopup = function () {
  const popup = document.getElementById("apptPopup");
  if (!popup) return;

  // Move popup to <body> so no parent overflow/transform can clip it
  document.body.appendChild(popup);

  const titleEl    = document.getElementById("apptPopupTitle");
  const datetimeEl = document.getElementById("apptPopupDatetime");
  const dotEl      = document.getElementById("apptPopupDot");
  const empRow     = document.getElementById("apptPopupEmployeeRow");
  const empName    = document.getElementById("apptPopupEmployeeName");
  const svcRow     = document.getElementById("apptPopupServiceRow");
  const svcName    = document.getElementById("apptPopupServiceName");
  const canceledEl = document.getElementById("apptPopupCanceled");
  const editBtn    = document.getElementById("apptPopupEdit");
  const deleteBtn  = document.getElementById("apptPopupDelete");
  const closeBtn   = document.getElementById("apptPopupClose");
  const detailBtn  = document.getElementById("apptPopupDetailBtn");

  let currentId = null;

  /* ── Position popup near the clicked card ── */
  function positionPopup(card) {
    const rect = card.getBoundingClientRect();
    const pw   = 300;
    const ph   = popup.offsetHeight || 250;
    const gap  = 8;

    // Prefer right of card, fallback left, fallback centered
    let left = rect.right + gap;
    if (left + pw > window.innerWidth - gap) left = rect.left - pw - gap;
    if (left < gap) left = Math.round((window.innerWidth - pw) / 2);

    // Align top with card, shift up if overflows bottom
    let top = rect.top;
    if (top + ph > window.innerHeight - gap) top = window.innerHeight - ph - gap;
    if (top < gap) top = gap;

    popup.style.left = `${left}px`;
    popup.style.top  = `${top}px`;
  }

  /* ── Show popup ── */
  function showPopup(card) {
    const d = card.dataset;
    currentId = d.id;

    // Title
    titleEl.textContent = [d.name, d.surname].filter(Boolean).join(" ").trim();

    // Date + time
    if (d.date) {
      const [yyyy, mm, dd] = d.date.split("-");
      const dateObj  = new Date(+yyyy, +mm - 1, +dd);
      const lang     = document.documentElement.lang || "fr";
      const dateStr  = dateObj.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long" });
      datetimeEl.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1) + " · " + d.start + " – " + d.end;
    }

    // Employee row
    if (d.employee) { empName.textContent = d.employee; empRow.style.display = "flex"; }
    else              { empRow.style.display = "none"; }

    // Service row
    if (d.service)  { svcName.textContent = d.service;  svcRow.style.display = "flex"; }
    else              { svcRow.style.display = "none"; }

    // Canceled badge
    if (d.status === "canceled") {
      canceledEl.style.display = "inline-block";
      dotEl.style.background   = "#9ca3af";
    } else {
      canceledEl.style.display = "none";
      dotEl.style.background   = "";
    }

    // Edit / detail links
    editBtn.onclick  = () => { window.location.href = `/history/edit/${currentId}`; };
    detailBtn.href   = `/history/edit/${currentId}`;

    // Position BEFORE showing (offsetHeight works because visibility:hidden keeps layout)
    positionPopup(card);

    // Show via CSS class (no inline opacity override — CSS handles it)
    popup.classList.add("open");
  }

  /* ── Hide popup ── */
  function hidePopup() {
    popup.classList.remove("open");
    currentId = null;
  }

  /* ── Pill click → open popup ── */
  document.addEventListener("click", (e) => {
    const pill = e.target.closest(".appt-pill[data-id]");

    if (pill) {
      e.stopPropagation();
      // Toggle: same pill while open → close
      if (currentId === pill.dataset.id && popup.classList.contains("open")) {
        hidePopup();
      } else {
        showPopup(pill);
      }
      return;
    }

    // Click outside popup → close
    if (popup.classList.contains("open") && !popup.contains(e.target)) {
      hidePopup();
    }
  });

  // Action buttons
  closeBtn.addEventListener("click",  (e) => { e.stopPropagation(); hidePopup(); });

  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!currentId) return;
    if (!confirm("Supprimer ce rendez-vous définitivement ?")) return;
    try {
      const res  = await fetch(`/appointment/${currentId}/delete`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) { hidePopup(); window.location.reload(); }
      else alert(data.message || "Erreur lors de la suppression.");
    } catch (err) { console.error("Delete error:", err); }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hidePopup();
  });
};

export const initCalendarHeader = function () {
  const calendar = document.querySelector(".calendar");
  if (!calendar) return console.log("no calendar");

  const params = new URLSearchParams(window.location.search);

  let currentDate = params.get("date")
    ? new Date(params.get("date") + "T12:00:00")
    : new Date();

  // Helper: navigate to date preserving the employee filter
  function navigateTo(dateStr) {
    const emp = params.get("employee") || "all";
    window.location.href = `/appointment?date=${dateStr}&employee=${emp}`;
  }

  calendar.addEventListener("click", (e) => {
    const directionBtn = e.target.closest(".calendar__date-btn");
    if (!directionBtn) return;

    const direction = directionBtn.dataset.direction;
    const isMobile = window.matchMedia("(max-width: 819px)").matches;
    const step = isMobile ? 1 : 7;

    if (direction === "prev") currentDate.setDate(currentDate.getDate() - step);
    if (direction === "next") currentDate.setDate(currentDate.getDate() + step);

    navigateTo(currentDate.toISOString().split("T")[0]);
  });

  // Employee filter: reload page with selected employee
  const empSelect = document.getElementById("empFilterSelect");
  if (empSelect) {
    empSelect.addEventListener("change", () => {
      const dateStr = currentDate.toISOString().split("T")[0];
      window.location.href = `/appointment?date=${dateStr}&employee=${empSelect.value}`;
    });
  }
};
