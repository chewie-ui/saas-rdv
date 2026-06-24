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
  const serviceModalDurationRangeEnabled = document.getElementById("serviceModalDurationRangeEnabled");
  const svcDurationMaxRow    = document.getElementById("svcDurationMaxRow");
  const serviceModalDurationMax = document.getElementById("serviceModalDurationMax");
  const serviceModalCategory = document.getElementById("serviceModalCategory");
  const serviceModalColor  = document.getElementById("serviceModalColor");
  const svcColorPicker     = document.getElementById("svcColorPicker");
  const serviceModalFeeEnabled = document.getElementById("serviceModalFeeEnabled");
  const svcFeeFields       = document.getElementById("svcFeeFields");
  const svcFeeTypeOptions  = document.getElementById("svcFeeTypeOptions");
  const serviceModalFeeValue = document.getElementById("serviceModalFeeValue");
  const newCategorySection = document.getElementById("newCategorySection");
  const newCategoryName    = document.getElementById("newCategoryName");
  const newCategoryIcon    = document.getElementById("newCategoryIconInput");
  const catIconPicker      = document.getElementById("catIconPicker");
  const servicesList       = document.getElementById("servicesList");
  const svcCounter         = document.getElementById("svcCounter");

  const bqEnabled          = document.getElementById("bqEnabled");
  const bqRow              = document.getElementById("bqRow");
  const bqQuestionInput    = document.getElementById("bqQuestionInput");
  const bqNewLabelInput    = document.getElementById("bqNewLabelInput");
  const bqExistingLabelInput = document.getElementById("bqExistingLabelInput");
  const svcAnswerVisibilityField = document.getElementById("svcAnswerVisibilityField");
  const svcAnswerOptionsEl       = document.getElementById("svcAnswerOptions");

  const MAX_SERVICES = window.__maxServices || 0;
  let currentCount   = window.__svcCount   || 0;
  let BOOKING_QUESTION = window.__bookingQuestion || { enabled: false, question: "", newLabel: "", existingLabel: "" };
  let selectedAnswerVisibility = "all"; // état du modal en cours (création/édition)

  // ── Category icons ─────────────────────────────────────────────────────────
  const CAT_ICONS = [
    { id: "✂️",  label: "Ciseaux"   }, { id: "💅",  label: "Ongles"    },
    { id: "🧖",  label: "Visage"    }, { id: "🌿",  label: "Nature"    },
    { id: "💪",  label: "Fitness"   }, { id: "👁️",  label: "Regard"    },
    { id: "🌸",  label: "Floral"    }, { id: "⚡",  label: "Express"   },
    { id: "💎",  label: "Luxe"      }, { id: "❤️",  label: "Bien-être" },
    { id: "🎨",  label: "Beauté"    }, { id: "🔥",  label: "Intense"   },
    { id: "☀️",  label: "Solaire"   }, { id: "💆",  label: "Massage"   },
    { id: "🧴",  label: "Corps"     }, { id: "⭐",  label: "Premium"   },
  ];

  // ── Couleur du service ────────────────────────────────────────────────────
  // Palette de base + génération à l'infini (angle d'or en HSL) si plus de
  // services que de couleurs de base — DOIT rester cohérent avec
  // utils/serviceColors.js côté serveur (même algorithme).
  const SERVICE_COLOR_PALETTE = [
    "#1e7a4e", "#2563eb", "#7c3aed", "#db2777", "#ea580c",
    "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#0d9488",
  ];

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = (n) => Math.round(255 * f(n)).toString(16).padStart(2, "0");
    return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
  }

  function colorAt(index) {
    if (index < SERVICE_COLOR_PALETTE.length) return SERVICE_COLOR_PALETTE[index];
    const hue = ((index - SERVICE_COLOR_PALETTE.length) * 137.508) % 360;
    return hslToHex(hue, 65, 42);
  }

  // id du service en cours d'édition (null en création) — ses propres couleurs
  // ne comptent pas comme "déjà prises" pour lui-même.
  let _editingServiceId = null;

  function getTakenColors() {
    const all = window.__serviceColors || [];
    return all
      .filter((s) => s.color && s.id !== _editingServiceId)
      .map((s) => s.color.toLowerCase());
  }

  function nextAvailableColor() {
    const taken = new Set(getTakenColors());
    for (let i = 0; i < 1000; i++) {
      const c = colorAt(i);
      if (!taken.has(c.toLowerCase())) return c;
    }
    return colorAt(Math.floor(Math.random() * 100000));
  }

  function buildColorPicker(selected) {
    if (!svcColorPicker) return;
    const taken = new Set(getTakenColors());
    const total = window.__svcCount || 0;
    // Toujours au moins la palette de base, + assez de couleurs générées pour
    // que chaque service (même au-delà de 10) ait une option unique visible.
    const swatchCount = Math.max(SERVICE_COLOR_PALETTE.length, total + 4);
    const swatches = [];
    for (let i = 0; i < swatchCount; i++) swatches.push(colorAt(i));

    // Couleur personnalisée (choisie via le "+") absente de la palette
    // générée — on l'ajoute pour qu'elle reste visible/sélectionnée.
    const selectedLower = (selected || "").toLowerCase();
    if (selectedLower && !swatches.some((c) => c.toLowerCase() === selectedLower)) {
      swatches.push(selected);
    }

    const swatchesHtml = swatches.map((c) => {
      const isTaken = taken.has(c.toLowerCase()) && c.toLowerCase() !== selectedLower;
      const isActive = c.toLowerCase() === selectedLower;
      const cls = "svc-color-swatch" + (isTaken ? " is-taken" : "") + (isActive ? " is-active" : "");
      return `<button type="button" class="${cls}" data-color="${c}" style="background:${c}" title="${isTaken ? "Déjà utilisée par un autre service" : ""}" ${isTaken ? "disabled" : ""}></button>`;
    }).join("");

    svcColorPicker.innerHTML = swatchesHtml +
      '<button type="button" class="svc-color-swatch--add" id="svcColorAddBtn" title="Couleur personnalisée">+</button>' +
      '<input type="color" id="svcColorCustomInput" style="position:absolute;width:0;height:0;opacity:0;pointer-events:none;">';
  }

  // Un seul écouteur délégué, posé une fois pour toutes (buildColorPicker
  // réécrit le HTML à chaque appel — y attacher un listener à chaque fois
  // les empilerait indéfiniment).
  if (svcColorPicker) {
    svcColorPicker.addEventListener("click", (e) => {
      if (e.target.closest("#svcColorAddBtn")) {
        const input = svcColorPicker.querySelector("#svcColorCustomInput");
        if (input) {
          input.value = getServiceColor();
          input.click();
        }
        return;
      }
      const btn = e.target.closest(".svc-color-swatch");
      if (!btn || btn.disabled) return;
      setServiceColor(btn.dataset.color);
    });

    // Couleur choisie via le sélecteur natif de l'OS (bouton "+") — on
    // vérifie qu'elle n'est pas déjà prise par un autre service avant de
    // l'accepter, puis on réaffiche la palette pour l'y inclure.
    svcColorPicker.addEventListener("change", (e) => {
      if (e.target.id !== "svcColorCustomInput") return;
      const color = e.target.value;
      const taken = new Set(getTakenColors());
      if (taken.has(color.toLowerCase())) {
        alert("Cette couleur est déjà utilisée par un autre service — choisissez-en une autre.");
        return;
      }
      setServiceColor(color);
      buildColorPicker(color);
    });
  }

  function setServiceColor(color) {
    if (serviceModalColor) serviceModalColor.value = color;
    if (svcColorPicker) {
      svcColorPicker.querySelectorAll(".svc-color-swatch").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.color === color);
      });
    }
  }

  function getServiceColor() {
    return (serviceModalColor && serviceModalColor.value) || SERVICE_COLOR_PALETTE[0];
  }

  function buildIconPicker() {
    if (!catIconPicker) return;
    catIconPicker.innerHTML = CAT_ICONS.map(ic =>
      `<button type="button" class="cat-icon-btn" data-icon="${ic.id}" title="${ic.label}">${ic.id}</button>`
    ).join("");
    catIconPicker.addEventListener("click", (e) => {
      const btn = e.target.closest(".cat-icon-btn");
      if (!btn) return;
      catIconPicker.querySelectorAll(".cat-icon-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      if (newCategoryIcon) newCategoryIcon.value = btn.dataset.icon;
    });
  }
  buildIconPicker();

  function buildCategorySelect(currentValue) {
    if (!serviceModalCategory) return;
    const cats = window.__categories || [];
    const noLabel     = window.__t_no_category     || "Aucune catégorie";
    const createLabel = window.__t_create_category || "+ Créer une catégorie";
    serviceModalCategory.innerHTML =
      `<option value="">${noLabel}</option>` +
      cats.map(c => {
        const label = (c.icon ? c.icon + " " : "") + c.name;
        const sel   = currentValue === c.name ? "selected" : "";
        return `<option value="${c.name.replace(/"/g,"&quot;")}" ${sel}>${label}</option>`;
      }).join("") +
      `<option value="__create__">${createLabel}</option>`;
    if (currentValue && !cats.some(c => c.name === currentValue)) {
      // Value exists on service but not in categories list — add it as plain option
      serviceModalCategory.insertAdjacentHTML("beforeend",
        `<option value="${currentValue.replace(/"/g,"&quot;")}" selected>${currentValue}</option>`);
    }
  }

  function showNewCategorySection(show) {
    if (!newCategorySection) return;
    newCategorySection.style.display = show ? "" : "none";
    if (!show) {
      if (newCategoryName) newCategoryName.value = "";
      if (newCategoryIcon) newCategoryIcon.value = "";
      if (catIconPicker) catIconPicker.querySelectorAll(".cat-icon-btn").forEach(b => b.classList.remove("selected"));
    }
  }

  if (serviceModalCategory) {
    serviceModalCategory.addEventListener("change", () => {
      showNewCategorySection(serviceModalCategory.value === "__create__");
    });
  }

  // ── Frais d'annulation/no-show personnalisés ─────────────────────────────
  function setFeeType(type) {
    if (!svcFeeTypeOptions) return;
    svcFeeTypeOptions.querySelectorAll(".svc-type-option").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.feeType === type);
    });
  }

  function getFeeType() {
    if (!svcFeeTypeOptions) return "percent";
    const active = svcFeeTypeOptions.querySelector(".svc-type-option.is-active");
    return active ? active.dataset.feeType : "percent";
  }

  function setFeeEnabled(enabled) {
    if (serviceModalFeeEnabled) serviceModalFeeEnabled.checked = enabled;
    if (svcFeeFields) svcFeeFields.style.display = enabled ? "" : "none";
  }

  if (svcFeeTypeOptions) {
    svcFeeTypeOptions.addEventListener("click", (e) => {
      const btn = e.target.closest(".svc-type-option");
      if (!btn) return;
      setFeeType(btn.dataset.feeType);
    });
  }

  if (serviceModalFeeEnabled) {
    serviceModalFeeEnabled.addEventListener("change", () => {
      if (svcFeeFields) svcFeeFields.style.display = serviceModalFeeEnabled.checked ? "" : "none";
    });
  }

  // ── Durée approximative ("30-40 min") ────────────────────────────────────
  function setDurationRange(enabled, maxValue) {
    if (serviceModalDurationRangeEnabled) serviceModalDurationRangeEnabled.checked = enabled;
    if (svcDurationMaxRow) svcDurationMaxRow.style.display = enabled ? "" : "none";
    if (serviceModalDurationMax) serviceModalDurationMax.value = maxValue || "";
  }

  if (serviceModalDurationRangeEnabled) {
    serviceModalDurationRangeEnabled.addEventListener("change", () => {
      if (svcDurationMaxRow) svcDurationMaxRow.style.display = serviceModalDurationRangeEnabled.checked ? "" : "none";
      if (!serviceModalDurationRangeEnabled.checked && serviceModalDurationMax) serviceModalDurationMax.value = "";
    });
  }

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

  function flashBanner() {
    const banner = document.getElementById("serviceLimitBanner");
    if (!banner) return;
    banner.style.display = "";
    banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const counter = document.getElementById("svcCounter");
    if (counter) {
      counter.classList.add("services-counter--full");
      counter.style.transition = "box-shadow 0.15s";
      counter.style.boxShadow = "0 0 0 3px rgba(239,68,68,.35)";
      setTimeout(() => { counter.style.boxShadow = ""; }, 800);
    }
    banner.style.transition = "box-shadow 0.15s";
    banner.style.boxShadow = "0 0 0 3px rgba(239,68,68,.25)";
    setTimeout(() => { banner.style.boxShadow = ""; }, 800);
  }

  function updateAddBtn() {
    if (!addServiceBtn) return;
    const atLimit = MAX_SERVICES > 0 && currentCount >= MAX_SERVICES;
    // Keep button clickable; clicking at limit flashes the upgrade banner
    addServiceBtn.disabled = (MAX_SERVICES === 0);
    addServiceBtn.dataset.atLimit = (atLimit && MAX_SERVICES > 0) ? "1" : "0";
    const banner = document.getElementById("serviceLimitBanner");
    if (banner) banner.style.display = atLimit ? "" : "none";
  }

  updateCounter();
  updateAddBtn();

  // ── Question préalable au choix du service ─────────────────────────────────
  async function saveBookingQuestion(payload) {
    try {
      await fetch("/api/services/booking-question", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (_) {}
  }

  if (bqEnabled) {
    bqEnabled.addEventListener("change", async () => {
      BOOKING_QUESTION.enabled = bqEnabled.checked;
      if (bqRow) bqRow.style.display = BOOKING_QUESTION.enabled ? "" : "none";
      updateSvcAnswerVisibilityVisibility();
      await saveBookingQuestion({ enabled: BOOKING_QUESTION.enabled });
    });
  }

  if (bqQuestionInput) {
    bqQuestionInput.addEventListener("change", async () => {
      BOOKING_QUESTION.question = bqQuestionInput.value.trim();
      await saveBookingQuestion({ question: BOOKING_QUESTION.question });
    });
  }

  if (bqNewLabelInput) {
    bqNewLabelInput.addEventListener("change", async () => {
      BOOKING_QUESTION.newLabel = bqNewLabelInput.value.trim();
      updateAnswerOptLabels();
      await saveBookingQuestion({ newLabel: BOOKING_QUESTION.newLabel });
    });
  }

  if (bqExistingLabelInput) {
    bqExistingLabelInput.addEventListener("change", async () => {
      BOOKING_QUESTION.existingLabel = bqExistingLabelInput.value.trim();
      updateAnswerOptLabels();
      await saveBookingQuestion({ existingLabel: BOOKING_QUESTION.existingLabel });
    });
  }

  // ── Sélecteur "afficher pour" dans le modal de service (3 choix fixes) ──────
  function updateAnswerOptLabels() {
    if (!svcAnswerOptionsEl) return;
    const newBtn = svcAnswerOptionsEl.querySelector('[data-value="new"]');
    const exBtn  = svcAnswerOptionsEl.querySelector('[data-value="existing"]');
    if (newBtn) newBtn.textContent = BOOKING_QUESTION.newLabel || "Nouveau";
    if (exBtn)  exBtn.textContent  = BOOKING_QUESTION.existingLabel || "Déjà venu";
  }

  function updateSvcAnswerVisibilityVisibility() {
    if (!svcAnswerVisibilityField) return;
    svcAnswerVisibilityField.style.display = BOOKING_QUESTION.enabled ? "" : "none";
  }
  updateSvcAnswerVisibilityVisibility();

  function setAnswerVisibility(value) {
    selectedAnswerVisibility = value;
    if (!svcAnswerOptionsEl) return;
    svcAnswerOptionsEl.querySelectorAll(".svc-answer-opt").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.value === value);
    });
  }

  if (svcAnswerOptionsEl) {
    svcAnswerOptionsEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".svc-answer-opt");
      if (!btn) return;
      setAnswerVisibility(btn.dataset.value);
    });
  }

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
    setDurationRange(false, "");
    setFeeEnabled(false);
    setFeeType("percent");
    if (serviceModalFeeValue) serviceModalFeeValue.value = "";
    _editingServiceId = null;
    const defaultColor = nextAvailableColor();
    setServiceColor(defaultColor);
    buildColorPicker(defaultColor);
    buildCategorySelect("");
    showNewCategorySection(false);
    setAnswerVisibility("all");
    serviceModalTitle.textContent = "Nouveau service";
    saveServiceBtn.querySelector("span").textContent = "Enregistrer";
  }

  // ── Ouvrir modal création ─────────────────────────────────────────────────
  function openNewServiceModal() {
    resetServiceModal();
    openModal(serviceModal, serviceModalOverlay);
    serviceModalName.focus();
  }

  addServiceBtn.addEventListener("click", () => {
    if (addServiceBtn.dataset.atLimit === "1") { flashBanner(); return; }
    openNewServiceModal();
  });
  if (addServiceCardBtn) {
    addServiceCardBtn.addEventListener("click", () => {
      if (addServiceCardBtn.classList.contains("svc-card--locked-invite")) {
        // At limit or plan=0: redirect to subscription page
        window.location.href = "/subscription";
        return;
      }
      openNewServiceModal();
    });
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

    const id = serviceModalId.value;

    // ── Resolve category ────────────────────────────────────────────────────
    let categoryValue = serviceModalCategory ? serviceModalCategory.value : "";

    if (categoryValue === "__create__") {
      const newName = newCategoryName ? newCategoryName.value.trim() : "";
      if (!newName) { if (newCategoryName) newCategoryName.focus(); return; }
      const icon = newCategoryIcon ? newCategoryIcon.value : "";

      // Add to local list and persist
      window.__categories = window.__categories || [];
      if (!window.__categories.some(c => c.name.toLowerCase() === newName.toLowerCase())) {
        window.__categories.push({ name: newName, icon });
        try {
          await fetch("/account/categories", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ categories: window.__categories }),
          });
        } catch (_) {}
      }
      categoryValue = newName;
    }

    const body = {
      name,
      description: serviceModalDesc.value.trim(),
      price: serviceModalPrice.value,
      duration: serviceModalDuration.value || 30,
      durationMax: (serviceModalDurationRangeEnabled && serviceModalDurationRangeEnabled.checked && serviceModalDurationMax)
        ? serviceModalDurationMax.value
        : "",
      category: categoryValue,
      color: getServiceColor(),
      cancellationFee: {
        enabled: serviceModalFeeEnabled ? serviceModalFeeEnabled.checked : false,
        type: getFeeType(),
        value: serviceModalFeeValue ? serviceModalFeeValue.value : "",
      },
      answerVisibility: selectedAnswerVisibility,
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
        alert(data.message || data.error || "Erreur lors de l'enregistrement.");
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
      serviceModalDuration.value = durBadge ? parseInt(durBadge.textContent, 10) : 30;
      setDurationRange(!!card.dataset.durationMax, card.dataset.durationMax || "");
      setFeeEnabled(card.dataset.feeEnabled === "1");
      setFeeType(card.dataset.feeType === "amount" ? "amount" : "percent");
      if (serviceModalFeeValue) serviceModalFeeValue.value = card.dataset.feeValue || "";
      _editingServiceId = id;
      const ownColor = card.dataset.color || nextAvailableColor();
      setServiceColor(ownColor);
      buildColorPicker(ownColor);
      buildCategorySelect(card.dataset.category || "");
      showNewCategorySection(false);
      setAnswerVisibility(card.dataset.answerVisibility || "all");
      serviceModalTitle.textContent = "Modifier le service";
      openModal(serviceModal, serviceModalOverlay);
      serviceModalName.focus();
    }

    if (delBtn) {
      if (!(await window.confirmModal("Supprimer ce service ?", "Cette action est irréversible."))) return;
      const id = delBtn.dataset.id;
      try {
        const res = await fetch(`/api/services/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (data.success) {
          delBtn.closest(".service-card").remove();
          currentCount = Math.max(0, currentCount - 1);
          window.__svcCount = currentCount;
          window.__serviceColors = (window.__serviceColors || []).filter((s) => s.id !== id);
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

  // ── Modifier / Supprimer une catégorie ────────────────────────────────────
  const editCatModal        = document.getElementById("editCatModal");
  const editCatModalOverlay = document.getElementById("editCatModalOverlay");
  const closeEditCatModal   = document.getElementById("closeEditCatModal");
  const cancelEditCatModal  = document.getElementById("cancelEditCatModal");
  const saveEditCatBtn      = document.getElementById("saveEditCatBtn");
  const editCatOldName      = document.getElementById("editCatOldName");
  const editCatName         = document.getElementById("editCatName");
  const editCatIconInput    = document.getElementById("editCatIconInput");
  const editCatIconPicker   = document.getElementById("editCatIconPicker");

  // Build icon picker for edit modal
  if (editCatIconPicker) {
    editCatIconPicker.innerHTML = CAT_ICONS.map(ic =>
      `<button type="button" class="cat-icon-btn" data-icon="${ic.id}" title="${ic.label}">${ic.id}</button>`
    ).join("");
    editCatIconPicker.addEventListener("click", (e) => {
      const btn = e.target.closest(".cat-icon-btn");
      if (!btn) return;
      editCatIconPicker.querySelectorAll(".cat-icon-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      if (editCatIconInput) editCatIconInput.value = btn.dataset.icon;
    });
  }

  function openEditCatModal(name, icon) {
    if (!editCatModal) return;
    editCatOldName.value = name;
    editCatName.value    = name;
    editCatIconInput.value = icon || "";
    // Highlight current icon
    if (editCatIconPicker) {
      editCatIconPicker.querySelectorAll(".cat-icon-btn").forEach(b => {
        b.classList.toggle("selected", b.dataset.icon === icon);
      });
    }
    editCatModalOverlay.classList.add("show");
    editCatModal.classList.add("show");
    editCatName.focus();
  }

  function closeEditCatModalFn() {
    editCatModalOverlay.classList.remove("show");
    editCatModal.classList.remove("show");
  }

  [closeEditCatModal, cancelEditCatModal, editCatModalOverlay].forEach(el => {
    el?.addEventListener("click", (e) => {
      if (e.target !== el) return;
      closeEditCatModalFn();
    });
  });

  if (saveEditCatBtn) {
    saveEditCatBtn.addEventListener("click", async () => {
      const oldName = editCatOldName.value;
      const newName = editCatName.value.trim();
      const icon    = editCatIconInput.value || "";
      if (!newName) { editCatName.focus(); return; }

      try {
        const res  = await fetch("/account/categories/rename", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldName, newName, icon }),
        });
        const data = await res.json();
        if (!data.success) { alert(data.error || "Erreur."); return; }

        // Update local state
        window.__categories = data.categories;

        // Update DOM: the li item
        const catOrderList = document.getElementById("catOrderList");
        const li = catOrderList?.querySelector(`.cat-order-item[data-name="${CSS.escape(oldName)}"]`);
        if (li) {
          li.dataset.name = newName;
          const iconEl = li.querySelector(".cat-order-item__icon");
          const nameEl = li.querySelector(".cat-order-item__name");
          if (nameEl) nameEl.textContent = newName;
          if (icon) {
            if (iconEl) iconEl.textContent = icon;
            else {
              const grip = li.querySelector(".cat-order-item__grip");
              const span = document.createElement("span");
              span.className = "cat-order-item__icon";
              span.textContent = icon;
              grip.after(span);
            }
          } else if (iconEl) {
            iconEl.remove();
          }
        }

        // Update service cards that used this category
        document.querySelectorAll(`.service-card[data-category="${CSS.escape(oldName)}"]`).forEach(card => {
          card.dataset.category = newName;
          const badge = card.querySelector(".badge--category");
          if (badge) {
            const catObj = data.categories.find(c => c.name === newName);
            badge.innerHTML = (catObj?.icon ? `<span class="badge-cat-icon">${catObj.icon} </span>` : "") + newName;
          }
        });

        closeEditCatModalFn();

        // Flash status
        const catSaveStatus = document.getElementById("catSaveStatus");
        if (catSaveStatus) {
          catSaveStatus.textContent = "✓ Catégorie modifiée";
          catSaveStatus.style.color = "#22c55e";
          setTimeout(() => { catSaveStatus.textContent = ""; }, 2500);
        }
      } catch (err) {
        alert("Erreur réseau.");
      }
    });
  }

  // ── Panneau : Gestion catégories (ordre + style) ─────────────────────────
  const catOrderList      = document.getElementById("catOrderList");
  const saveCatSettingsBtn = document.getElementById("saveCatSettingsBtn");
  const catSaveStatus     = document.getElementById("catSaveStatus");

  // Mark active style on load
  let currentStyle = window.__bookingCategoryStyle || "pills";
  function updateStyleBtns() {
    document.querySelectorAll(".cat-style-opt").forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.style === currentStyle);
    });
  }
  updateStyleBtns();

  document.querySelectorAll(".cat-style-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      currentStyle = btn.dataset.style;
      updateStyleBtns();
    });
  });

  // Up/Down reorder + Edit + Delete buttons
  if (catOrderList) {
    catOrderList.addEventListener("click", async (e) => {
      const btn = e.target.closest(".cat-order-btn");
      if (!btn) return;
      const item = btn.closest(".cat-order-item");
      if (!item) return;
      const name = item.dataset.name;

      // Edit
      if (btn.classList.contains("cat-edit-btn")) {
        const cats = window.__categories || [];
        const catObj = cats.find(c => c.name === name) || { name, icon: "" };
        openEditCatModal(catObj.name, catObj.icon || "");
        return;
      }

      // Delete
      if (btn.classList.contains("cat-delete-btn")) {
        const count = document.querySelectorAll(`.service-card[data-category="${CSS.escape(name)}"]`).length;
        const msg = count > 0
          ? `Supprimer la catégorie "${name}" ?\n${count} service(s) l'utilisant seront sans catégorie.`
          : `Supprimer la catégorie "${name}" ?`;
        if (!confirm(msg)) return;
        try {
          const res  = await fetch(`/account/categories/${encodeURIComponent(name)}`, { method: "DELETE" });
          const data = await res.json();
          if (!data.success) { alert("Erreur lors de la suppression."); return; }

          // Update local state
          window.__categories = data.categories;

          // Remove from DOM
          item.remove();

          // Hide panel if no categories left
          const catManagePanel = document.getElementById("catManagePanel");
          if (catManagePanel && !catOrderList.querySelector(".cat-order-item")) {
            catManagePanel.style.display = "none";
          }

          // Clear category from service cards
          document.querySelectorAll(`.service-card[data-category="${CSS.escape(name)}"]`).forEach(card => {
            card.dataset.category = "";
            const badge = card.querySelector(".badge--category");
            if (badge) badge.remove();
          });

          const catSaveStatus = document.getElementById("catSaveStatus");
          if (catSaveStatus) {
            catSaveStatus.textContent = "✓ Catégorie supprimée";
            catSaveStatus.style.color = "#22c55e";
            setTimeout(() => { catSaveStatus.textContent = ""; }, 2500);
          }
        } catch (err) {
          alert("Erreur réseau.");
        }
        return;
      }

      // Reorder
      const dir = btn.dataset.dir;
      if (dir === "up") {
        const prev = item.previousElementSibling;
        if (prev) catOrderList.insertBefore(item, prev);
      } else {
        const next = item.nextElementSibling;
        if (next) catOrderList.insertBefore(next, item);
      }
    });
  }

  if (saveCatSettingsBtn) {
    saveCatSettingsBtn.addEventListener("click", async () => {
      // Collect ordered category names → map back to full category objects
      const cats = window.__categories || [];
      const orderedNames = [...catOrderList.querySelectorAll(".cat-order-item")].map(li => li.dataset.name);
      const orderedCats  = orderedNames
        .map(name => cats.find(c => c.name === name))
        .filter(Boolean);
      // Append any categories not in the list (shouldn't happen)
      cats.forEach(c => { if (!orderedNames.includes(c.name)) orderedCats.push(c); });

      try {
        // 1. Save category order
        await fetch("/account/categories", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categories: orderedCats }),
        });
        // 2. Save style
        await fetch("/account/booking-category-style", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ style: currentStyle }),
        });

        // Update local state
        window.__categories = orderedCats;
        window.__bookingCategoryStyle = currentStyle;

        if (catSaveStatus) {
          catSaveStatus.textContent = "✓ Enregistré";
          catSaveStatus.style.color = "#22c55e";
          setTimeout(() => { catSaveStatus.textContent = ""; }, 2500);
        }
      } catch (_) {
        if (catSaveStatus) { catSaveStatus.textContent = "Erreur"; catSaveStatus.style.color = "#ef4444"; }
      }
    });
  }

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
