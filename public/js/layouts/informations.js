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
      await fetch("/account/profile-picture", {
        method: "PATCH",
        body: formData,
      });
    } catch (err) {
      console.error(err);
    }
  };
}

// ── Business photo upload ─────────────────────────────────────────────────────
const uploadBusinessBtn  = document.getElementById("uploadBusinessBtn");
const businessFileInput  = document.getElementById("businessFileInput");
const businessPicWrapper = document.getElementById("businessPicPreview");

if (uploadBusinessBtn && businessFileInput) {
  uploadBusinessBtn.onclick = () => businessFileInput.click();

  businessFileInput.onchange = async () => {
    const file = businessFileInput.files[0];
    if (!file) return;

    // Show immediate preview — replace placeholder div with img if needed
    if (businessPicWrapper) {
      if (businessPicWrapper.tagName === "IMG") {
        businessPicWrapper.src = URL.createObjectURL(file);
      } else {
        // Was a placeholder div — swap to an img
        const img = document.createElement("img");
        img.id = "businessPicPreview";
        img.alt = "Photo établissement";
        img.src = URL.createObjectURL(file);
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        businessPicWrapper.replaceWith(img);
      }
    }

    const formData = new FormData();
    formData.append("businessPicture", file);

    try {
      await fetch("/account/business-picture", {
        method: "PATCH",
        body: formData,
      });
    } catch (err) {
      console.error(err);
    }
  };
}

const saveChanges = document.getElementById("saveChanges");

if (saveChanges) {
  saveChanges.onclick = async function (e) {
    e.preventDefault();

    try {
      const fullNameInput = document.getElementById("fullname");
      const phoneInput = document.getElementById("phone");

      const response = await fetch(`/account/update-info`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullNameInput.value,
          phone: phoneInput.value,
        }),
      });

      const data = await response.json();

      const showSuccess = (inputEl, message) => {
        const oldMsg = inputEl.parentNode.querySelector(".success-msg");
        if (oldMsg) oldMsg.remove();

        const successMsg = document.createElement("span");
        successMsg.classList.add("info-text", "success-text");
        successMsg.style.color = "#28a745";
        successMsg.style.fontSize = "12px";
        successMsg.textContent = message;
        inputEl.after(successMsg);
        setTimeout(() => successMsg.remove(), 3000);
      };

      const __t = window.__t || {};
      if (data.changes) {
        if (data.changes.fullName) showSuccess(fullNameInput, __t.name_updated || "Nom mis à jour !");
        if (data.changes.phone) showSuccess(phoneInput, __t.phone_updated || "Téléphone mis à jour !");
      }
    } catch (err) {
      console.error(err);
    }
  };
}

const socialContainer = document.querySelector(".social-grid");

if (socialContainer) {
  /* ── Visibility toggles ── */
  socialContainer.addEventListener("change", async function (e) {
    const checkbox = e.target.closest(".social-visibility-toggle__input");
    if (!checkbox) return;

    const label   = checkbox.closest(".social-visibility-toggle");
    const box     = checkbox.closest(".social-box");
    const field   = label.dataset.toggle;
    const enabled = checkbox.checked;

    // Optimistic UI: dim the box if disabled
    box.classList.toggle("social-box--hidden", !enabled);

    const response = await fetch("/account/toggle-social", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldName: field, enabled }),
    });

    const data = await response.json();
    if (!data.success) {
      // Revert on error
      checkbox.checked = !enabled;
      box.classList.toggle("social-box--hidden", enabled);
    }
  });

  /* ── Save link buttons ── */
  socialContainer.onclick = async function (e) {
    const button = e.target.closest(".btn__social-save");
    if (button) {
      const box = button.closest(".social-box");
      const name = box.dataset.name;
      const value = box.querySelector("input.input").value;

      const response = await fetch("/account/update-social", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldName: name, fieldValue: value }),
      });

      const data = await response.json();

      if (data.success) {
        const btnSpan = button.querySelector("span");
        if (btnSpan) {
          const orig = btnSpan.textContent;
          btnSpan.textContent = "✓ Enregistré";
          button.disabled = true;
          if (button._saveTimer) clearTimeout(button._saveTimer);
          button._saveTimer = setTimeout(() => {
            btnSpan.textContent = orig;
            button.disabled = false;
          }, 2200);
        }
      }
    }
  };
}

// ---- Location / service type ----
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
const countryInputOnline = document.getElementById("countryInputOnline");
const cityInputOnline = document.getElementById("cityInputOnline");

// Service type radio toggle
const radioSurPlace = document.getElementById("onlineService");
const radioEnLigne = document.getElementById("homeService");
const addressSearchBlock = document.getElementById("addressSearchBlock");
const fullAddressBlock = document.getElementById("fullAddressBlock");
const onlineAddressBlock = document.getElementById("onlineAddressBlock");

