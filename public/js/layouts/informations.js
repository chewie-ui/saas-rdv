const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("fileInput");
const avatarPreview = document.getElementById("avatarPreview");

if (uploadBtn && fileInput && avatarPreview) {
  uploadBtn.onclick = () => fileInput.click();

  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;

    const previousSrc = avatarPreview.src;
    avatarPreview.src = URL.createObjectURL(file);

    try {
      const data = await window.BkImageUpload.uploadImage({
        url: "/account/profile-picture",
        method: "PATCH",
        fieldName: "profilePicture",
        file,
      });
      avatarPreview.src = data.path || previousSrc;
    } catch (err) {
      avatarPreview.src = previousSrc;
    } finally {
      fileInput.value = "";
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
    let previewImg = businessPicWrapper;
    if (previewImg) {
      if (previewImg.tagName === "IMG") {
        previewImg.src = URL.createObjectURL(file);
      } else {
        // Was a placeholder div — swap to an img
        const img = document.createElement("img");
        img.id = "businessPicPreview";
        img.alt = "Photo établissement";
        img.src = URL.createObjectURL(file);
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        previewImg.replaceWith(img);
        previewImg = img;
      }
    }

    try {
      const data = await window.BkImageUpload.uploadImage({
        url: "/account/business-picture",
        method: "PATCH",
        fieldName: "businessPicture",
        file,
      });
      if (data.path && previewImg) {
        previewImg.src = data.path;
        // Si c'était un placeholder, l'img a été swappée — on récupère le nouveau nœud
        const freshPreview = document.querySelector(".biz-photo-preview");
        if (freshPreview) freshPreview.classList.remove("biz-photo-preview--empty");
      }
      updateBizDeleteBtn(true);
      updateBizIncompleteBanner();
    } catch (err) {
      // L'erreur est déjà affichée à l'écran par BkImageUpload.
    } finally {
      businessFileInput.value = "";
    }
  };
}

// ── Supprimer photo établissement ─────────────────────────────────────────────
function updateBizDeleteBtn(hasPic) {
  const btn = document.getElementById("deleteBusinessPicBtn");
  if (btn) btn.style.display = hasPic ? "" : "none";
}

function updateBizIncompleteBanner() {
  const banner = document.getElementById("bizIncompleteBanner");
  const preview = document.querySelector(".biz-photo-preview");
  const nameInput = document.getElementById("businessNameInput");

  const picEl = document.getElementById("businessPicPreview");
  const hasPic = picEl && picEl.tagName === "IMG" && !!picEl.src;
  const hasName = !!(nameInput?.value || "").trim();

  if (banner) banner.style.display = hasPic && hasName ? "none" : "";
  if (preview) preview.classList.toggle("biz-photo-preview--empty", !hasPic);
  if (nameInput) nameInput.classList.toggle("input--warn", !hasName);
}

