// Forms Admin — Pre-booking form builder

const T = window.__tForms || {};
const MAX_QUESTIONS = window.__maxQuestions ?? 0; // 0 = plan doesn't allow forms
let formData = window.__formData || { active: false, questions: [] };

// Ensure questions array exists
if (!formData.questions) formData.questions = [];

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const activeToggle     = document.getElementById("formActiveToggle");
const formStatusBadge  = document.getElementById("formStatusBadge");
const formStatusLabel  = document.getElementById("formStatusLabel");
const saveBtn          = document.getElementById("saveFormBtn");
const questionsList    = document.getElementById("questionsList");
const emptyState       = document.getElementById("emptyState");
const questionsCount   = document.getElementById("questionsCount");
const addQuestionBtn   = document.getElementById("addQuestionBtn");
const previewQuestions = document.getElementById("previewQuestions");

// Modal
const overlay          = document.getElementById("modalOverlay");
const modalTitle       = document.getElementById("modalTitle");
const closeModalBtn    = document.getElementById("closeModalBtn");
const cancelModalBtn   = document.getElementById("cancelModalBtn");
const confirmModalBtn  = document.getElementById("confirmModalBtn");
const labelInput       = document.getElementById("questionLabelInput");
const typeBtns         = document.querySelectorAll(".forms-type-btn");
const optionsSection   = document.getElementById("optionsSection");
const optionsList      = document.getElementById("optionsList");
const addOptionBtn     = document.getElementById("addOptionBtn");
const requiredCheck    = document.getElementById("questionRequired");

// ─── State ────────────────────────────────────────────────────────────────────
let editingIndex = -1; // -1 = new question
let drag = null;       // active drag session
let isDirty = false;   // unsaved changes

const unsavedBar    = document.getElementById("formsUnsavedBar");
const unsavedSaveBtn = document.getElementById("unsavedSaveBtn");

function markDirty() {
  isDirty = true;
  unsavedBar.classList.add("is-visible");
}
function markClean() {
  isDirty = false;
  unsavedBar.classList.remove("is-visible");
}

// Warn before leaving page with unsaved changes
window.addEventListener("beforeunload", (e) => {
  if (!isDirty) return;
  e.preventDefault();
  e.returnValue = "";
});

// Intercept all sidebar/nav links
document.addEventListener("click", (e) => {
  if (!isDirty) return;
  const link = e.target.closest("a[href]");
  if (!link) return;
  const href = link.getAttribute("href");
  // Ignore anchors, external links, and javascript:
  if (!href || href.startsWith("#") || href.startsWith("javascript") || link.target === "_blank") return;
  e.preventDefault();
  if (confirm("Vous avez des modifications non sauvegardées. Quitter sans sauvegarder ?")) {
    isDirty = false;
    window.location.href = href;
  }
});

// ─── Active toggle ────────────────────────────────────────────────────────────
function syncActiveUI(active) {
  if (active) {
    formStatusBadge.classList.add("forms-status-badge--on");
    formStatusLabel.textContent = T.active_label || "Actif";
  } else {
    formStatusBadge.classList.remove("forms-status-badge--on");
    formStatusLabel.textContent = T.inactive_label || "Inactif";
  }
}

activeToggle.addEventListener("change", () => {
  formData.active = activeToggle.checked;
  syncActiveUI(formData.active);
  markDirty();
});

syncActiveUI(formData.active);

// ─── Render question list ─────────────────────────────────────────────────────
function typeLabel(type) {
  if (type === "text")   return T.type_text   || "Texte libre";
  if (type === "choice") return T.type_choice || "Choix multiple";
  if (type === "yes_no") return T.type_yes_no  || "Oui / Non";
  return type;
}

