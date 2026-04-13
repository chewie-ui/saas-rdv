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
      // const emailInput = document.getElementById("email");
      const phoneInput = document.getElementById("phone");

      const response = await fetch(`/account/update-info`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullNameInput.value,
          // email: emailInput.value,
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

      const data = await response.json();

      if (data.success) {
        const box = button.closest(".social__box");
        let msg = box.querySelector(".status-msg");

        if (!msg) {
          // 2. S'il n'existe pas, on le crée
          msg = document.createElement("span");
          msg.className = "status-msg";
          msg.textContent = "Modifications enregistrées !";
          box.appendChild(msg);
        }

        // 3. On gère l'affichage (on reset l'animation/opacité)
        msg.classList.remove("visible");
        void msg.offsetWidth; // "Magic trick" pour forcer le navigateur à reset l'animation
        msg.classList.add("visible");

        // 4. On nettoie après 3 secondes (en vérifiant l'ID du timer pour éviter les bugs)
        if (box.timer) clearTimeout(box.timer);

        box.timer = setTimeout(() => {
          msg.classList.remove("visible");
          // Optionnel : on le supprime du DOM après la transition CSS (ex: 300ms)
          setTimeout(() => msg.remove(), 300);
        }, 3000);
      }
    }
  };
}
function generateMapIframe(fullAddress) {
  const encodedAddress = encodeURIComponent(fullAddress);
  const iframeHtml = `
        <iframe 
            width="100%" 
            height="300" 
            frameborder="0" 
            scrolling="no" 
            marginheight="0" 
            marginwidth="0" 
            src="https://maps.google.com/maps?q=${encodedAddress}&t=&z=15&ie=UTF8&iwloc=&output=embed">
        </iframe>`;

  document.getElementById("mapContainer").innerHTML = iframeHtml;
}
const confirmLocation = document.getElementById("confirmLocation");
const addressInput = document.getElementById("addressInput");
const results = document.getElementById("results");

const streetInput = document.getElementById("streetInput");
const zipInput = document.getElementById("zipInput");
const cityInput = document.getElementById("cityInput");
const latInput = document.getElementById("latInput");
const lonInput = document.getElementById("lonInput");
const countryInput = document.getElementById("countryInput");
let debounceTimer;

if (addressInput && confirmLocation) {
  confirmLocation.addEventListener("click", async (event) => {
    const encodedAddress = encodeURIComponent(addressInput.value);
    const iframeUrl = `https://maps.google.com/maps?q=${encodedAddress}&t=&z=15&ie=UTF8&iwloc=&output=embed`;

    const response = await fetch(`/account/location`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        street: streetInput.value,
        zip: zipInput.value,
        city: cityInput.value,
        country: countryInput.value,
        iframeUrl,
        lat: latInput.value,
        lon: lonInput.value,
      }),
    });

    const data = await response.json();

    console.log(data);
    generateMapIframe(addressInput.value);
  });

  addressInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);

    const query = addressInput.value.trim();

    if (query.length < 3) {
      results.innerHTML = "";
      results.classList.remove("active");
      return;
    }

    debounceTimer = setTimeout(async () => {
      try {
        const url =
          "https://nominatim.openstreetmap.org/search?" +
          new URLSearchParams({
            q: query,
            format: "jsonv2",
            addressdetails: "1",
            countrycodes: "be",
            limit: "5",
          });

        const response = await fetch(url, {
          headers: {
            "Accept-Language": "fr",
            "User-Agent":
              "MonAppRDV/1.0 (contact: quentin.rennies@gmail.com) STUDENT",
          },
        });

        const data = await response.json();

        if (!data.length) {
          results.innerHTML = `<div class="result-item">Aucun résultat</div>`;
          results.classList.add("active");
          return;
        }

        results.innerHTML = "";
        results.classList.remove("active");

        data.forEach((item) => {
          const div = document.createElement("div");
          div.className = "result-item";
          div.textContent = item.display_name;

          div.addEventListener("click", () => {
            latInput.value = item.lat || "";
            lonInput.value = item.lon || "";

            const address = item.address || {};

            streetInput.value = [address.road, address.house_number]
              .filter(Boolean)
              .join(" ");
            zipInput.value = address.postcode || "";

            cityInput.value =
              address.city ||
              address.town ||
              address.village ||
              address.municipality ||
              "";
            countryInput.value = address.country || "Belgique";

            addressInput.value = item.display_name;
            results.innerHTML = "";
            results.classList.remove("active");
          });

          results.appendChild(div);
          results.classList.add("active");
        });
      } catch (err) {
        console.error("Erreur Nominatim :", err);
        results.innerHTML = `<div class="result-item">Erreur lors de la recherche</div>`;
        results.classList.add("active");
      }
    }, 500);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".address-box")) {
      results.innerHTML = "";
      results.classList.remove("active");
    }
  });
}