function applyServiceType() {
  const isSurPlace = radioSurPlace && radioSurPlace.checked;
  if (addressSearchBlock) addressSearchBlock.style.display = isSurPlace ? "" : "none";
  if (fullAddressBlock) fullAddressBlock.style.display = isSurPlace ? "" : "none";
  if (onlineAddressBlock) onlineAddressBlock.style.display = isSurPlace ? "none" : "";
}

if (radioSurPlace) radioSurPlace.addEventListener("change", applyServiceType);
if (radioEnLigne) radioEnLigne.addEventListener("change", applyServiceType);
applyServiceType();

let debounceTimer;

if (addressInput && confirmLocation) {
  confirmLocation.addEventListener("click", async (event) => {
    const isSurPlace = radioSurPlace && radioSurPlace.checked;

    let street = "", zip = "", city = "", country = "";

    if (isSurPlace) {
      street = streetInput ? streetInput.value : "";
      zip = zipInput ? zipInput.value : "";
      city = cityInput ? cityInput.value : "";
      country = countryInput ? countryInput.value : "";
    } else {
      country = countryInputOnline ? countryInputOnline.value : "";
      city = cityInputOnline ? cityInputOnline.value : "";
    }

    const encodedAddress = encodeURIComponent(isSurPlace ? addressInput.value : `${city} ${country}`);
    const iframeUrl = `https://maps.google.com/maps?q=${encodedAddress}&t=&z=15&ie=UTF8&iwloc=&output=embed`;

    const response = await fetch(`/account/location`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        street,
        zip,
        city,
        country,
        iframeUrl,
        lat: latInput ? latInput.value : "",
        lon: lonInput ? lonInput.value : "",
        serviceType: isSurPlace ? "sur_place" : "en_ligne",
      }),
    });

    const data = await response.json();
    console.log(data);

    if (isSurPlace && addressInput.value) {
      generateMapIframe(addressInput.value);
    } else if (!isSurPlace && (city || country)) {
      generateMapIframe(`${city} ${country}`);
    }
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
            "User-Agent": "MonAppRDV/1.0 (contact: quentin.rennies@gmail.com) STUDENT",
          },
        });

        const data = await response.json();

        if (!data.length) {
          results.innerHTML = `<div class="result-item">${(window.__t && window.__t.no_result) || "Aucun résultat"}</div>`;
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
            if (streetInput) {
              streetInput.value = [address.road, address.house_number].filter(Boolean).join(" ");
            }
            if (zipInput) zipInput.value = address.postcode || "";
            if (cityInput) {
              cityInput.value = address.city || address.town || address.village || address.municipality || "";
            }
            if (countryInput) countryInput.value = address.country || "";

            addressInput.value = item.display_name;
            results.innerHTML = "";
            results.classList.remove("active");
          });

          results.appendChild(div);
          results.classList.add("active");
        });
      } catch (err) {
        console.error("Erreur Nominatim :", err);
        results.innerHTML = `<div class="result-item">${(window.__t && window.__t.search_error) || "Erreur lors de la recherche"}</div>`;
        results.classList.add("active");
      }
    }, 500);
  });

  document.addEventListener("click", async (e) => {
    if (!e.target.closest(".address-box")) {
      results.innerHTML = "";
      results.classList.remove("active");
    }

    if (e.target.closest("#saveDescription")) {
      const descVal = document.getElementById("descriptionCoach").value;
      const response = await fetch(`/account/description/edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: descVal }),
      });
      const data = await response.json();
      console.log(data);
      if (!data.success) alert("error");
    }
  });
}

// ---- Delete account ----
const deleteAccountBtn = document.getElementById("deleteAccountBtn");
const deleteAccountModal = document.getElementById("deleteAccountModal");
const closeDeleteModal = document.getElementById("closeDeleteModal");
const deleteAccountOverlay = document.getElementById("deleteAccountOverlay");
const sendDeleteCode = document.getElementById("sendDeleteCode");
const deleteStep1 = document.getElementById("deleteStep1");
const deleteStep2 = document.getElementById("deleteStep2");
const deleteCodeInput = document.getElementById("deleteCodeInput");
const confirmDeleteAccount = document.getElementById("confirmDeleteAccount");
const deleteCodeStatus = document.getElementById("deleteCodeStatus");
const deleteConfirmStatus = document.getElementById("deleteConfirmStatus");

function openDeleteModal() {
  deleteAccountModal.style.display = "flex";
  deleteStep1.style.display = "";
  deleteStep2.style.display = "none";
  if (deleteCodeInput) deleteCodeInput.value = "";
  if (deleteCodeStatus) deleteCodeStatus.textContent = "";
  if (deleteConfirmStatus) deleteConfirmStatus.textContent = "";
}

function closeDeleteModalFn() {
  deleteAccountModal.style.display = "none";
}

if (deleteAccountBtn) deleteAccountBtn.addEventListener("click", openDeleteModal);
if (closeDeleteModal) closeDeleteModal.addEventListener("click", closeDeleteModalFn);
if (deleteAccountOverlay) deleteAccountOverlay.addEventListener("click", closeDeleteModalFn);

if (sendDeleteCode) {
  sendDeleteCode.addEventListener("click", async () => {
    sendDeleteCode.disabled = true;
    deleteCodeStatus.textContent = (window.__t && window.__t.code_sending) || "Envoi en cours...";

    const res = await fetch("/account/send-delete-code", { method: "POST" });
    const data = await res.json();

    if (data.success) {
      deleteCodeStatus.textContent = (window.__t && window.__t.code_sent) || "✓ Code envoyé à votre adresse email.";
      deleteCodeStatus.style.color = "#16a34a";
      setTimeout(() => {
        deleteStep1.style.display = "none";
        deleteStep2.style.display = "";
      }, 1200);
    } else {
      deleteCodeStatus.textContent = (window.__t && window.__t.code_send_error) || "Erreur lors de l'envoi. Réessayez.";
      deleteCodeStatus.style.color = "#dc2626";
      sendDeleteCode.disabled = false;
    }
  });
}

// ── URL personnalisée (slug) ────────────────────────────────────────────────
const slugInput  = document.getElementById("slugInput");
const slugStatus = document.getElementById("slugStatus");
const saveSlugBtn = document.getElementById("saveSlugBtn");

if (slugInput && slugStatus) {
  let slugTimer = null;

  function setSlugStatus(msg, color) {
    slugStatus.textContent = msg;
    slugStatus.style.color = color;
  }

  slugInput.addEventListener("input", () => {
    clearTimeout(slugTimer);
    const val = slugInput.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    slugInput.value = val;
    if (!val || val.length < 3) {
      setSlugStatus(val.length > 0 ? "Minimum 3 caractères." : "", "#aaa");
      return;
    }
    setSlugStatus("Vérification...", "#aaa");
    slugTimer = setTimeout(async () => {
      const res  = await fetch(`/account/check-slug?slug=${encodeURIComponent(val)}`);
      const data = await res.json();
      if (data.available) {
        setSlugStatus("✓ Disponible", "#16a34a");
      } else {
        setSlugStatus(data.error || "✗ Ce nom est déjà utilisé.", "#ef4444");
      }
    }, 450);
  });

  if (saveSlugBtn) {
    saveSlugBtn.addEventListener("click", async () => {
      const slug = slugInput.value.trim();
      if (!slug || slug.length < 3) { setSlugStatus("Minimum 3 caractères.", "#ef4444"); return; }
      const btn = saveSlugBtn;
      btn.disabled = true;
      const res  = await fetch("/account/slug", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const data = await res.json();
      btn.disabled = false;
      if (data.success) {
        setSlugStatus("✓ URL enregistrée !", "#16a34a");
        const btnSpan = btn.querySelector("span");
        if (btnSpan) {
          btnSpan.textContent = "✓ Enregistré";
          setTimeout(() => { btnSpan.textContent = saveSlugBtn.dataset.label || "Enregistrer l'URL"; }, 2500);
        }
        // Update the share URL display
        const shareEl = document.getElementById("slugShareUrl");
        if (shareEl) shareEl.textContent = "branshee.com/" + slug;
        // Show the share row if it was hidden
        const shareRow = document.querySelector(".slug-share-row");
        if (shareRow) shareRow.style.display = "";
      } else {
        setSlugStatus(data.error || "Erreur.", "#ef4444");
      }
    });
  }
}

// ── Copy share link ────────────────────────────────────────────────────────
const copySlugBtn  = document.getElementById("copySlugBtn");
const slugShareUrl = document.getElementById("slugShareUrl");

if (copySlugBtn && slugShareUrl) {
  copySlugBtn.addEventListener("click", async () => {
    const url = "https://" + slugShareUrl.textContent.trim();
    try {
      await navigator.clipboard.writeText(url);
    } catch (_) {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    const span = copySlugBtn.querySelector("span");
    if (span) {
      const orig = span.textContent;
      span.textContent = "✓ Copié !";
      copySlugBtn.disabled = true;
      setTimeout(() => {
        span.textContent = orig;
        copySlugBtn.disabled = false;
      }, 2000);
    }
  });
}

if (confirmDeleteAccount) {
  confirmDeleteAccount.addEventListener("click", async () => {
    const code = deleteCodeInput.value.trim();
    if (!code) {
      deleteConfirmStatus.textContent = (window.__t && window.__t.enter_code_required) || "Veuillez entrer le code reçu.";
      deleteConfirmStatus.style.color = "#dc2626";
      return;
    }

    confirmDeleteAccount.disabled = true;
    deleteConfirmStatus.textContent = (window.__t && window.__t.account_deleting) || "Suppression en cours...";

    const res = await fetch("/account/delete-account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();

    if (data.success) {
      deleteConfirmStatus.textContent = (window.__t && window.__t.account_deleted) || "Compte supprimé. Redirection...";
      deleteConfirmStatus.style.color = "#16a34a";
      setTimeout(() => { window.location.href = "/"; }, 1500);
    } else {
      deleteConfirmStatus.textContent = data.message || "Code invalide.";
      deleteConfirmStatus.style.color = "#dc2626";
      confirmDeleteAccount.disabled = false;
    }
  });
}
