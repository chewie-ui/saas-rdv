const searchInput = document.getElementById("businessTypeSearch");
const hiddenValue = document.getElementById("businessTypeValue");
const resultsBox = document.getElementById("businessResults");
const registerForm = document.getElementById("registerForm");
const registerBtn = document.getElementById("registerBtn");
const registerError = document.getElementById("registerError");

let businessTypes = [];

function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function renderResults(list) {
  if (list.length === 0) {
    resultsBox.innerHTML = '<div class="business-results__empty">Aucun résultat</div>';
  } else {
    resultsBox.innerHTML = list
      .map((s) => `<div class="business-results__item" data-value="${s}">${s}</div>`)
      .join("");
  }
  resultsBox.hidden = false;
}

searchInput.addEventListener("input", () => {
  hiddenValue.value = "";
  const q = normalize(searchInput.value.trim());
  if (!q) {
    resultsBox.hidden = true;
    return;
  }
  renderResults(businessTypes.filter((s) => normalize(s).includes(q)).slice(0, 8));
});

searchInput.addEventListener("focus", () => {
  if (searchInput.value.trim()) searchInput.dispatchEvent(new Event("input"));
});

resultsBox.addEventListener("click", (e) => {
  const item = e.target.closest(".business-results__item");
  if (!item || !item.dataset.value) return;
  searchInput.value = item.dataset.value;
  hiddenValue.value = item.dataset.value;
  resultsBox.hidden = true;
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".business-field")) resultsBox.hidden = true;
});

document.getElementById("goLogin").addEventListener("click", (e) => {
  e.preventDefault();
  window.branshee.goTo("login.html");
});

function showError(message) {
  registerError.textContent = message;
  registerError.hidden = false;
}

function setBusy(busy) {
  registerBtn.disabled = busy;
  registerBtn.querySelector("span").textContent = busy ? "…" : "Créer mon compte";
}

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  registerError.hidden = true;

  if (!hiddenValue.value || !businessTypes.includes(hiddenValue.value)) {
    showError("Veuillez choisir votre métier dans la liste proposée.");
    return;
  }

  const password = document.getElementById("regPassword").value;
  const conformPassword = document.getElementById("regPasswordConfirm").value;

  setBusy(true);
  const result = await window.branshee.register({
    fullname: document.getElementById("fullname").value.trim(),
    email: document.getElementById("regEmail").value.trim(),
    password,
    conformPassword,
    businessType: hiddenValue.value,
  });
  setBusy(false);

  if (!result.ok) {
    showError(result.error || "Erreur lors de la création du compte.");
    return;
  }

  window.branshee.goTo("agenda.html");
});

(async () => {
  const result = await window.branshee.getBusinessTypes();
  businessTypes = result.ok ? result.data.businessTypes : [];
})();