function renderQuestions() {
  questionsList.innerHTML = "";
  const qs = formData.questions;

  emptyState.style.display = qs.length === 0 ? "" : "none";
  if (questionsCount) questionsCount.textContent = qs.length > 0 ? `${qs.length}` : "";

  qs.forEach((q, i) => {
    const card = document.createElement("div");
    card.className = "question-card";
    card.dataset.index = i;

    card.innerHTML = `
      <div class="question-card__drag" title="Drag to reorder">
        <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor">
          <path d="M360-160q-33 0-56.5-23.5T280-240q0-33 23.5-56.5T360-320q33 0 56.5 23.5T440-240q0 33-23.5 56.5T360-160Zm240 0q-33 0-56.5-23.5T520-240q0-33 23.5-56.5T600-320q33 0 56.5 23.5T680-240q0 33-23.5 56.5T600-160ZM360-400q-33 0-56.5-23.5T280-480q0-33 23.5-56.5T360-560q33 0 56.5 23.5T440-480q0 33-23.5 56.5T360-400Zm240 0q-33 0-56.5-23.5T520-480q0-33 23.5-56.5T600-560q33 0 56.5 23.5T680-480q0 33-23.5 56.5T600-400ZM360-640q-33 0-56.5-23.5T280-720q0-33 23.5-56.5T360-800q33 0 56.5 23.5T440-720q0 33-23.5 56.5T360-640Zm240 0q-33 0-56.5-23.5T520-720q0-33 23.5-56.5T600-800q33 0 56.5 23.5T680-720q0 33-23.5 56.5T600-640Z"/>
        </svg>
      </div>
      <div class="question-card__content">
        <div class="question-card__label">${escHtml(q.label)}</div>
        <div class="question-card__meta">
          <span class="question-card__type">${typeLabel(q.type)}</span>
          ${q.required ? `<span class="question-card__required">✱ ${T.required || "Obligatoire"}</span>` : ""}
        </div>
      </div>
      <div class="question-card__actions">
        <button class="edit-btn" data-index="${i}" title="${T.edit_question || 'Modifier'}">
          <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor">
            <path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/>
          </svg>
        </button>
        <button class="delete-btn" data-index="${i}" title="${T.delete_question || 'Supprimer'}">
          <svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor">
            <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/>
          </svg>
        </button>
      </div>
    `;

    // drag — only on the handle icon
    card.querySelector(".question-card__drag").addEventListener("pointerdown", (e) => {
      e.preventDefault();
      startDrag(e, i);
    });

    // edit
    card.querySelector(".edit-btn").addEventListener("click", () => openModal(i));
    // delete
    card.querySelector(".delete-btn").addEventListener("click", () => {
      formData.questions.splice(i, 1);
      renderQuestions();
      renderPreview();
      markDirty();
    });

    questionsList.appendChild(card);
  });

  renderPreview();
}

// ─── Drag & drop (pointer events — smooth ghost + animated shifts) ────────────

function startDrag(e, srcIndex) {
  const cards = [...questionsList.querySelectorAll(".question-card")];
  const srcCard = cards[srcIndex];
  const srcRect = srcCard.getBoundingClientRect();

  // Snapshot each card's Y position and height before anything moves
  const snapshots = cards.map((c) => {
    const r = c.getBoundingClientRect();
    return { top: r.top, height: r.height, mid: r.top + r.height / 2 };
  });
  const cardH   = srcRect.height;
  const GAP     = 10; // matches CSS gap: 10px on .questions-list

  // ── Ghost: floating clone that follows the pointer ──
  const ghost = srcCard.cloneNode(true);
  ghost.classList.add("drag-ghost");
  Object.assign(ghost.style, {
    position:      "fixed",
    left:          `${srcRect.left}px`,
    width:         `${srcRect.width}px`,
    top:           `${srcRect.top}px`,
    pointerEvents: "none",
    zIndex:        "9999",
    margin:        "0",
    transition:    "box-shadow 0.15s, transform 0.08s",
    transform:     "scale(1.02)",
    boxShadow:     "0 16px 48px rgba(0,0,0,0.55)",
  });
  document.body.appendChild(ghost);

  // ── Placeholder: source card becomes invisible (keeps layout space) ──
  srcCard.classList.add("drag-placeholder");

  // ── Enable CSS transitions on every other card ──
  cards.forEach((c) => {
    c.style.transition = "transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)";
  });

  const offsetY = e.clientY - srcRect.top;
  let insertIndex = srcIndex;

  drag = { srcIndex, insertIndex, ghost, srcCard, cards, snapshots, cardH, GAP, offsetY };

  document.addEventListener("pointermove", onDragMove);
  document.addEventListener("pointerup",   onDragEnd, { once: true });
}

function onDragMove(e) {
  if (!drag) return;
  const { ghost, srcCard, cards, snapshots, cardH, GAP, srcIndex, offsetY } = drag;

  // Move ghost
  ghost.style.top = `${e.clientY - offsetY}px`;

  // Insert index = first slot where ghost center is above a card's snapshot midpoint
  // Walk bottom→top: last card whose mid is BELOW ghostMid defines the slot
  const ghostMid = e.clientY - offsetY + cardH / 2;
  let newInsert = 0;
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (i === srcIndex) continue;
    if (ghostMid >= snapshots[i].mid) {
      newInsert = i > srcIndex ? i : i + 1;
      break;
    }
  }

  drag.insertIndex = newInsert;

  // Animate sibling cards: shift to make room at insertIndex
  cards.forEach((c, i) => {
    if (i === srcIndex) return; // placeholder stays in place
    const shift = cardH + GAP;
    if (srcIndex < newInsert) {
      // dragging DOWN → cards between src+1 … insertIndex slide UP
      c.style.transform = (i > srcIndex && i <= newInsert) ? `translateY(-${shift}px)` : "";
    } else {
      // dragging UP → cards between insertIndex … src-1 slide DOWN
      c.style.transform = (i >= newInsert && i < srcIndex) ? `translateY(${shift}px)` : "";
    }
  });
}

