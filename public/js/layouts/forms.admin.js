// Formulaire de pré-réservation — constructeur (design refait).

const T = window.__tForms || {};
const MAX_QUESTIONS = window.__maxQuestions ?? 0; // 0 = plan sans formulaire
let formData = window.__formData || { active: false, questions: [] };
if (!formData.questions) formData.questions = [];

// Identifiant transitoire pour le glisser-déposer (les questions n'ont pas
// forcément d'id stable côté client).
let _uid = 0;
formData.questions.forEach((q) => { q._uid = ++_uid; });

// ─── Références DOM ─────────────────────────────────────────────────────────
const activeToggle    = document.getElementById("formActiveToggle");
const stateCard       = document.getElementById("fmStateCard");
const stateTitle      = document.getElementById("fmStateTitle");
const saveBtn         = document.getElementById("saveFormBtn");
const questionsList   = document.getElementById("questionsList");
const emptyState      = document.getElementById("emptyState");
const counterEl       = document.getElementById("questionsCounter");
const addQuestionBtn  = document.getElementById("addQuestionBtn");
const previewQuestions = document.getElementById("previewQuestions");

const overlay         = document.getElementById("modalOverlay");
const modalBox        = overlay.querySelector(".fm-modal__box");
const modalTitle      = document.getElementById("modalTitle");
const closeModalBtn   = document.getElementById("closeModalBtn");
const cancelModalBtn  = document.getElementById("cancelModalBtn");
const confirmModalBtn = document.getElementById("confirmModalBtn");
const labelInput      = document.getElementById("questionLabelInput");
const typeBtns        = document.querySelectorAll(".fm-type");
const optionsSection  = document.getElementById("optionsSection");
const optionsList     = document.getElementById("optionsList");
const addOptionBtn    = document.getElementById("addOptionBtn");
const requiredCheck   = document.getElementById("questionRequired");

const unsavedBar      = document.getElementById("formsUnsavedBar");
const unsavedSaveBtn  = document.getElementById("unsavedSaveBtn");

// ─── État ────────────────────────────────────────────────────────────────────
let editingIndex = -1;
let currentType  = "text";
let isDirty      = false;

function markDirty()  { isDirty = true;  unsavedBar.classList.add("is-visible"); }
function markClean()  { isDirty = false; unsavedBar.classList.remove("is-visible"); }

// Prévenir avant de quitter avec des changements non sauvegardés
window.addEventListener("beforeunload", (e) => {
  if (!isDirty) return;
  e.preventDefault();
  e.returnValue = "";
});
document.addEventListener("click", (e) => {
  if (!isDirty) return;
  const link = e.target.closest("a[href]");
  if (!link) return;
  const href = link.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("javascript") || link.target === "_blank") return;
  e.preventDefault();
  if (confirm("Vous avez des modifications non sauvegardées. Quitter sans sauvegarder ?")) {
    isDirty = false;
    window.location.href = href;
  }
});

// ─── Interrupteur actif / inactif (mis en évidence) ─────────────────────────
function syncActiveUI(active) {
  stateCard.classList.toggle("is-on", active);
  stateTitle.textContent = active
    ? "Activé — vos clients voient le formulaire"
    : "Désactivé — réservation directe";
}
activeToggle.addEventListener("change", () => {
  formData.active = activeToggle.checked;
  syncActiveUI(formData.active);
  markDirty();
});
syncActiveUI(formData.active);

// ─── Libellé de type ────────────────────────────────────────────────────────
function typeLabel(type) {
  if (type === "text")   return T.type_text   || "Texte libre";
  if (type === "choice") return T.type_choice || "Choix multiple";
  if (type === "yes_no") return T.type_yes_no || "Oui / Non";
  return type;
}

