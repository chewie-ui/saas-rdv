const validDigitalCode = document.getElementById("validDigitalCode");
const digitalCode = document.getElementById("digitalCode");
const emailOpen = document.getElementById("emailOpen");
const emailClose = document.getElementById("emailClose");
const email__editor = document.querySelector(".email__editor");
const emailInput = document.getElementById("email");

emailInput.onblur = function () {
  setTimeout(() => {
    emailInput.disabled = true;
    // Optionnel : on remet le style par défaut si tu l'avais changé
    emailInput.style.borderColor = "";
  }, 100);
};

if (validDigitalCode && digitalCode) {
  validDigitalCode.onclick = async function () {
    const response = await fetch(`/account/check-digital-code`, {
      method: "POST", // Plus sécurisé pour déclencher un envoi
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: digitalCode.value }),
    });
    const data = await response.json();
    if (data.success) {
      email__editor.classList.remove("open");
      emailInput.disabled = false;
      emailInput.focus();
    }
  };
}

if (emailOpen) {
  emailOpen.onclick = async function () {
    try {
      email__editor.classList.add("open");
      const response = await fetch("/account/edit-email-confirmation", {
        method: "POST", // Plus sécurisé pour déclencher un envoi
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (data.success) {
        document.querySelector(".email__editor").classList.add("active");
      } else {
        alert({ error: data.message });
      }
    } catch (error) {
      console.error("Erreur réseau :", err);
    }
  };
}

if (emailClose) {
  emailClose.onclick = function () {
    email__editor.classList.remove("open");
  };
}