function onDragEnd() {
  if (!drag) return;
  const { srcIndex, insertIndex, ghost, srcCard, cards } = drag;

  // Snap ghost to its landing position before removing (optional quick snap)
  ghost.style.transition = "opacity 0.15s";
  ghost.style.opacity    = "0";
  setTimeout(() => ghost.remove(), 150);

  // Remove all transforms/classes — renderQuestions will rebuild
  cards.forEach((c) => {
    c.style.transform  = "";
    c.style.transition = "";
  });
  srcCard.classList.remove("drag-placeholder");

  drag = null;
  document.removeEventListener("pointermove", onDragMove);

  if (srcIndex !== insertIndex) {
    const moved = formData.questions.splice(srcIndex, 1)[0];
    formData.questions.splice(insertIndex, 0, moved);
    renderQuestions();
    renderPreview();
    markDirty();
  }
}

// ─── Preview ──────────────────────────────────────────────────────────────────
function renderPreview() {
  previewQuestions.innerHTML = "";
  const qs = formData.questions;

  if (qs.length === 0) {
    previewQuestions.innerHTML = `<p class="preview-empty">${T.preview_empty || "Aucune question"}</p>`;
    return;
  }

  qs.forEach((q) => {
    const div = document.createElement("div");
    div.className = "preview-question";

    let inputHtml = "";
    if (q.type === "text") {
      inputHtml = `<div class="preview-question__input">${q.label.substring(0, 20)}...</div>`;
    } else if (q.type === "choice" && q.options && q.options.length > 0) {
      inputHtml = `<div class="preview-question__choices">
        ${q.options.slice(0, 3).map((opt) => `
          <label class="preview-question__choice">
            <input type="radio" disabled>
            <span>${escHtml(opt)}</span>
          </label>
        `).join("")}
      </div>`;
    } else if (q.type === "yes_no") {
      const yes = (window.__t && window.__t.yes) || "Oui";
      const no  = (window.__t && window.__t.no)  || "Non";
      inputHtml = `<div class="preview-question__yesno">
        <button disabled>${yes}</button>
        <button disabled>${no}</button>
      </div>`;
    } else {
      inputHtml = `<div class="preview-question__input">...</div>`;
    }

    div.innerHTML = `
      <div class="preview-question__label">
        ${escHtml(q.label)}
        ${q.required ? '<span class="req">✱</span>' : ""}
      </div>
      ${inputHtml}
    `;
    previewQuestions.appendChild(div);
  });
}

// ─── Modal helpers ────────────────────────────────────────────────────────────
let currentType = "text";

function openModal(index = -1) {
  editingIndex = index;
  const isEdit = index >= 0;
  modalTitle.textContent = isEdit ? (T.edit_question || "Modifier") : (T.add_question || "Ajouter une question");

  if (isEdit) {
    const q = formData.questions[index];
    labelInput.value = q.label || "";
    setType(q.type || "text");
    requiredCheck.checked = !!q.required;

    // populate options
    if (q.type === "choice") {
      optionsList.innerHTML = "";
      (q.options || []).forEach((opt) => addOptionRow(opt));
    }
  } else {
    labelInput.value = "";
    setType("text");
    requiredCheck.checked = false;
    optionsList.innerHTML = "";
  }

  overlay.classList.add("show");
  labelInput.focus();
}

function closeModal() {
  overlay.classList.remove("show");
  editingIndex = -1;
  optionsList.innerHTML = "";
}

function setType(type) {
  currentType = type;
  typeBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
  optionsSection.style.display = type === "choice" ? "" : "none";
}

typeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    setType(btn.dataset.type);
    if (btn.dataset.type === "choice" && optionsList.children.length === 0) {
      addOptionRow("");
      addOptionRow("");
    }
  });
});

addOptionBtn.addEventListener("click", () => addOptionRow(""));

