import { createTimePicker } from "../../utils/time-picker.js";

document.addEventListener("DOMContentLoaded", () => {
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

  const startPicker = createTimePicker(
    document.getElementById("courseStartBox"),
    document.getElementById("courseStartPanel"),
    document.getElementById("courseStartList"),
    () => {}
  );

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
    setSelectedWeekdays([]);
    startPicker.set("");
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
    titleEl.textContent = "Nouveau cours collectif";
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
      setSelectedWeekdays((card.dataset.weekdays || "").split(",").filter(Boolean).map(Number));
      startPicker.set(card.dataset.startTime || "");

      const assignedIds = (card.dataset.employees || "").split(",").filter(Boolean);
      if (hasEmployeesChk && assignedIds.length > 0) {
        hasEmployeesChk.checked = true;
        employeesField.style.display = "";
        employeeCheckboxes.forEach((cb) => { cb.checked = assignedIds.includes(cb.value); });
      }

      titleEl.textContent = "Modifier le cours";
      open();
    });
  });

  saveBtn.addEventListener("click", async () => {
    errorEl.style.display = "none";

    const name = nameInput.value.trim();
    const weekdays = selectedWeekdays();
    const startTime = startPicker.get();
    const duration = Number(durationInput.value);
    const capacity = Number(capacityInput.value);

    if (!name) { showError("Le nom du cours est requis."); return; }
    if (weekdays.length === 0) { showError("Choisissez au moins un jour de la semaine."); return; }
    if (!startTime) { showError("Choisissez une heure."); return; }
    if (!duration || duration < 5) { showError("Durée invalide."); return; }
    if (!capacity || capacity < 1) { showError("Le nombre de places doit être au moins 1."); return; }

    const payload = {
      name,
      description: descInput.value.trim(),
      price: priceInput.value !== "" ? Number(priceInput.value) : "",
      duration,
      capacity,
      weekdays,
      startTime,
      employees: hasEmployeesChk && hasEmployeesChk.checked
        ? employeeCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value)
        : [],
    };

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
        showError(data.message || data.error || "Erreur lors de l'enregistrement.");
        saveBtn.disabled = false;
      }
    } catch (e) {
      showError("Erreur réseau.");
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
        `Supprimer "${btn.dataset.name}" ?`,
        "Ce cours sera définitivement supprimé. Les inscriptions déjà passées restent visibles dans l'historique."
      );
      if (!ok) return;
      try {
        const res = await fetch(`/api/courses/${btn.dataset.id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) {
          window.location.reload();
        } else {
          alert(data.message || "Erreur lors de la suppression.");
        }
      } catch (e) {
        alert("Erreur réseau.");
      }
    });
  });
});