const deleteBusinessPicBtn = document.getElementById("deleteBusinessPicBtn");
if (deleteBusinessPicBtn) {
  deleteBusinessPicBtn.addEventListener("click", async () => {
    deleteBusinessPicBtn.disabled = true;
    try {
      const res = await fetch("/account/business-picture", { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        const wrapper = document.getElementById("businessPicPreview");
        if (wrapper) {
          const placeholder = document.createElement("div");
          placeholder.id = "businessPicPreview";
          placeholder.className = "biz-photo-placeholder";
          placeholder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="32px" viewBox="0 -960 960 960" width="32px" fill="currentColor"><path d="M160-120q-33 0-56.5-23.5T80-200v-480q0-33 23.5-56.5T160-760h126l74-80h240l74 80h126q33 0 56.5 23.5T880-680v480q0 33-23.5 56.5T800-120H160Zm0-80h640v-480H160v480Zm320-80q-58 0-99-41t-41-99q0-58 41-99t99-41q58 0 99 41t41 99q0 58-41 99t-99 41Zm0-80q25 0 42.5-17.5T540-420q0-25-17.5-42.5T480-480q-25 0-42.5 17.5T420-420q0 25 17.5 42.5T480-360Z"/></svg>`;
          wrapper.replaceWith(placeholder);
        }
        updateBizDeleteBtn(false);
        updateBizIncompleteBanner();
      }
    } catch (err) {
      console.error(err);
    } finally {
      deleteBusinessPicBtn.disabled = false;
    }
  });
}

// Mettre à jour la bannière quand l'utilisateur tape le nom
const bizNameInput = document.getElementById("businessNameInput");
if (bizNameInput) {
  bizNameInput.addEventListener("input", updateBizIncompleteBanner);
}

const saveChanges = document.getElementById("saveChanges");
const fullNameInput = document.getElementById("fullname");
const phoneInput = document.getElementById("phone");

// Même logique "modifié vs déjà enregistré" que pour les liens sociaux : le
// bouton reste grisé tant que rien n'a changé par rapport à la dernière
// valeur sauvegardée, pour éviter un clic (et un message "mis à jour")
// alors qu'aucun champ n'a réellement été modifié.
function updateSaveChangesButton() {
  if (!saveChanges || !fullNameInput || !phoneInput) return;
  const isDirty =
    fullNameInput.value.trim() !== fullNameInput.dataset.savedValue ||
    phoneInput.value.trim() !== phoneInput.dataset.savedValue;
  saveChanges.disabled = !isDirty;
}

if (saveChanges && fullNameInput && phoneInput) {
  fullNameInput.dataset.savedValue = fullNameInput.value.trim();
  phoneInput.dataset.savedValue = phoneInput.value.trim();
  updateSaveChangesButton();
  fullNameInput.addEventListener("input", updateSaveChangesButton);
  phoneInput.addEventListener("input", updateSaveChangesButton);

  saveChanges.onclick = async function (e) {
    e.preventDefault();

    try {
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

      // La valeur vient d'être confirmée sauvegardée — le bouton repasse en
      // état "grisé" jusqu'à la prochaine modification.
      fullNameInput.dataset.savedValue = fullNameInput.value.trim();
      phoneInput.dataset.savedValue = phoneInput.value.trim();
      updateSaveChangesButton();
    } catch (err) {
      console.error(err);
    }
  };
}

const socialContainer = document.querySelector(".social-grid");

// Bascule visuelle entre "modifié, pas encore sauvegardé" (bouton coloré,
// actif) et "déjà enregistré" (bouton grisé, désactivé) — comparé à la
// dernière valeur effectivement sauvegardée, pas juste "vide ou pas".
function updateSocialSaveButton(box, input, button) {
  const span = button.querySelector("span");
  if (span && button.dataset.labelSave === undefined) {
    button.dataset.labelSave = span.textContent;
  }
  const isDirty = input.value.trim() !== box.dataset.savedValue;
  button.disabled = !isDirty;
  button.classList.toggle("btn__social-save--dirty", isDirty);
  input.classList.toggle("input--dirty", isDirty);
  if (span) span.textContent = isDirty ? button.dataset.labelSave : "✓ Enregistré";
}

if (socialContainer) {
  socialContainer.querySelectorAll(".social-box").forEach(function (box) {
    const input  = box.querySelector("input.input");
    const button = box.querySelector(".btn__social-save");
    if (!input || !button) return;
    box.dataset.savedValue = input.value.trim();
    updateSocialSaveButton(box, input, button);
    input.addEventListener("input", function () {
      updateSocialSaveButton(box, input, button);
    });
  });

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
    if (!button) return;

    const box   = button.closest(".social-box");
    const name  = box.dataset.name;
    const type  = box.dataset.type || "url";
    const input = box.querySelector("input.input");
    const value = input.value.trim();

    // Supprimer ancienne erreur
    const oldErr = box.querySelector(".social-box__error");
    if (oldErr) oldErr.remove();
    input.classList.remove("input--error");

    // ── Validation client-side ──────────────────────────────────────────
    let clientError = null;
    if (value !== "") {
      if (type === "email") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          clientError = "Email invalide. Ex : contact@monactivite.com";
        }
      } else if (type === "phone") {
        if (!/^\+?[\d\s\-().]{6,20}$/.test(value)) {
          clientError = "Numéro invalide. Ex : +32 476 12 34 56";
        }
      } else if (type === "whatsapp") {
        // Accepte numéro OU lien wa.link / wa.me
        var isWaUrl  = /^https?:\/\/(wa\.link|wa\.me|api\.whatsapp\.com)\/.+/.test(value);
        var isPhone  = /^\+?[\d\s\-().]{6,20}$/.test(value);
        if (!isWaUrl && !isPhone) {
          clientError = "WhatsApp invalide. Ex : +32 476 12 34 56 ou https://wa.link/votreCode";
        }
      } else {
        if (!/^https?:\/\/.+\..+/.test(value)) {
          clientError = "Lien invalide. Il doit commencer par https:// — ex : https://facebook.com/mapage";
        }
      }
    }

    if (clientError) {
      input.classList.add("input--error");
      const errEl = document.createElement("p");
      errEl.className = "social-box__error";
      errEl.textContent = "⚠️ " + clientError;
      box.querySelector(".social-box__field").insertAdjacentElement("afterend", errEl);
      return;
    }

    // ── Envoi ───────────────────────────────────────────────────────────
    const response = await fetch("/account/update-social", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldName: name, fieldValue: value }),
    });

    const data = await response.json();

    if (data.success) {
      // La valeur vient d'être confirmée sauvegardée — le bouton repasse en
      // état "grisé" et y reste jusqu'à ce que l'utilisateur modifie à
      // nouveau le champ (au lieu de revenir à "Sauvegarder" après 2s).
      box.dataset.savedValue = value;
      updateSocialSaveButton(box, input, button);
    } else {
      // Erreur serveur — afficher le message
      input.classList.add("input--error");
      const errEl = document.createElement("p");
      errEl.className = "social-box__error";
      errEl.textContent = "⚠️ " + (data.error || "Erreur lors de la sauvegarde.");
      box.querySelector(".social-box__field").insertAdjacentElement("afterend", errEl);
    }
  };
}

// ── Localisation Google Maps ─────────────────────────────────────────────────
(function () {
  // Onglets legacy (si présents — ignore si non)
  var methodBtns = document.querySelectorAll('.loc-method-btn');
  var blockAddress = document.getElementById('locMethodAddress');
  var blockGmap    = document.getElementById('locMethodGmap');
  var blockGps     = document.getElementById('locMethodGps');
  var current = 'gmap'; // défaut : lien Google Maps

  if (methodBtns.length) {
    function showMethod(m) {
      current = m;
      methodBtns.forEach(function(b) { b.classList.toggle('active', b.dataset.method === m); });
      if (blockAddress) blockAddress.style.display = m === 'address' ? '' : 'none';
      if (blockGmap)    blockGmap.style.display    = m === 'gmap'    ? '' : 'none';
      if (blockGps)     blockGps.style.display     = m === 'gps'     ? '' : 'none';
    }
    methodBtns.forEach(function(btn) {
      btn.addEventListener('click', function() { showMethod(btn.dataset.method); });
    });
  }

  // ── Parser un lien Google Maps → { lat, lon } ──────────────────────────────
  function parseGmapUrl(url) {
    var m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { lat: m[1], lon: m[2] };
    m = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (m) return { lat: m[1], lon: m[2] };
    m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return { lat: m[1], lon: m[2] };
    return null;
  }

  var gmapInput    = document.getElementById('gmapUrlInput');
  var gmapStatus   = document.getElementById('gmapParseStatus');
  var resolvedData = null; // { lat, lon, gmapUrl } stocké après résolution
  var resolveTimer = null;

  function setStatus(msg, color) {
    if (!gmapStatus) return;
    gmapStatus.textContent = msg;
    gmapStatus.style.color = color || '';
    gmapStatus.style.display = msg ? 'block' : 'none';
  }

  async function resolveGmapUrl(url) {
    if (!url) { setStatus('', ''); resolvedData = null; return; }

    // Essai local d'abord
    var parsed = parseGmapUrl(url);
    if (parsed) {
      resolvedData = { lat: parsed.lat, lon: parsed.lon, gmapUrl: url };
      setStatus('✅ Localisation détectée — cliquez sur Confirmer', '#15803d');
      return;
    }

    // Lien court ou sans coordonnées → appel API
    setStatus('⏳ Résolution du lien…', '#6b7280');
    try {
      var r = await fetch('/api/resolve-gmap?url=' + encodeURIComponent(url));
      var d = await r.json();
      if (d.ok && d.lat && d.lon) {
        resolvedData = { lat: d.lat, lon: d.lon, gmapUrl: url };
        setStatus('✅ Localisation détectée — cliquez sur Confirmer', '#15803d');
      } else if (d.ok && d.placeName) {
        // On a juste un nom de lieu, utiliser comme adresse
        resolvedData = { placeName: d.placeName, gmapUrl: url };
        setStatus('✅ Lieu trouvé : ' + d.placeName + ' — cliquez sur Confirmer', '#15803d');
      } else {
        resolvedData = null;
        setStatus('⚠️ Lien non reconnu. Essayez le bouton Partager > Copier le lien sur Google Maps.', '#b45309');
      }
    } catch (e) {
      resolvedData = null;
      setStatus('⚠️ Erreur réseau, réessayez.', '#b45309');
    }
  }

  if (gmapInput) {
    // Déclencher à la saisie (debounce 600ms)
    gmapInput.addEventListener('input', function() {
      clearTimeout(resolveTimer);
      var url = this.value.trim();
      resolveTimer = setTimeout(function() { resolveGmapUrl(url); }, 600);
    });
    // Résoudre immédiatement au chargement si une valeur existe déjà
    if (gmapInput.value.trim()) resolveGmapUrl(gmapInput.value.trim());
  }

  // Exposer les données résolues pour le confirmLocation handler
  window.__locGetMethod    = function() { return 'gmap'; };
  window.__locGetGmapData  = function() { return resolvedData; };
  window.__locGetGpsData   = function() { return null; };
})();

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
const radioSurPlace   = document.getElementById("onlineService");
const radioEnLigne    = document.getElementById("homeService");
const radioIframe     = document.getElementById("iframeService");
const addressSearchBlock = document.getElementById("addressSearchBlock");
const fullAddressBlock   = document.getElementById("fullAddressBlock");
const onlineAddressBlock = document.getElementById("onlineAddressBlock");
const locOnSiteFields    = document.getElementById("locOnSiteFields");
const locOnlineFields    = document.getElementById("locOnlineFields");
const locIframeFields    = document.getElementById("locIframeFields");

function applyServiceType() {
  const isSurPlace = radioSurPlace && radioSurPlace.checked;
  const isEnLigne  = radioEnLigne  && radioEnLigne.checked;
  const isIframe   = radioIframe   && radioIframe.checked;
  if (addressSearchBlock) addressSearchBlock.style.display = isSurPlace ? "" : "none";
  if (fullAddressBlock)   fullAddressBlock.style.display   = isSurPlace ? "" : "none";
  if (onlineAddressBlock) onlineAddressBlock.style.display  = "none"; // toujours masqué (remplacé)
  // Blocs spécifiques à chaque mode
  if (locOnSiteFields)  locOnSiteFields.style.display  = isSurPlace ? "" : "none";
  if (locOnlineFields)  locOnlineFields.style.display  = isEnLigne  ? "" : "none";
  if (locIframeFields)  locIframeFields.style.display  = isIframe   ? "" : "none";
}

if (radioSurPlace) radioSurPlace.addEventListener("change", applyServiceType);
if (radioEnLigne)  radioEnLigne.addEventListener("change", applyServiceType);
if (radioIframe)   radioIframe.addEventListener("change", applyServiceType);

// Prévisualisation live de l'iframe au fur et à mesure de la saisie
const locIframeInput = document.getElementById("locIframeInput");
if (locIframeInput) {
  locIframeInput.addEventListener("input", function () {
    const src = extractIframeSrc(locIframeInput.value.trim());
    const mc = document.getElementById("mapContainer");
    if (!mc) return;
    if (src) {
      mc.innerHTML = `<iframe src="${src}" style="border:0;width:100%;height:300px;display:block;" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
    } else if (!locIframeInput.value.trim()) {
      mc.innerHTML = "";
    }
  });
}

// Extraire le src depuis un code <iframe ...> ou retourner l'URL directement
function extractIframeSrc(raw) {
  if (!raw) return null;
  // Si c'est directement une URL
  if (raw.startsWith("http")) return raw;
  // Sinon extraire src="..." dans le code iframe
  var m = raw.match(/src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

applyServiceType();

let debounceTimer;

if (confirmLocation) {
  confirmLocation.addEventListener("click", async () => {
    const isSurPlace = radioSurPlace ? radioSurPlace.checked : true;
    const isEnLigne  = radioEnLigne  ? radioEnLigne.checked  : false;
    const isIframe   = radioIframe   ? radioIframe.checked   : false;

    const btn  = confirmLocation.querySelector('span') || confirmLocation;
    const orig = btn.textContent;

    // ── Mode Iframe ───────────────────────────────────────────────────────────
    if (isIframe) {
      const raw = locIframeInput ? (locIframeInput.value || '').trim() : '';
      const iframeSrc = extractIframeSrc(raw);
      if (!iframeSrc) {
        alert('Veuillez coller le code iframe Google Maps.');
        if (locIframeInput) locIframeInput.focus();
        return;
      }
      btn.textContent = '…';
      confirmLocation.disabled = true;
      try {
        await fetch('/account/location', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            street: '', city: '', zip: '', country: '',
            iframeUrl: iframeSrc,
            iframeEmbedCode: raw,
            gmapUrl: '',
            serviceType: 'iframe',
          }),
        });
        const mc = document.getElementById('mapContainer');
        if (mc) mc.innerHTML = `<iframe src="${iframeSrc}" style="border:0;width:100%;height:300px;display:block;" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
        btn.textContent = '✓ Enregistré';
        setTimeout(() => { btn.textContent = orig; confirmLocation.disabled = false; }, 2500);
      } catch (e) {
        btn.textContent = orig;
        confirmLocation.disabled = false;
        alert('Erreur lors de la sauvegarde.');
      }
      return;
    }

    // ── Mode en ligne (pays + langue) ────────────────────────────────────────
    if (isEnLigne) {
      const countryEl = document.getElementById('locCountryInput');
      const langEl    = document.getElementById('locLangInput');
      const country   = countryEl ? countryEl.value : '';
      const langs     = langEl
        ? Array.from(langEl.selectedOptions).map(function(o) { return o.value; })
        : [];
      btn.textContent = '…';
      confirmLocation.disabled = true;
      try {
        await fetch('/account/location', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            street: '', city: '', zip: '', country: '',
            iframeUrl: '', gmapUrl: '',
            serviceType: 'en_ligne',
            onlineCountry: country,
            onlineLangs: langs,
          }),
        });
        // Masquer la carte (pas pertinente pour un service en ligne)
        const mc = document.getElementById('mapContainer');
        if (mc) mc.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:300px;color:#9ca3af;font-size:14px;gap:8px;"><svg xmlns=\'http://www.w3.org/2000/svg\' height=\'24px\' viewBox=\'0 -960 960 960\' width=\'24px\' fill=\'currentColor\'><path d=\'M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm-40-82v-78q-33 0-56.5-23.5T360-320v-40L168-552q-3 18-5.5 36t-2.5 36q0 121 79.5 212T440-162Zm276-102q20-22 35-47.5t24-52.5q-29 0-52 -17.5T700-430v-60q0-33-23.5-56.5T620-570h-80v-80q0-17-11.5-28.5T500-690h-80v-78q-19 4-38 9.5t-36 14.5l-26-26q12-14 26.5-26t30.5-21q-15 15-25 34t-10 42q0 33 23.5 56.5T400-660h40v40q0 17 11.5 28.5T480-580h60v40q0 17 11.5 28.5T580-500v40q0 17 11.5 28.5T620-420h100q0 17-11.5 28.5T680-380v40q0 10 2 19.5t7 17.5l27-1Zm0 0Z\'/></svg> Service en ligne — aucune carte à afficher</div>';
        btn.textContent = '✓ Enregistré';
        setTimeout(() => { btn.textContent = orig; confirmLocation.disabled = false; }, 2500);
      } catch (e) {
        btn.textContent = orig;
        confirmLocation.disabled = false;
        alert('Erreur lors de la sauvegarde.');
      }
      return;
    }

    // ── Mode adresse (sur place) ──────────────────────────────────────────────
    const locAddr = document.getElementById('locAddressInput');
    const locGmap = document.getElementById('locGmapInput');

    const fullAddress = locAddr ? (locAddr.value || '').trim() : '';
    const gmapUrl     = locGmap ? (locGmap.value || '').trim() : '';

    if (!fullAddress) {
      alert('Veuillez entrer votre adresse complète.');
      if (locAddr) locAddr.focus();
      return;
    }

    const iframeUrl = `https://maps.google.com/maps?q=${encodeURIComponent(fullAddress)}&output=embed&hl=fr&z=16`;
    btn.textContent = '…';
    confirmLocation.disabled = true;

    try {
      await fetch('/account/location', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          street: fullAddress, city: '', zip: '', country: '',
          iframeUrl, gmapUrl,
          serviceType: 'sur_place',
        }),
      });
      const mc = document.getElementById('mapContainer');
      if (mc) mc.innerHTML = `<iframe width="100%" height="360" frameborder="0" src="${iframeUrl}" allowfullscreen loading="lazy"></iframe>`;
      btn.textContent = '✓ Enregistré';
      setTimeout(() => { btn.textContent = orig; confirmLocation.disabled = false; }, 2500);
    } catch (e) {
      btn.textContent = orig;
      confirmLocation.disabled = false;
      alert('Erreur lors de la sauvegarde.');
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
