document.addEventListener("DOMContentLoaded", () => {
  // ── Références DOM ─────────────────────────────────────────────────────────
  const addServiceBtn      = document.getElementById("addServiceBtn");
  const addServiceCardBtn  = document.getElementById("addServiceCardBtn");
  const serviceModal       = document.getElementById("serviceModal");
  const serviceModalOverlay = document.getElementById("serviceModalOverlay");
  const closeServiceModal  = document.getElementById("closeServiceModal");
  const cancelServiceModal = document.getElementById("cancelServiceModal");
  const saveServiceBtn     = document.getElementById("saveServiceBtn");
  const serviceModalTitle  = document.getElementById("serviceModalTitle");
  const serviceModalId     = document.getElementById("serviceModalId");
  const serviceModalName   = document.getElementById("serviceModalName");
  const serviceModalDesc   = document.getElementById("serviceModalDesc");
  const serviceModalPrice  = document.getElementById("serviceModalPrice");
  const serviceModalDuration = document.getElementById("serviceModalDuration");
  const servicesList       = document.getElementById("servicesList");
  const svcCounter         = document.getElementById("svcCounter");

  const MAX_SERVICES = window.__maxServices || 0;
  let currentCount   = window.__svcCount   || 0;

  const empModal           = document.getElementById("empModal");
  const empModalOverlay    = document.getElementById("empModalOverlay");
  const closeEmpModal      = document.getElementById("closeEmpModal");
  const cancelEmpModal     = document.getElementById("cancelEmpModal");
  const saveEmpBtn         = document.getElementById("saveEmpBtn");
  const empModalServiceName = document.getElementById("empModalServiceName");
  const empList            = document.getElementById("empList");

  let currentEmpServiceId  = null;
  let allEmployees         = [];

  function updateCounter() {
    if (!svcCounter) return;
    svcCounter.textContent = `${currentCount} / ${MAX_SERVICES}`;
    svcCounter.classList.toggle("services-counter--full", currentCount >= MAX_SERVICES);
  }

  function updateAddBtn() {
    if (!addServiceBtn) return;
    const atLimit = MAX_SERVICES > 0 && currentCount >= MAX_SERVICES;
    addServiceBtn.disabled = atLimit;
    addServiceBtn.title = atLimit ? `Limite de ${MAX_SERVICES} services atteinte` : "";
  }

  updateCounter();
  updateAddBtn();

  // ── Helpers ────────────────────────────────────────────────────────────────
  function openModal(modal, overlay) {
    overlay.classList.add("show");
    modal.classList.add("show");
  }

  function closeModal(modal, overlay) {
    overlay.classList.remove("show");
    modal.classList.remove("show");
  }

  function resetServiceModal() {
    serviceModalId.value = "";
    serviceModalName.value = "";
    serviceModalDesc.value = "";
    serviceModalPrice.value = "";
    serviceModalDuration.value = "30";
    serviceModalTitle.textContent = "Nouveau service";
    saveServiceBtn.querySelector("span").textContent = "Enregistrer";
  }

  // ── Ouvrir modal création ─────────────────────────────────────────────────
  function openNewServiceModal() {
    resetServiceModal();
    openModal(serviceModal, serviceModalOverlay);
    serviceModalName.focus();
  }

  addServiceBtn.addEventListener("click", openNewServiceModal);
  if (addServiceCardBtn && !addServiceCardBtn.classList.contains("svc-card--locked-invite")) {
    addServiceCardBtn.addEventListener("click", openNewServiceModal);
  }

  [closeServiceModal, cancelServiceModal, serviceModalOverlay].forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target !== el) return;
      closeModal(serviceModal, serviceModalOverlay);
    });
  });

  // ── Sauvegarder (créer ou modifier) ──────────────────────────────────────
  saveServiceBtn.addEventListener("click", async () => {
    const name = serviceModalName.value.trim();
    if (!name) { serviceModalName.focus(); return; }

    const id   = serviceModalId.value;
    const body = {
      name,
      description: serviceModalDesc.value.trim(),
      price: serviceModalPrice.value,
      duration: serviceModalDuration.value || 30,
    };

    const url    = id ? `/api/services/${id}` : "/api/services";
    const method = id ? "PATCH" : "POST";

    try {
      const res  = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (data.success) {
        if (!id) { currentCount++; }
        location.reload();
      } else {
        const msg = data.error === "plan_limit" ? data.message : (data.error || "Erreur lors de l'enregistrement.");
        alert(msg);
      }
    } catch (e) {
      alert("Erreur réseau.");
    }
  });

  // ── Modifier un service (clic sur crayon) ─────────────────────────────────
  servicesList.addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".edit-service-btn");
    const delBtn  = e.target.closest(".delete-service-btn");
    const toggleActive = e.target.closest(".toggle-active");
    const manageEmp = e.target.closest(".manage-employees-btn");

    if (editBtn) {
      const card = editBtn.closest(".service-card");
      const id   = editBtn.dataset.id;
      // Récupérer les données depuis le DOM (ou via API)
      serviceModalId.value = id;
      serviceModalName.value = card.querySelector(".service-card__name").textContent.trim();
      serviceModalDesc.value = card.querySelector(".service-card__desc") ? card.querySelector(".service-card__desc").textContent.trim() : "";
      const priceBadge = card.querySelector(".badge--price");
      serviceModalPrice.value = priceBadge ? priceBadge.textContent.replace("€", "").trim() : "";
      const durBadge = card.querySelector(".badge--duration");
      serviceModalDuration.value = durBadge ? parseInt(durBadge.textContent) : 30;
      serviceModalTitle.textContent = "Modifier le service";
      openModal(serviceModal, serviceModalOverlay);
      serviceModalName.focus();
    }

    if (delBtn) {
      if (!confirm("Supprimer ce service ? Cette action est irréversible.")) return;
      const id = delBtn.dataset.id;
      try {
        const res = await fetch(`/api/services/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) {
          delBtn.closest(".service-card").remove();
          currentCount = Math.max(0, currentCount - 1);
          updateCounter();
          updateAddBtn();
        }
      } catch (e) { alert("Erreur réseau."); }
    }

    if (manageEmp) {
      currentEmpServiceId = manageEmp.dataset.id;
      empModalServiceName.textContent = manageEmp.dataset.name || "";

      // Charger les employés de la company
      if (allEmployees.length === 0) {
        const r = await fetch("/api/services/employees");
        const d = await r.json();
        allEmployees = d.employees || [];
      }

      // Récupérer les employés actuellement liés à ce service
      const card = manageEmp.closest(".service-card");
      const currentEmps = [...card.querySelectorAll(".emp-chip span")].map((s) => s.textContent.trim());

      if (allEmployees.length === 0) {
        empList.innerHTML = '<p class="emp-no-employees">Aucun employé dans votre compte.</p>';
      } else {
        empList.innerHTML = "";
        allEmployees.forEach((emp) => {
          const empName = `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
          const isSelected = currentEmps.includes(empName);
          const item = document.createElement("div");
          item.className = "emp-select-item" + (isSelected ? " selected" : "");
          item.dataset.id = emp._id;
          item.innerHTML = `<img src="${emp.profilePicture}" alt="${empName}"><span>${empName}</span><div class="check-dot"></div>`;
          item.addEventListener("click", () => item.classList.toggle("selected"));
          empList.appendChild(item);
        });
      }

      openModal(empModal, empModalOverlay);
    }
  });

  // ── Activer / Désactiver TOUS ─────────────────────────────────────────────
  async function bulkToggle(active) {
    try {
      const res = await fetch("/api/services/bulk-toggle", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      const data = await res.json();
      if (data.success) location.reload();
    } catch (e) { alert("Erreur réseau."); }
  }

  document.getElementById("activateAllBtn")?.addEventListener("click", () => bulkToggle(true));
  document.getElementById("deactivateAllBtn")?.addEventListener("click", () => bulkToggle(false));

  // ── Toggle actif/inactif ──────────────────────────────────────────────────
  servicesList.addEventListener("change", async (e) => {
    const toggle = e.target.closest(".toggle-active");
    if (!toggle) return;
    const id = toggle.dataset.id;
    const card = toggle.closest(".service-card");
    try {
      const res = await fetch(`/api/services/${id}/toggle`, { method: "PATCH" });
      const data = await res.json();
      if (data.success) {
        card.classList.toggle("service-card--inactive", !data.active);
      } else {
        toggle.checked = !toggle.checked;
      }
    } catch (e) {
      toggle.checked = !toggle.checked;
    }
  });

  // ── Modal employés : fermer ───────────────────────────────────────────────
  [closeEmpModal, cancelEmpModal, empModalOverlay].forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target !== el) return;
      closeModal(empModal, empModalOverlay);
      currentEmpServiceId = null;
    });
  });

  // ── Sauvegarder les employés ──────────────────────────────────────────────
  saveEmpBtn.addEventListener("click", async () => {
    if (!currentEmpServiceId) return;
    const selected = [...empList.querySelectorAll(".emp-select-item.selected")].map((el) => el.dataset.id);
    try {
      const res = await fetch(`/api/services/${currentEmpServiceId}/employees`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employees: selected }),
      });
      const data = await res.json();
      if (data.success) {
        location.reload();
      } else {
        alert(data.error || "Erreur.");
      }
    } catch (e) {
      alert("Erreur réseau.");
    }
  });
});
