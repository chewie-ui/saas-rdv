const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("fileInput");
const avatarPreview = document.getElementById("avatarPreview");

if (uploadBtn && fileInput && avatarPreview) {
  uploadBtn.onclick = () => fileInput.click();

  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;

    avatarPreview.src = URL.createObjectURL(file);

    const formData = new FormData();

    formData.append("profilePicture", file);

    try {
      const response = fetch("/account/profile-picture", {
        method: "PATCH",
        body: formData,
      });

      console.log(await response);
    } catch (err) {
      console.error(err);
    }
  };
}

const saveChanges = document.getElementById("saveChanges");
const accountForm = document.querySelector(".account__form");

if (saveChanges && accountForm) {
  saveChanges.onclick = async function (e) {
    e.preventDefault(); // Pour éviter le refresh et voir les logs

    try {
      const fullNameInput = document.getElementById("fullname");
      const emailInput = document.getElementById("email");
      const phoneInput = document.getElementById("phone");

      const response = await fetch(`/account/update-info`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullNameInput.value,
          email: emailInput.value,
          phone: phoneInput.value,
        }),
      });

      const data = await response.json();

      // Fonction pour afficher le succès proprement
      const showSuccess = (inputEl, message) => {
        // On enlève d'éventuels anciens messages
        const oldMsg = inputEl.parentNode.querySelector(".success-msg");
        if (oldMsg) oldMsg.remove();

        const successMsg = document.createElement("span");
        successMsg.classList.add("info-text", "success-text"); // Crée une classe .success-text en CSS (couleur verte)
        successMsg.style.color = "#28a745";
        successMsg.style.fontSize = "12px";
        successMsg.textContent = message;
        inputEl.after(successMsg);

        // Optionnel : faire disparaître le message après 3 secondes
        setTimeout(() => successMsg.remove(), 3000);
      };

      // Gestion des changements individuels
      if (data.changes) {
        if (data.changes.email)
          showSuccess(emailInput, "Email updated successfully!");
        if (data.changes.fullName) showSuccess(fullNameInput, "Name updated!");
        if (data.changes.phone)
          showSuccess(phoneInput, "Phone number updated!");
      }

      // Gestion de l'erreur 11000 (Email déjà pris)
      const existingError =
        emailInput.parentNode.querySelector(".info-text.danger");

      if (data.code === 11000) {
        emailInput.classList.add("field-empty");
        if (!existingError) {
          const errorMsg = document.createElement("span");
          errorMsg.classList.add("info-text", "danger");
          errorMsg.textContent = "This email is already in use.";
          errorMsg.style.fontSize = "12px";
          emailInput.after(errorMsg);
        }
      } else {
        emailInput.classList.remove("field-empty");
        if (existingError) existingError.remove();
      }
    } catch (err) {
      console.error(err);
    }
  };
}

const socialContainer = document.querySelector(".social__container");

if (socialContainer) {
  socialContainer.onclick = async function (e) {
    const button = e.target.closest(".btn__social-save");

    if (button) {
      const box = button.closest(".social__box");

      const name = box.dataset.name;
      console.log(box.name);

      const value = box.querySelector("input").value;

      const response = await fetch("/account/update-social", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldName: name, fieldValue: value }),
      });

      console.log(await response);
    }
  };
}
