document.addEventListener("DOMContentLoaded", () => {
  const dossierId = window.__dossierId;

  // ── Bloquer / débloquer ce client ────────────────────────────────────────
  const blockBtn = document.getElementById("blockClientBtn");
  const unblockBtn = document.getElementById("unblockClientBtn");

  if (blockBtn) {
    blockBtn.addEventListener("click", async () => {
      const ok = await window.confirmModal(
        "Bloquer ce client ?",
        "Il ne pourra plus prendre rendez-vous avec vous via la page de réservation en ligne. Vous pourrez le débloquer à tout moment."
      );
      if (!ok) return;
      try {
        const res = await fetch(`/clients/dossier/${dossierId}/block`, { method: "PATCH" });
        const data = await res.json();
        if (data.success) window.location.reload();
        else alert(data.error || "Erreur lors du blocage.");
      } catch (e) {
        alert("Erreur réseau.");
      }
    });
  }

  if (unblockBtn) {
    unblockBtn.addEventListener("click", async () => {
      const ok = await window.confirmModal(
        "Débloquer ce client ?",
        "Il pourra à nouveau prendre rendez-vous avec vous via la page de réservation en ligne."
      );
      if (!ok) return;
      try {
        const res = await fetch(`/clients/dossier/${dossierId}/unblock`, { method: "PATCH" });
        const data = await res.json();
        if (data.success) window.location.reload();
        else alert(data.error || "Erreur lors du déblocage.");
      } catch (e) {
        alert("Erreur réseau.");
      }
    });
  }

  // ── Lien "Tous les patients" : revient à la page précédente quand elle
  // vient du même site (ex: la fiche "Historique" d'un rendez-vous) au lieu
  // de toujours retomber sur la liste complète — sinon on perd sa place.
  const backLink = document.getElementById("dossierBackLink");
  if (backLink) {
    backLink.addEventListener("click", (e) => {
      if (window.history.length > 1 && document.referrer) {
        try {
          if (new URL(document.referrer).origin === window.location.origin) {
            e.preventDefault();
            window.history.back();
          }
        } catch (_) {}
      }
    });
  }

  // ── Bloc "Informations générales" ──────────────────────────────────────────
  const generalInput  = document.getElementById("generalInfoInput");
  const saveGeneralBtn = document.getElementById("saveGeneralBtn");
  const generalStatus  = document.getElementById("generalSaveStatus");
  const initialGeneral = generalInput ? generalInput.value : "";

  if (generalInput) {
    generalInput.addEventListener("input", () => {
      saveGeneralBtn.disabled = generalInput.value === initialGeneral;
      generalStatus.textContent = "";
    });

    saveGeneralBtn.addEventListener("click", async () => {
      saveGeneralBtn.disabled = true;
      generalStatus.textContent = "Enregistrement…";
      try {
        const r = await fetch(`/clients/dossier/${dossierId}/general`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ generalInfo: generalInput.value }),
        });
        const data = await r.json();
        if (data.success) {
          generalStatus.textContent = "Enregistré ✓";
          setTimeout(() => { generalStatus.textContent = ""; }, 2500);
        } else {
          generalStatus.textContent = data.error || "Erreur.";
          saveGeneralBtn.disabled = false;
        }
      } catch (e) {
        generalStatus.textContent = "Erreur réseau.";
        saveGeneralBtn.disabled = false;
      }
    });
  }

  // ── Modal note (ajout / édition) ────────────────────────────────────────────
  const entryModal        = document.getElementById("entryModal");
  const entryModalOverlay = document.getElementById("entryModalOverlay");
  const entryModalTitle   = document.getElementById("entryModalTitle");
  const entryModalId      = document.getElementById("entryModalId");
  const entryModalDate    = document.getElementById("entryModalDate");
  const entryModalNote    = document.getElementById("entryModalNote");
  const entryModalTodo    = document.getElementById("entryModalTodo");
  const addEntryBtn       = document.getElementById("addEntryBtn");
  const saveEntryBtn      = document.getElementById("saveEntryBtn");

  function todayISO() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function openEntryModal() { entryModalOverlay.classList.add("show"); entryModal.classList.add("show"); }
  function closeEntryModal() { entryModalOverlay.classList.remove("show"); entryModal.classList.remove("show"); }

  function resetEntryModal() {
    entryModalId.value = "";
    entryModalDate.value = todayISO();
    entryModalNote.value = "";
    entryModalTodo.value = "";
    entryModalTitle.textContent = "Nouvelle note";
  }

  if (addEntryBtn) {
    addEntryBtn.addEventListener("click", () => {
      resetEntryModal();
      openEntryModal();
      entryModalNote.focus();
    });
  }

  [document.getElementById("closeEntryModal"), document.getElementById("cancelEntryModal")].forEach((el) => {
    if (el) el.addEventListener("click", closeEntryModal);
  });
  if (entryModalOverlay) {
    entryModalOverlay.addEventListener("click", (e) => { if (e.target === entryModalOverlay) closeEntryModal(); });
  }

  document.querySelectorAll(".edit-entry-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".timeline-entry");
      entryModalId.value   = card.dataset.id;
      entryModalDate.value = card.dataset.date;
      entryModalNote.value = card.dataset.note;
      entryModalTodo.value = card.dataset.todo;
      entryModalTitle.textContent = "Modifier la note";
      openEntryModal();
      entryModalNote.focus();
    });
  });

  document.querySelectorAll(".delete-entry-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const card = btn.closest(".timeline-entry");
      const ok = await window.confirmModal("Supprimer cette note ?", "Cette action est irréversible.");
      if (!ok) return;
      try {
        const r = await fetch(`/clients/dossier/${dossierId}/entries/${card.dataset.id}`, { method: "DELETE" });
        const data = await r.json();
        if (data.success) {
          window.location.reload();
        } else {
          alert(data.error || "Erreur lors de la suppression.");
        }
      } catch (e) {
        alert("Erreur réseau.");
      }
    });
  });

  if (saveEntryBtn) {
    saveEntryBtn.addEventListener("click", async () => {
      const note = entryModalNote.value.trim();
      if (!note) { entryModalNote.focus(); return; }

      const id = entryModalId.value;
      const payload = {
        date: entryModalDate.value,
        note,
        todo: entryModalTodo.value.trim(),
      };

      saveEntryBtn.disabled = true;
      try {
        const url    = id ? `/clients/dossier/${dossierId}/entries/${id}` : `/clients/dossier/${dossierId}/entries`;
        const method = id ? "PATCH" : "POST";
        const r = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (data.success) {
          window.location.reload();
        } else {
          alert(data.error || "Erreur lors de l'enregistrement.");
          saveEntryBtn.disabled = false;
        }
      } catch (e) {
        alert("Erreur réseau.");
        saveEntryBtn.disabled = false;
      }
    });
  }

  // ── Moyen de paiement par séance (historique des rendez-vous) ──────────────
  document.querySelectorAll(".booking-mini-item__payment").forEach((select) => {
    select.dataset.lastSaved = select.value;
    select.addEventListener("change", async () => {
      const bookingId = select.dataset.id;
      select.disabled = true;
      try {
        const r = await fetch(`/clients/booking/${bookingId}/payment`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: select.value }),
        });
        const data = await r.json();
        if (data.success) {
          select.dataset.lastSaved = select.value;
        } else {
          select.value = select.dataset.lastSaved;
          alert(data.error || "Erreur lors de l'enregistrement.");
        }
      } catch (e) {
        select.value = select.dataset.lastSaved;
        alert("Erreur réseau.");
      } finally {
        select.disabled = false;
      }
    });
  });
});
