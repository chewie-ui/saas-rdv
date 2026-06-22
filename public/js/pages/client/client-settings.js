document.addEventListener("DOMContentLoaded", () => {

  // ── Avatar upload ──────────────────────────────────────────────────────────
  const triggerBtn = document.getElementById("triggerAvatarUpload");
  const avatarInput = document.getElementById("avatarInput");
  const avatarPreview = document.getElementById("avatarPreview");

  if (triggerBtn && avatarInput) {
    triggerBtn.addEventListener("click", () => avatarInput.click());

    avatarInput.addEventListener("change", async () => {
      const file = avatarInput.files[0];
      if (!file) return;

      // Preview immédiat
      const reader = new FileReader();
      reader.onload = (e) => {
        avatarPreview.src = e.target.result;
      };
      reader.readAsDataURL(file);

      // Upload — BkImageUpload gère seul la conversion (HEIC/iPhone inclus),
      // le redimensionnement, la progression à l'écran et les erreurs.
      triggerBtn.disabled = true;
      triggerBtn.textContent = "Envoi…";

      try {
        const data = await window.BkImageUpload.uploadImage({
          url: "/espace-client/parametres/picture",
          method: "PATCH",
          fieldName: "profilePicture",
          file,
        });
        showToast("Photo de profil mise à jour !", "success");
        if (data.path) avatarPreview.src = data.path;
        // Mise à jour dans la sidebar aussi
        const sidebarAvatar = document.querySelector(".client-layout .sidebar .profile-image img");
        if (sidebarAvatar) sidebarAvatar.src = data.path;
      } catch (err) {
        // Le message d'erreur précis est déjà affiché à l'écran par BkImageUpload.
        avatarPreview.src = avatarPreview.dataset.original || "/images/no-user.webp";
      } finally {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/></svg> Changer la photo`;
        avatarInput.value = "";
      }
    });
  }

  // ── Language chips toggle (multi, for spoken languages) ───────────────────
  document.querySelectorAll(".settings__lang-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("active");
      const checkbox = chip.querySelector("input[type='checkbox']");
      if (checkbox) checkbox.checked = chip.classList.contains("active");
    });
  });

  // ── Preferred language chips (single radio select) ─────────────────────
  document.querySelectorAll(".settings__pref-lang-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".settings__pref-lang-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const radio = chip.querySelector("input[type='radio']");
      if (radio) radio.checked = true;
    });
  });

  // ── Toast helper ──────────────────────────────────────────────────────────
  function showToast(message, type = "success") {
    // Supprimer les toasts existants
    document.querySelectorAll(".settings__toast--dynamic").forEach(el => el.remove());

    const icon = type === "success"
      ? `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Z"/></svg>`;

    const toast = document.createElement("div");
    toast.className = `settings__toast settings__toast--${type} settings__toast--dynamic`;
    toast.innerHTML = `${icon}<span>${message}</span>`;

    const settings = document.querySelector(".settings");
    if (settings) settings.prepend(toast);

    setTimeout(() => toast.remove(), 4000);
  }

  // ── Auto-dismiss server-rendered toasts ───────────────────────────────────
  const serverToast = document.querySelector(".settings__toast:not(.settings__toast--dynamic)");
  if (serverToast) {
    setTimeout(() => {
      serverToast.style.transition = "opacity 0.4s ease";
      serverToast.style.opacity = "0";
      setTimeout(() => serverToast.remove(), 400);
    }, 4000);
  }

});
