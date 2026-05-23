document.addEventListener("DOMContentLoaded", () => {
  const addEmpBtn      = document.getElementById("addEmpBtn");
  const empModal       = document.getElementById("empModal");
  const empModalOverlay = document.getElementById("empModalOverlay");
  const closeEmpModal  = document.getElementById("closeEmpModal");
  const cancelEmpModal = document.getElementById("cancelEmpModal");
  const saveEmpBtn     = document.getElementById("saveEmpBtn");
  const empModalTitle  = document.getElementById("empModalTitle");
  const empModalId     = document.getElementById("empModalId");
  const empModalFirstName = document.getElementById("empModalFirstName");
  const empModalLastName  = document.getElementById("empModalLastName");
  const empModalAge    = document.getElementById("empModalAge");
  const empModalDesc   = document.getElementById("empModalDesc");
  const empModalPhotoBtn    = document.getElementById("empModalPhotoBtn");
  const empModalPhotoInput  = document.getElementById("empModalPhotoInput");
  const empModalPhotoPreview = document.getElementById("empModalPhotoPreview");
  const employeesList  = document.getElementById("employeesList");
  const empCounter     = document.getElementById("empCounter");

  const MAX_EMPLOYEES = window.__maxEmployees || 0;
  let currentCount    = window.__empCount || 0;

  let pendingPhotoFile = null;

  function updateCounter() {
    if (!empCounter) return;
    empCounter.textContent = `${currentCount} / ${MAX_EMPLOYEES}`;
    empCounter.classList.toggle("employees-counter--full", currentCount >= MAX_EMPLOYEES);
  }

  function updateAddBtn() {
    if (!addEmpBtn) return;
    const atLimit = MAX_EMPLOYEES > 0 && currentCount >= MAX_EMPLOYEES;
    addEmpBtn.classList.toggle("emp-card--disabled", atLimit);
    addEmpBtn.title = atLimit ? `Limite de ${MAX_EMPLOYEES} employé(s) atteinte` : "";
    const banner = document.getElementById("employeeLimitBanner");
    if (banner) banner.style.display = atLimit ? "" : "none";
  }

  updateCounter();
  updateAddBtn();

  function openModal()  { empModalOverlay.classList.add("show"); empModal.classList.add("show"); }
  function closeModal() { empModalOverlay.classList.remove("show"); empModal.classList.remove("show"); }

  const msgNew  = window.__empModalNew  || "Nouvel employé";
  const msgEdit = window.__empModalEdit || "Modifier l'employé";
  const msgDel  = window.__empDeleteConfirm || "Supprimer cet employé ? Cette action est irréversible.";

  function resetModal() {
    empModalId.value         = "";
    empModalFirstName.value  = "";
    empModalLastName.value   = "";
    empModalAge.value        = "";
    empModalDesc.value       = "";
    empModalPhotoPreview.src = "/images/no-user.webp";
    empModalTitle.textContent = msgNew;
    pendingPhotoFile = null;
  }

  // Photo preview in modal
  empModalPhotoBtn.addEventListener("click", () => empModalPhotoInput.click());
  empModalPhotoInput.addEventListener("change", () => {
    const file = empModalPhotoInput.files[0];
    if (!file) return;
    pendingPhotoFile = file;
    empModalPhotoPreview.src = URL.createObjectURL(file);
  });

  // Open create modal
  addEmpBtn.addEventListener("click", () => {
    if (MAX_EMPLOYEES > 0 && currentCount >= MAX_EMPLOYEES) return;
    resetModal();
    openModal();
    empModalFirstName.focus();
  });

  [closeEmpModal, cancelEmpModal].forEach((el) => el.addEventListener("click", closeModal));
  empModalOverlay.addEventListener("click", (e) => { if (e.target === empModalOverlay) closeModal(); });

  // Save
  saveEmpBtn.addEventListener("click", async () => {
    const firstName = empModalFirstName.value.trim();
    const lastName  = empModalLastName.value.trim();
    if (!firstName) { empModalFirstName.focus(); return; }
    if (!lastName)  { empModalLastName.focus();  return; }

    const id = empModalId.value;
    const formData = new FormData();
    formData.append("firstName",   firstName);
    formData.append("lastName",    lastName);
    formData.append("age",         empModalAge.value);
    formData.append("description", empModalDesc.value.trim());
    if (pendingPhotoFile) formData.append("profilePicture", pendingPhotoFile);

    const url    = id ? `/api/employees/${id}` : "/api/employees";
    const method = id ? "PATCH" : "POST";

    try {
      saveEmpBtn.disabled = true;
      const res  = await fetch(url, { method, body: formData });
      const data = await res.json();
      if (data.success) {
        if (!id) { currentCount++; }
        location.reload();
      } else {
        const msg = data.error === "plan_limit" ? data.message : (data.error || "Erreur.");
        alert(msg);
        saveEmpBtn.disabled = false;
      }
    } catch (_) { alert("Erreur réseau."); saveEmpBtn.disabled = false; }
  });

  if (!employeesList) return;

  // Edit & delete
  employeesList.addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".edit-emp-btn");
    const delBtn  = e.target.closest(".delete-emp-btn");

    if (editBtn) {
      empModalId.value        = editBtn.dataset.id;
      empModalFirstName.value = editBtn.dataset.firstname || "";
      empModalLastName.value  = editBtn.dataset.lastname  || "";
      empModalAge.value       = editBtn.dataset.age       || "";
      empModalDesc.value      = editBtn.dataset.desc      || "";
      const img = editBtn.closest(".emp-card").querySelector(".emp-card__photo img");
      empModalPhotoPreview.src = img ? img.src : "/images/no-user.webp";
      pendingPhotoFile = null;
      empModalTitle.textContent = msgEdit;
      openModal();
      empModalFirstName.focus();
    }

    if (delBtn) {
      if (!confirm(msgDel)) return;
      try {
        const res  = await fetch(`/api/employees/${delBtn.dataset.id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) {
          delBtn.closest(".emp-card").remove();
          currentCount = Math.max(0, currentCount - 1);
          updateCounter();
          updateAddBtn();
        }
      } catch (_) { alert("Erreur réseau."); }
    }
  });

  // Toggle active
  employeesList.addEventListener("change", async (e) => {
    const toggle = e.target.closest(".toggle-emp-active");
    if (toggle) {
      const id   = toggle.dataset.id;
      const card = toggle.closest(".emp-card");
      try {
        const res  = await fetch(`/api/employees/${id}/toggle`, { method: "PATCH" });
        const data = await res.json();
        if (data.success) card.classList.toggle("emp-card--inactive", !data.active);
        else toggle.checked = !toggle.checked;
      } catch (_) { toggle.checked = !toggle.checked; }
      return;
    }

    // Quick photo upload from card
    const photoInput = e.target.closest(".emp-photo-input");
    if (photoInput) {
      const file = photoInput.files[0];
      if (!file) return;
      const id = photoInput.dataset.id;
      const fd = new FormData();
      fd.append("profilePicture", file);
      try {
        const res  = await fetch(`/api/employees/${id}`, { method: "PATCH", body: fd });
        const data = await res.json();
        if (data.success) {
          const img = photoInput.closest(".emp-card").querySelector(".emp-card__photo img");
          if (img) img.src = URL.createObjectURL(file);
        }
      } catch (_) { alert("Erreur upload."); }
    }
  });

  // ── Activer / Désactiver TOUS les employés ────────────────────────────────
  async function bulkToggleEmployees(active) {
    try {
      const res = await fetch("/api/employees/bulk-toggle", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      const data = await res.json();
      if (data.success) location.reload();
    } catch (e) { alert("Erreur réseau."); }
  }

  document.getElementById("activateAllEmpBtn")?.addEventListener("click", () => bulkToggleEmployees(true));
  document.getElementById("deactivateAllEmpBtn")?.addEventListener("click", () => bulkToggleEmployees(false));
});
