const stepCredentials = document.getElementById("stepCredentials");
const step2FA = document.getElementById("step2FA");

const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

const twoFAForm = document.getElementById("twoFAForm");
const twoFABtn = document.getElementById("twoFABtn");
const twoFAError = document.getElementById("twoFAError");

document.getElementById("goRegister").addEventListener("click", (e) => {
  e.preventDefault();
  window.branshee.goTo("register.html");
});

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}

function hideError(el) {
  el.hidden = true;
}

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  btn.querySelector("span").textContent = busy ? "…" : label;
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError(loginError);
  setBusy(loginBtn, true, "Se connecter");

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const result = await window.branshee.login(email, password);
  setBusy(loginBtn, false, "Se connecter");

  if (!result.ok) {
    showError(loginError, result.error || "Erreur de connexion.");
    return;
  }

  if (result.data.redirect === "/login/2fa") {
    stepCredentials.hidden = true;
    step2FA.hidden = false;
    document.getElementById("code").focus();
    return;
  }

  window.branshee.goTo("agenda.html");
});

twoFAForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError(twoFAError);
  setBusy(twoFABtn, true, "Vérifier");

  const code = document.getElementById("code").value.trim();
  const result = await window.branshee.verify2FA(code);
  setBusy(twoFABtn, false, "Vérifier");

  if (!result.ok) {
    showError(twoFAError, result.error || "Code incorrect.");
    return;
  }

  window.branshee.goTo("agenda.html");
});