// ─── Liste des questions ────────────────────────────────────────────────────
function renderQuestions() {
  questionsList.innerHTML = "";
  const qs = formData.questions;
  emptyState.style.display = qs.length === 0 ? "" : "none";
  updateCounter();

  qs.forEach((q, i) => {
    const card = document.createElement("div");
    card.className = "fm-q";
    card.dataset.dsDrag = "";
    card.dataset.dsDragId = String(q._uid);
    card.innerHTML = `
      <span class="fm-q__handle" data-ds-handle title="Glisser pour réordonner">
        <span class="material-symbols-outlined">drag_indicator</span>
      </span>
      <div class="fm-q__body">
        <div class="fm-q__label">${escHtml(q.label)}</div>
        <div class="fm-q__meta">
          <span class="fm-q__type">${typeLabel(q.type)}</span>
          ${q.required ? `<span class="fm-q__req">✱ ${escHtml(T.required || "Obligatoire")}</span>` : ""}
        </div>
      </div>
      <div class="fm-q__actions">
        <button class="fm-q__btn js-dup" title="Dupliquer"><span class="material-symbols-outlined">content_copy</span></button>
        <button class="fm-q__btn js-edit" title="${escHtml(T.edit_question || "Modifier")}"><span class="material-symbols-outlined">edit</span></button>
        <button class="fm-q__btn fm-q__btn--del js-del" title="${escHtml(T.delete_question || "Supprimer")}"><span class="material-symbols-outlined">delete</span></button>
      </div>
    `;
    card.querySelector(".js-edit").addEventListener("click", () => openModal(i));
    card.querySelector(".js-dup").addEventListener("click", () => duplicateQuestion(i));
    card.querySelector(".js-del").addEventListener("click", () => {
      formData.questions.splice(i, 1);
      renderQuestions();
      markDirty();
    });
    questionsList.appendChild(card);
  });

  renderPreview();
}

function duplicateQuestion(i) {
  const src = formData.questions[i];
  if (MAX_QUESTIONS && formData.questions.length >= MAX_QUESTIONS) { flashLimit(); return; }
  const copy = JSON.parse(JSON.stringify(src));
  copy._uid = ++_uid;
  formData.questions.splice(i + 1, 0, copy);
  renderQuestions();
  markDirty();
}

// ─── Glisser-déposer (composant commun) ─────────────────────────────────────
if (window.DsDragSort) {
  window.DsDragSort.init(questionsList, {
    handleSelector: "[data-ds-handle]",
    onReorder: (ids) => {
      // Réordonne formData.questions selon l'ordre des _uid.
      const parId = new Map(formData.questions.map((q) => [String(q._uid), q]));
      formData.questions = ids.map((id) => parId.get(id)).filter(Boolean);
      updateCounter();
      renderPreview();
      markDirty();
    },
  });
}

// ─── Aperçu client ──────────────────────────────────────────────────────────
function renderPreview() {
  previewQuestions.innerHTML = "";
  const qs = formData.questions;
  if (qs.length === 0) {
    previewQuestions.innerHTML = `<p class="fm-preview__empty">${escHtml(T.preview_empty || "Aucune question")}</p>`;
    return;
  }
  qs.forEach((q) => {
    const div = document.createElement("div");
    let inner = "";
    if (q.type === "choice" && q.options && q.options.length) {
      inner = `<div class="fm-pq__choices">${q.options.slice(0, 4).map((o) =>
        `<label class="fm-pq__choice"><span class="fm-pq__radio"></span><span>${escHtml(o)}</span></label>`).join("")}</div>`;
    } else if (q.type === "yes_no") {
      const yes = (window.__t && window.__t.yes) || "Oui";
      const no  = (window.__t && window.__t.no)  || "Non";
      inner = `<div class="fm-pq__yesno"><span>${escHtml(yes)}</span><span>${escHtml(no)}</span></div>`;
    } else {
      inner = `<div class="fm-pq__input">${escHtml(T.type_text || "Réponse…")}</div>`;
    }
    div.innerHTML = `<div class="fm-pq__label">${escHtml(q.label)}${q.required ? '<span class="req">✱</span>' : ""}</div>${inner}`;
    previewQuestions.appendChild(div);
  });
}

// ─── Modale ──────────────────────────────────────────────────────────────────
function openModal(index = -1) {
  editingIndex = index;
  const isEdit = index >= 0;
  modalTitle.textContent = isEdit ? (T.edit_question || "Modifier") : (T.add_question || "Ajouter une question");

  if (isEdit) {
    const q = formData.questions[index];
    labelInput.value = q.label || "";
    setType(q.type || "text");
    requiredCheck.checked = !!q.required;
    optionsList.innerHTML = "";
    if (q.type === "choice") (q.options || []).forEach((o) => addOptionRow(o));
  } else {
    labelInput.value = "";
    setType("text");
    requiredCheck.checked = false;
    optionsList.innerHTML = "";
  }
  labelInput.classList.remove("fm-input--err");
  overlay.classList.add("show");
  setTimeout(() => labelInput.focus(), 40);
}
function closeModal() {
  overlay.classList.remove("show");
  editingIndex = -1;
  optionsList.innerHTML = "";
}
function setType(type) {
  currentType = type;
  typeBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.type === type));
  optionsSection.style.display = type === "choice" ? "" : "none";
}
typeBtns.forEach((b) => {
  b.addEventListener("click", () => {
    setType(b.dataset.type);
    if (b.dataset.type === "choice" && optionsList.children.length === 0) {
      addOptionRow(""); addOptionRow("");
    }
  });
});
addOptionBtn.addEventListener("click", () => addOptionRow(""));

