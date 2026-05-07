/**
 * client-services.js
 * Gère la sélection du service et de l'employé avant le calendrier.
 * Expose window.__selectedService et window.__selectedEmployee pour calendar.index.js.
 */
(function () {
  const serviceStepWrapper  = document.getElementById("serviceStepWrapper");
  const employeeStepWrapper = document.getElementById("employeeStepWrapper");
  const calendarWrapper     = document.querySelector(".calendar-wrapper");
  const empBackBtn          = document.getElementById("empBackBtn");
  const employeeStepBody    = document.getElementById("employeeStepBody");

  // Si pas de services → on ne fait rien (calendrier déjà visible)
  if (!serviceStepWrapper) return;

  // Cacher le calendrier jusqu'au choix du service
  if (calendarWrapper) calendarWrapper.classList.remove("ready");

  window.__selectedService  = null;
  window.__selectedEmployee = null;

  // ── Sélection du service ────────────────────────────────────────────────────
  const serviceCards = serviceStepWrapper.querySelectorAll(".service-step__card");

  serviceCards.forEach((card) => {
    card.addEventListener("click", () => {
      // Déselectionner les autres
      serviceCards.forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");

      const serviceId   = card.dataset.id;
      const serviceName = card.dataset.name;
      const duration    = parseInt(card.dataset.duration) || 30;
      let employees     = [];

      try {
        employees = JSON.parse(card.dataset.employees || "[]");
      } catch {}

      window.__selectedService = { id: serviceId, name: serviceName, duration };
      window.__selectedEmployee = null;

      if (employees.length > 0) {
        // Afficher le step employé
        renderEmployeeStep(employees, serviceName);
      } else {
        // Passer directement au calendrier
        showCalendar();
      }
    });
  });

  // ── Rendre le step employé ─────────────────────────────────────────────────
  function renderEmployeeStep(employees, serviceName) {
    employeeStepBody.innerHTML = "";

    employees.forEach((emp) => {
      const card = document.createElement("div");
      card.className = "emp-card";
      card.dataset.id = emp._id;
      card.innerHTML = `
        <img src="${emp.profilePicture || '/images/no-user.webp'}" alt="${emp.fullName}">
        <span>${emp.fullName}</span>
      `;
      card.addEventListener("click", () => {
        window.__selectedEmployee = { id: emp._id, name: emp.fullName };
        employeeStepWrapper.classList.remove("show");
        showCalendar();
      });
      employeeStepBody.appendChild(card);
    });

    // Option "sans préférence"
    const skip = document.createElement("div");
    skip.className = "emp-card-skip";
    skip.textContent = "Sans préférence d'employé";
    skip.addEventListener("click", () => {
      window.__selectedEmployee = null;
      employeeStepWrapper.classList.remove("show");
      showCalendar();
    });
    employeeStepBody.appendChild(skip);

    employeeStepWrapper.classList.add("show");
  }

  // ── Retour depuis le step employé ─────────────────────────────────────────
  if (empBackBtn) {
    empBackBtn.addEventListener("click", () => {
      employeeStepWrapper.classList.remove("show");
    });
  }

  // Clic overlay pour fermer
  if (employeeStepWrapper) {
    employeeStepWrapper.addEventListener("click", (e) => {
      if (e.target === employeeStepWrapper) {
        employeeStepWrapper.classList.remove("show");
      }
    });
  }

  // ── Révéler le calendrier ──────────────────────────────────────────────────
  function showCalendar() {
    if (calendarWrapper) {
      calendarWrapper.classList.add("ready");
    }
  }
})();
