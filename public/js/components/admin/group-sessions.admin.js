import { createTimePicker } from "../../utils/time-picker.js";

document.addEventListener("DOMContentLoaded", () => {
  const T    = window.__t_group_sessions || {};
  const LANG = window.__lang || "fr";
  const addBtn      = document.getElementById("addCourseBtn");
  const overlay     = document.getElementById("courseModalOverlay");
  const modal       = document.getElementById("courseModal");
  const closeBtn    = document.getElementById("closeCourseModal");
  const cancelBtn   = document.getElementById("cancelCourseModal");
  const saveBtn     = document.getElementById("saveCourseBtn");
  const errorEl     = document.getElementById("courseModalError");
  const titleEl     = document.getElementById("courseModalTitle");

  if (!addBtn || !overlay) return;

  const idInput          = document.getElementById("courseModalId");
  const nameInput        = document.getElementById("courseName");
  const descInput        = document.getElementById("courseDescription");
  const priceInput       = document.getElementById("coursePrice");
  const durationInput    = document.getElementById("courseDuration");
  const capacityInput    = document.getElementById("courseCapacity");
  const weekdayChips     = Array.from(document.querySelectorAll(".gs-weekday-chip"));
  const hasEmployeesChk  = document.getElementById("courseHasEmployees");
  const employeesField   = document.getElementById("courseEmployeesField");
  const employeeCheckboxes = Array.from(document.querySelectorAll("#courseEmployeeList input[type=checkbox]"));
  const locationInput    = document.getElementById("courseLocation");

  // ── Mode de planification : récurrent (hebdomadaire) ou dates ponctuelles ──
  const modeOptions       = document.getElementById("courseModeOptions");
  const recurringFieldsEl = document.getElementById("courseRecurringFields");
  const fixedFieldsEl     = document.getElementById("courseFixedFields");
  const sessionRowsEl     = document.getElementById("courseSessionRows");
  const newSessionDateInput = document.getElementById("newSessionDate");
  const addSessionRowBtn  = document.getElementById("addSessionRowBtn");

  let currentMode  = "recurring";
  let sessionRows  = []; // { date: "yyyy-mm-dd", startTime: "HH:MM", endTime: "HH:MM" }

  function setMode(mode) {
    currentMode = mode === "fixed" ? "fixed" : "recurring";
    if (modeOptions) {
      modeOptions.querySelectorAll(".svc-type-option").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.mode === currentMode);
      });
    }
    if (recurringFieldsEl) recurringFieldsEl.style.display = currentMode === "recurring" ? "" : "none";
    if (fixedFieldsEl)     fixedFieldsEl.style.display     = currentMode === "fixed"     ? "" : "none";
  }

  if (modeOptions) {
    modeOptions.addEventListener("click", (e) => {
      const btn = e.target.closest(".svc-type-option");
      if (!btn) return;
      setMode(btn.dataset.mode);
    });
  }

  function renderSessionRows() {
    if (!sessionRowsEl) return;
    if (sessionRows.length === 0) {
      sessionRowsEl.innerHTML = `<p class="gs-session-rows__empty">${T.no_dates_added || ""}</p>`;
      return;
    }
    sessionRowsEl.innerHTML = sessionRows.map((s, i) => {
      const d = new Date(`${s.date}T00:00:00`);
      const label = d.toLocaleDateString(LANG, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
      return `<div class="gs-session-row">
        <span class="gs-session-row__date">${label}</span>
        <span class="gs-session-row__time">${s.startTime} – ${s.endTime}</span>
        <button type="button" class="gs-session-row__remove" data-index="${i}" aria-label="${T.remove_date_label || ""}">×</button>
      </div>`;
    }).join("");
  }

  if (sessionRowsEl) {
    sessionRowsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".gs-session-row__remove");
      if (!btn) return;
      sessionRows.splice(Number(btn.dataset.index), 1);
      renderSessionRows();
    });
  }

  const startPicker = createTimePicker(
    document.getElementById("courseStartBox"),
    document.getElementById("courseStartPanel"),
    document.getElementById("courseStartList"),
    () => {}
  );

  const newSessionStartPicker = createTimePicker(
    document.getElementById("newSessionStartBox"),
    document.getElementById("newSessionStartPanel"),
    document.getElementById("newSessionStartList"),
    () => {}
  );
  const newSessionEndPicker = createTimePicker(
    document.getElementById("newSessionEndBox"),
    document.getElementById("newSessionEndPanel"),
    document.getElementById("newSessionEndList"),
    () => {}
  );

  if (addSessionRowBtn) {
    addSessionRowBtn.addEventListener("click", () => {
      const date  = newSessionDateInput ? newSessionDateInput.value : "";
      const start = newSessionStartPicker.get();
      const end   = newSessionEndPicker.get();
      if (!date)        { showError(T.required_session_date_error); return; }
      if (!start || !end) { showError(T.required_session_time_error); return; }
      if (start === end) { showError(T.session_time_order_error); return; }

      sessionRows.push({ date, startTime: start, endTime: end });
      sessionRows.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
      renderSessionRows();

      newSessionDateInput.value = "";
      newSessionStartPicker.set("");
      newSessionEndPicker.set("");
      errorEl.style.display = "none";
    });
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = "block";
  }

  function selectedWeekdays() {
    return weekdayChips.filter((c) => c.classList.contains("is-active")).map((c) => Number(c.dataset.day));
  }
  function setSelectedWeekdays(days) {
    weekdayChips.forEach((c) => c.classList.toggle("is-active", days.includes(Number(c.dataset.day))));
  }

  weekdayChips.forEach((chip) => {
    chip.addEventListener("click", () => chip.classList.toggle("is-active"));
  });

  if (hasEmployeesChk) {
    hasEmployeesChk.addEventListener("change", () => {
      employeesField.style.display = hasEmployeesChk.checked ? "" : "none";
      if (!hasEmployeesChk.checked) employeeCheckboxes.forEach((cb) => { cb.checked = false; });
    });
  }

  function resetForm() {
    idInput.value = "";
    nameInput.value = "";
    descInput.value = "";
    priceInput.value = "";
    durationInput.value = String(window.__defaultDuration || 60);
    capacityInput.value = "10";
    if (locationInput) locationInput.value = "";
    setSelectedWeekdays([]);
    startPicker.set("");
    setMode("recurring");
    sessionRows = [];
    renderSessionRows();
    if (newSessionDateInput) newSessionDateInput.value = "";
    newSessionStartPicker.set("");
    newSessionEndPicker.set("");
    if (hasEmployeesChk) {
      hasEmployeesChk.checked = false;
      employeesField.style.display = "none";
    }
    employeeCheckboxes.forEach((cb) => { cb.checked = false; });
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }

  function open() {
    overlay.classList.add("show");
    modal.classList.add("show");
  }
  function close() {
    overlay.classList.remove("show");
    modal.classList.remove("show");
    document.querySelectorAll(".appt-time-panel.open").forEach((p) => p.classList.remove("open"));
  }

  addBtn.addEventListener("click", () => {
    resetForm();
    titleEl.textContent = T.modal_new_title || "";
    open();
    nameInput.focus();
  });

  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("show")) close();
  });

  // ── Modifier un cours existant : pré-remplir depuis les data-* de la carte ──
  document.querySelectorAll(".edit-course-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = document.querySelector(`.gs-course-card[data-id="${btn.dataset.id}"]`);
      if (!card) return;
      resetForm();

      idInput.value = card.dataset.id;
      nameInput.value = card.dataset.name || "";
      descInput.value = card.dataset.description || "";
      priceInput.value = card.dataset.price || "";
      durationInput.value = card.dataset.duration || "60";
      capacityInput.value = card.dataset.capacity || "10";
      if (locationInput) locationInput.value = card.dataset.location || "";
      setSelectedWeekdays((card.dataset.weekdays || "").split(",").filter(Boolean).map(Number));
      startPicker.set(card.dataset.startTime || "");

      const mode = card.dataset.mode === "fixed" ? "fixed" : "recurring";
      setMode(mode);
      if (mode === "fixed") {
        try {
          sessionRows = JSON.parse(card.dataset.sessions || "[]").map((s) => ({
            date: String(s.date).split("T")[0],
            startTime: s.startTime,
            endTime: s.endTime,
          }));
        } catch (e) {
          sessionRows = [];
        }
        renderSessionRows();
      }

      const assignedIds = (card.dataset.employees || "").split(",").filter(Boolean);
      if (hasEmployeesChk && assignedIds.length > 0) {
        hasEmployeesChk.checked = true;
        employeesField.style.display = "";
        employeeCheckboxes.forEach((cb) => { cb.checked = assignedIds.includes(cb.value); });
      }

      titleEl.textContent = T.modal_edit_title || "";
      open();
    });
  });

  saveBtn.addEventListener("click", async () => {
    errorEl.style.display = "none";

    const name = nameInput.value.trim();
    const duration = Number(durationInput.value);
    const capacity = Number(capacityInput.value);

    if (!name) { showError(T.required_name_error); return; }
    if (!duration || duration < 5) { showError(T.duration_error); return; }
    if (!capacity || capacity < 1) { showError(T.capacity_error); return; }

    const payload = {
      name,
      description: descInput.value.trim(),
      price: priceInput.value !== "" ? Number(priceInput.value) : "",
      duration,
      capacity,
      mode: currentMode,
      location: locationInput ? locationInput.value.trim() : "",
      employees: hasEmployeesChk && hasEmployeesChk.checked
        ? employeeCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value)
        : [],
    };

    if (currentMode === "fixed") {
      if (sessionRows.length === 0) { showError(T.required_session_error); return; }
      payload.sessions = sessionRows;
    } else {
      const weekdays = selectedWeekdays();
      const startTime = startPicker.get();
      if (weekdays.length === 0) { showError(T.required_weekday_error); return; }
      if (!startTime) { showError(T.required_time_error); return; }
      payload.weekdays = weekdays;
      payload.startTime = startTime;
    }

    const id = idInput.value;
    const url = id ? `/api/courses/${id}` : "/api/courses";
    const method = id ? "PATCH" : "POST";

    saveBtn.disabled = true;
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        window.location.reload();
      } else {
        showError(data.message || data.error || T.save_error);
        saveBtn.disabled = false;
      }
    } catch (e) {
      showError(T.network_error);
      saveBtn.disabled = false;
    }
  });

  // ── Activer / désactiver un cours ───────────────────────────────────────
  document.querySelectorAll(".toggle-course-active").forEach((toggle) => {
    toggle.addEventListener("change", async () => {
      const id = toggle.dataset.id;
      toggle.disabled = true;
      try {
        const res = await fetch(`/api/courses/${id}/toggle`, { method: "PATCH" });
        const data = await res.json();
        if (data.success) {
          toggle.closest(".gs-course-card").classList.toggle("gs-course-card--inactive", !data.active);
        } else {
          toggle.checked = !toggle.checked;
        }
      } catch (e) {
        toggle.checked = !toggle.checked;
      }
      toggle.disabled = false;
    });
  });

  // ── Supprimer un cours ───────────────────────────────────────────────────
  document.querySelectorAll(".delete-course-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await window.confirmModal(
        (T.delete_confirm_title || "").replace("{name}", btn.dataset.name),
        T.delete_confirm_desc
      );
      if (!ok) return;
      try {
        const res = await fetch(`/api/courses/${btn.dataset.id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) {
          window.location.reload();
        } else {
          alert(data.message || T.remove_error);
        }
      } catch (e) {
        alert(T.network_error);
      }
    });
  });

  // Ouverture automatique depuis la page « Services 2 » : le bouton « Nouveau ›
  // Cours collectif » renvoie ici avec ?new=1, et le crayon d'un cours avec
  // ?edit=<id> — on déclenche la bonne modale (création / édition).
  try {
    const _p = new URLSearchParams(location.search);
    const _editId = _p.get("edit");
    if (_editId) {
      const _eb = document.querySelector('.edit-course-btn[data-id="' + _editId + '"]');
      if (_eb) _eb.click();
      history.replaceState(null, "", location.pathname);
    } else if (_p.get("new") === "1") {
      const _ab = document.getElementById("addCourseBtn");
      if (_ab) _ab.click();
      history.replaceState(null, "", location.pathname);
    }
  } catch (e) {}
});