function addOptionRow(value = "") {
  const row = document.createElement("div");
  row.className = "fm-opt-row";
  row.innerHTML = `
    <input class="fm-input" type="text" placeholder="${escHtml(T.option_placeholder || "Option")}" value="${escHtml(value)}">
    <button type="button" class="fm-opt-del" aria-label="Retirer"><span class="material-symbols-outlined" style="font-size:16px">close</span></button>
  `;
  row.querySelector(".fm-opt-del").addEventListener("click", () => row.remove());
  optionsList.appendChild(row);
}
function collectOptions() {
  return Array.from(optionsList.querySelectorAll(".fm-input"))
    .map((el) => el.value.trim())
    .filter(Boolean);
}
function confirmModal() {
  const label = labelInput.value.trim();
  if (!label) {
    labelInput.classList.add("fm-input--err");
    labelInput.focus();
    return;
  }
  const question = {
    _uid: editingIndex >= 0 ? formData.questions[editingIndex]._uid : ++_uid,
    label,
    type: currentType,
    required: requiredCheck.checked,
    options: currentType === "choice" ? collectOptions() : [],
  };
  if (editingIndex >= 0) formData.questions[editingIndex] = question;
  else formData.questions.push(question);
  renderQuestions();
  closeModal();
  markDirty();
}

addQuestionBtn.addEventListener("click", () => {
  if (MAX_QUESTIONS && formData.questions.length >= MAX_QUESTIONS) { flashLimit(); return; }
  openModal(-1);
});
closeModalBtn.addEventListener("click", closeModal);
cancelModalBtn.addEventListener("click", closeModal);
confirmModalBtn.addEventListener("click", confirmModal);
overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
labelInput.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && overlay.classList.contains("show")) closeModal(); });

// ─── Compteur & limite de plan ──────────────────────────────────────────────
function updateCounter() {
  if (!counterEl) return;
  if (MAX_QUESTIONS > 0) {
    counterEl.textContent = `${formData.questions.length} / ${MAX_QUESTIONS} questions`;
  } else {
    counterEl.textContent = `${formData.questions.length} questions`;
  }
  const atLimit = MAX_QUESTIONS > 0 && formData.questions.length >= MAX_QUESTIONS;
  const banner = document.getElementById("questionLimitBanner");
  if (banner) banner.style.display = atLimit ? "" : "none";
}
function flashLimit() {
  const banner = document.getElementById("questionLimitBanner");
  if (!banner) return;
  banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
  banner.style.transition = "box-shadow .15s";
  banner.style.boxShadow = "0 0 0 3px rgba(234,88,12,.35)";
  setTimeout(() => { banner.style.boxShadow = ""; }, 800);
}

// ─── Enregistrer ────────────────────────────────────────────────────────────
unsavedSaveBtn.addEventListener("click", () => saveBtn.click());
saveBtn.addEventListener("click", async () => {
  saveBtn.disabled = true;
  try {
    const payload = {
      active: formData.active,
      questions: formData.questions.map((q, i) => ({
        label: q.label, type: q.type, required: !!q.required,
        options: q.options || [], order: i,
      })),
    };
    const res = await fetch("/forms/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) {
      showToast(T.saved || "Formulaire enregistré", "success");
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

// ─── Toast ───────────────────────────────────────────────────────────────────
function showToast(message, type = "success") {
  const old = document.querySelector(".fm-toast");
  if (old) old.remove();
  const toast = document.createElement("div");
  toast.className = `fm-toast ${type}`;
  toast.innerHTML = `<span class="fm-toast__dot"></span><span>${escHtml(message)}</span>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 250); }, 3000);
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Verrou de plan (aperçu figé) ────────────────────────────────────────────
if (MAX_QUESTIONS === 0) {
  saveBtn.style.display = "none";
  unsavedBar.style.display = "none";
  if (addQuestionBtn) addQuestionBtn.disabled = true;
  if (activeToggle) activeToggle.disabled = true;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
renderQuestions();