function addOptionRow(value = "") {
  const row = document.createElement("div");
  row.className = "option-row";
  row.innerHTML = `
    <input class="input option-input" type="text" placeholder="${T.option_placeholder || 'Option'}" value="${escHtml(value)}">
    <button type="button" class="remove-option">
      <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor">
        <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
      </svg>
    </button>
  `;
  row.querySelector(".remove-option").addEventListener("click", () => row.remove());
  optionsList.appendChild(row);
}

function collectOptions() {
  return Array.from(optionsList.querySelectorAll(".option-input"))
    .map((el) => el.value.trim())
    .filter((v) => v !== "");
}

function confirmModal() {
  const label = labelInput.value.trim();
  if (!label) {
    labelInput.focus();
    labelInput.classList.add("empty-field");
    setTimeout(() => labelInput.classList.remove("empty-field"), 1500);
    return;
  }

  const question = {
    label,
    type: currentType,
    required: requiredCheck.checked,
    options: currentType === "choice" ? collectOptions() : [],
    order: editingIndex >= 0 ? formData.questions[editingIndex].order : formData.questions.length,
  };

  if (editingIndex >= 0) {
    formData.questions[editingIndex] = question;
  } else {
    formData.questions.push(question);
  }

  renderQuestions();
  closeModal();
  markDirty();
}

// ─── Modal events ─────────────────────────────────────────────────────────────
addQuestionBtn.addEventListener("click", () => openModal(-1));
closeModalBtn.addEventListener("click", closeModal);
cancelModalBtn.addEventListener("click", closeModal);
confirmModalBtn.addEventListener("click", confirmModal);
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeModal();
});

// Enter in label input confirms
labelInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") confirmModal();
});

// ─── Save ─────────────────────────────────────────────────────────────────────
unsavedSaveBtn.addEventListener("click", () => saveBtn.click());

saveBtn.addEventListener("click", async () => {
  saveBtn.disabled = true;
  try {
    const payload = {
      active: formData.active,
      questions: formData.questions.map((q, i) => ({ ...q, order: i })),
    };

    const res = await fetch("/forms/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (data.success) {
      showToast(T.saved || "Formulaire enregistré !", "success");
      if (data.form) formData = { ...formData, ...data.form };
      markClean();
    } else {
      showToast(T.save_error || "Erreur lors de la sauvegarde", "error");
    }
  } catch (err) {
    console.error(err);
    showToast(T.save_error || "Erreur lors de la sauvegarde", "error");
  } finally {
    saveBtn.disabled = false;
  }
});

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = "success") {
  const existing = document.querySelector(".forms-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `forms-toast ${type}`;
  toast.innerHTML = `<div class="toast-dot"></div><span>${message}</span>`;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Plan gate ────────────────────────────────────────────────────────────────
function applyPlanGate() {
  if (MAX_QUESTIONS === 0) {
    // Plan Basic : on NE remplace PLUS le builder par un message — le
    // template (forms.pug) affiche désormais un aperçu avec des questions
    // de démonstration, flouté/désactivé via la classe `.forms-grid--locked`
    // (voir forms.css) + un bandeau d'upgrade au-dessus
    // (`.forms-lock-banner`). On se contente ici de s'assurer qu'aucune
    // action de sauvegarde/édition n'est possible sur cet aperçu figé.
    saveBtn.style.display = "none";
    unsavedBar.style.display = "none";
    if (addQuestionBtn) addQuestionBtn.disabled = true;
    if (activeToggle) activeToggle.disabled = true;
    return;
  }

  // Show remaining questions count
  const counter = document.createElement("span");
  counter.id = "questionsCounter";
  counter.style.cssText = "font-size:12px;color:var(--text-muted);margin-left:auto;";
  counter.textContent = `${formData.questions.length} / ${MAX_QUESTIONS} questions`;
  document.querySelector(".forms-builder-card__head").appendChild(counter);

  // Disable "add question" when limit reached
  function updateAddBtn() {
    const count = formData.questions.length;
    const counter = document.getElementById("questionsCounter");
    if (counter) counter.textContent = `${count} / ${MAX_QUESTIONS} questions`;
    const atLimit = count >= MAX_QUESTIONS;
    addQuestionBtn.disabled = atLimit;
    addQuestionBtn.title = atLimit
      ? `Limite de ${MAX_QUESTIONS} questions atteinte (plan actuel)`
      : "";
    const banner = document.getElementById("questionLimitBanner");
    if (banner) banner.style.display = atLimit ? "" : "none";
  }

  // Patch renderQuestions to call updateAddBtn
  const origRender = renderQuestions;
  window._origRenderQuestions = origRender;
  renderQuestions = function() {
    origRender();
    updateAddBtn();
  };

  updateAddBtn();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
renderQuestions();
applyPlanGate();
