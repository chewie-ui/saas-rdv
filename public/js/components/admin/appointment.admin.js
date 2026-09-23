/* ── Shared delete confirmation modal ───────────────────────────────────────── */
function showDeleteConfirm({ title = "Supprimer ce rendez-vous ?", desc = "Cette action est irréversible. Le rendez-vous sera définitivement supprimé.", confirmLabel = "Supprimer", onConfirm }) {
  // Remove any existing modal
  document.getElementById("__deleteModal")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "__deleteModal";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;animation:__dfadeIn .15s ease";

  overlay.innerHTML = `
    <style>
      @keyframes __dfadeIn{from{opacity:0}to{opacity:1}}
      @keyframes __dslidein{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
      #__deleteModal .dm{background:#fff;border-radius:20px;max-width:420px;width:100%;box-shadow:0 24px 48px -8px rgba(0,0,0,.22),0 8px 16px -4px rgba(0,0,0,.08);display:flex;flex-direction:column;gap:0;overflow:hidden;animation:__dslidein .18s cubic-bezier(.34,1.4,.64,1)}
      #__deleteModal .dm__head{padding:24px 24px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
      #__deleteModal .dm__icon-wrap{width:44px;height:44px;border-radius:50%;background:#fef2f2;border:1px solid #fecaca;display:flex;align-items:center;justify-content:center;flex-shrink:0}
      #__deleteModal .dm__icon-wrap .material-symbols-outlined{font-size:22px;color:#dc2626}
      #__deleteModal .dm__close{background:none;border:none;cursor:pointer;color:#9ca3af;width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;transition:background .15s,color .15s;flex-shrink:0;padding:0}
      #__deleteModal .dm__close .material-symbols-outlined{font-size:18px}
      #__deleteModal .dm__close:hover{background:#f3f4f6;color:#111}
      #__deleteModal .dm__body{padding:16px 24px 0;display:flex;flex-direction:column;gap:6px}
      #__deleteModal .dm__title{font-size:17px;font-weight:700;color:#111;letter-spacing:-.01em;margin:0}
      #__deleteModal .dm__desc{font-size:13.5px;color:#6b7280;line-height:1.55;margin:0}
      #__deleteModal .dm__actions{padding:20px 24px 24px;display:flex;gap:8px;justify-content:flex-end}
      #__deleteModal .dm__cancel{display:inline-flex;align-items:center;justify-content:center;padding:9px 18px;border-radius:10px;font-size:13.5px;font-weight:600;background:#f3f4f6;border:1px solid #e5e7eb;color:#4b5563;cursor:pointer;font-family:inherit;transition:background .15s}
      #__deleteModal .dm__cancel:hover{background:#e9eaec}
      #__deleteModal .dm__confirm{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 20px;border-radius:10px;font-size:13.5px;font-weight:700;background:#dc2626;border:none;color:#fff;cursor:pointer;font-family:inherit;box-shadow:0 1px 3px rgba(220,38,38,.3);transition:background .15s,transform .1s}
      #__deleteModal .dm__confirm:hover{background:#b91c1c;transform:translateY(-1px)}
      #__deleteModal .dm__confirm:active{transform:translateY(0)}
      #__deleteModal .dm__confirm.loading{opacity:.6;cursor:wait;pointer-events:none}
      #__deleteModal .dm__confirm .material-symbols-outlined{font-size:16px}
    </style>
    <div class="dm">
      <div class="dm__head">
        <div class="dm__icon-wrap">
          <span class="material-symbols-outlined">delete</span>
        </div>
        <button class="dm__close" aria-label="Fermer">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="dm__body">
        <p class="dm__title">${title}</p>
        <p class="dm__desc">${desc}</p>
      </div>
      <div class="dm__actions">
        <button class="dm__cancel">Annuler</button>
        <button class="dm__confirm">
          <span class="material-symbols-outlined">delete</span>
          ${confirmLabel}
        </button>
      </div>
    </div>`;

  function close() { overlay.remove(); }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".dm__close").addEventListener("click", close);
  overlay.querySelector(".dm__cancel").addEventListener("click", close);
  overlay.querySelector(".dm__confirm").addEventListener("click", async () => {
    const btn = overlay.querySelector(".dm__confirm");
    btn.classList.add("loading");
    btn.textContent = "Suppression…";
    await onConfirm(close);
  });

  document.body.appendChild(overlay);
  // Fermer avec Escape
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
}

export const initDeleteAppointment = function () {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".appointment-action");
    if (!btn || btn.dataset.method !== "DELETE") return;

    const { link, method } = btn.dataset;

    showDeleteConfirm({
      onConfirm: async (closeModal) => {
        try {
          const result = await fetch(link, { method });
          const data = await result.json();
          closeModal();
          if (data.success) {
            location.href = "/appointment";
          } else {
            alert(data.message || "Erreur lors de la suppression.");
          }
        } catch (err) {
          closeModal();
          console.error("Network error", err);
        }
      }
    });
  });
};

// ── Appointment popup (Google Calendar style) ─────────────────────────────
export const initAppointmentPopup = function () {
  const popup = document.getElementById("apptPopup");
  if (!popup) return;

  // Move popup to <body> so no parent overflow/transform can clip it
  document.body.appendChild(popup);

  const titleEl    = document.getElementById("apptPopupTitle");
  const datetimeEl = document.getElementById("apptPopupDatetime");
  const dotEl      = document.getElementById("apptPopupDot");
  const empRow     = document.getElementById("apptPopupEmployeeRow");
  const empName    = document.getElementById("apptPopupEmployeeName");
  const svcRow     = document.getElementById("apptPopupServiceRow");
  const svcName    = document.getElementById("apptPopupServiceName");
  const canceledEl = document.getElementById("apptPopupCanceled");
  const deleteBtn  = document.getElementById("apptPopupDelete");
  const closeBtn   = document.getElementById("apptPopupClose");
  const detailBtn  = document.getElementById("apptPopupDetailBtn");
  const dossierBtn = document.getElementById("apptPopupDossierBtn");

  let currentId = null;

  /* ── Position popup near the clicked card ── */
  function positionPopup(card) {
    const rect = card.getBoundingClientRect();
    const pw   = 300;
    const ph   = popup.offsetHeight || 250;
    const gap  = 8;

    // Prefer right of card, fallback left, fallback centered
    let left = rect.right + gap;
    if (left + pw > window.innerWidth - gap) left = rect.left - pw - gap;
    if (left < gap) left = Math.round((window.innerWidth - pw) / 2);

    // Align top with card, shift up if overflows bottom
    let top = rect.top;
    if (top + ph > window.innerHeight - gap) top = window.innerHeight - ph - gap;
    if (top < gap) top = gap;

    popup.style.left = `${left}px`;
    popup.style.top  = `${top}px`;
  }

  /* ── Show popup ── */
  function showPopup(card) {
    const d = card.dataset;
    currentId = d.id;

    // Title
    titleEl.textContent = [d.name, d.surname].filter(Boolean).join(" ").trim();

    // Date + time
    if (d.date) {
      const [yyyy, mm, dd] = d.date.split("-");
      const dateObj  = new Date(+yyyy, +mm - 1, +dd);
      const lang     = document.documentElement.lang || "fr";
      const dateStr  = dateObj.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long" });
      datetimeEl.textContent = dateStr.charAt(0).toUpperCase() + dateStr.slice(1) + " · " + d.start + " – " + d.end;
    }

    // Employee row
    if (d.employee) { empName.textContent = d.employee; empRow.style.display = "flex"; }
    else              { empRow.style.display = "none"; }

    // Service row
    if (d.service)  { svcName.textContent = d.service;  svcRow.style.display = "flex"; }
    else              { svcRow.style.display = "none"; }

    // Canceled badge
    if (d.status === "canceled") {
      canceledEl.style.display = "inline-block";
      dotEl.style.background   = "#9ca3af";
    } else {
      canceledEl.style.display = "none";
      dotEl.style.background   = d.color || "";
    }

    // « Voir le détail » mène à la fiche du client : ça n'a pas de sens
    // pour une absence, qui n'a pas de client — on le masque alors.
    if (detailBtn) detailBtn.href = `/clients-hub/${currentId}`;
    if (detailBtn) detailBtn.style.display = d.isBlock === "1" ? "none" : "";

    // « Modifier » n'apparaît que pour une absence : un vrai rendez-vous se
    // modifie depuis sa fiche (« Voir le détail »), qui a bien plus de champs.
    // Sans ce bouton, corriger un horaire imposait de supprimer puis recréer.
    const editBlockBtn = document.getElementById("apptPopupEditBlock");
    if (editBlockBtn) {
      const estAbsence = d.isBlock === "1";
      editBlockBtn.hidden = !estAbsence;
      editBlockBtn.onclick = estAbsence
        ? () => {
            // L'identifiant est relu AVANT de fermer le popover : hidePopup()
            // remet `currentId` à null, et la modale partait alors créer une
            // nouvelle absence sur le même créneau au lieu de modifier
            // l'existante — refusée par l'index unique, d'où le 500.
            const idAbsence = currentId;
            hidePopup();
            if (typeof window.__openBlockApptEdit === "function") {
              window.__openBlockApptEdit({
                id: idAbsence,
                date: d.date,
                time: d.start,
                endTime: d.end,
                note: d.service || "",
                employeeId: d.employeeId || "",
              });
            }
          }
        : null;
    }

    // « Modifier » un vrai rendez-vous : modale rapide (date, heures,
    // employé). Masqué pour une absence, qui a sa propre modale ci-dessus.
    const editBtn = document.getElementById("apptPopupEdit");
    if (editBtn) {
      const estRdv = d.isBlock !== "1";
      editBtn.hidden = !estRdv;
      editBtn.onclick = estRdv
        ? () => {
            const idRdv = currentId; // relu AVANT hidePopup(), qui le remet à null
            hidePopup();
            ouvrirModifRapide({
              id: idRdv,
              qui: [d.name, d.surname].filter(Boolean).join(" ").trim(),
              date: d.date,
              start: d.start,
              end: d.end,
              employeeId: d.employeeId || "",
            });
          }
        : null;
    }

    // Dossier client → fiche clients-hub, onglet « Dossier ». Affiché dès
    // qu'il y a un client, MÊME sans e-mail : le dossier est désormais
    // identifié par e-mail, sinon téléphone, sinon nom (cf.
    // utils/dossierKey), et le pro peut ajouter l'adresse ensuite. Seules
    // les absences n'en ont pas — elles n'ont pas de client.
    if (dossierBtn) {
      if (d.isBlock !== "1") {
        dossierBtn.href = `/clients-hub/${currentId}?tab=dossier`;
        dossierBtn.style.display = "";
      } else {
        dossierBtn.style.display = "none";
      }
    }

    // Position BEFORE showing (offsetHeight works because visibility:hidden keeps layout)
    positionPopup(card);

    // Show via CSS class (no inline opacity override — CSS handles it)
    popup.classList.add("open");
  }

  /* ── Modification rapide d'un rendez-vous ─────────────────────────────────
     Ouverte depuis le popover. Enregistre via PATCH /history/edit/:id — le
     même point d'entrée que la fiche client, donc mêmes droits, même synchro
     Google Agenda. Avant d'enregistrer, on demande au serveur si le nouveau
     créneau est occupé : si oui, même question qu'à la création (« placer
     quand même ? »), et le rendez-vous part marqué `overbooked`. */
  const qe = {
    overlay:  document.getElementById("quickEditOverlay"),
    who:      document.getElementById("quickEditWho"),
    date:     document.getElementById("quickEditDate"),
    start:    document.getElementById("quickEditStart"),
    end:      document.getElementById("quickEditEnd"),
    duration: document.getElementById("quickEditDuration"),
    employee: document.getElementById("quickEditEmployee"),
    error:    document.getElementById("quickEditError"),
    submit:   document.getElementById("quickEditSubmit"),
  };
  let qeId = null;

  function minutesDe(hhmm) {
    const [h, m] = String(hhmm || "").split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  }
  function majDuree() {
    if (!qe.duration) return;
    const d = minutesDe(qe.end.value) - minutesDe(qe.start.value);
    qe.duration.textContent = d > 0 ? `${d} min` : "—";
  }
  function qeErreur(msg) {
    if (!qe.error) return;
    qe.error.textContent = msg || "";
    qe.error.style.display = msg ? "" : "none";
  }
  function fermerModifRapide() {
    if (qe.overlay) qe.overlay.classList.remove("show");
    qeId = null;
  }
  function ouvrirModifRapide(info) {
    if (!qe.overlay) return;
    qeId = info.id;
    qe.who.textContent = info.qui || "";
    qe.date.value = info.date || "";
    qe.start.value = info.start || "";
    qe.end.value = info.end || "";
    if (qe.employee) qe.employee.value = info.employeeId || "";
    // Durée conservée quand on déplace le début : c'est presque toujours ce
    // qu'on veut (« finalement 10h15 au lieu de 10h »), et ça évite de
    // ressaisir la fin à chaque fois.
    qe.start.dataset.duree = String(minutesDe(info.end) - minutesDe(info.start));
    qeErreur("");
    majDuree();
    qe.overlay.classList.add("show");
    setTimeout(() => qe.start && qe.start.focus(), 50);
  }

  if (qe.overlay) {
    qe.start.addEventListener("input", () => {
      const duree = Number(qe.start.dataset.duree);
      const debut = minutesDe(qe.start.value);
      if (duree > 0 && Number.isFinite(debut)) {
        const fin = debut + duree;
        qe.end.value = `${String(Math.floor(fin / 60) % 24).padStart(2, "0")}:${String(fin % 60).padStart(2, "0")}`;
      }
      majDuree();
    });
    qe.end.addEventListener("input", () => {
      // Modifier la fin à la main redéfinit la durée pour la suite.
      const d = minutesDe(qe.end.value) - minutesDe(qe.start.value);
      if (d > 0) qe.start.dataset.duree = String(d);
      majDuree();
    });
    document.getElementById("quickEditClose")?.addEventListener("click", fermerModifRapide);
    document.getElementById("quickEditCancel")?.addEventListener("click", fermerModifRapide);
    qe.overlay.addEventListener("click", (e) => { if (e.target === qe.overlay) fermerModifRapide(); });

    qe.submit.addEventListener("click", async () => {
      const date = qe.date.value, startTime = qe.start.value, endTime = qe.end.value;
      const employeeId = qe.employee ? qe.employee.value : "";
      if (!date || !startTime || !endTime) return qeErreur("Date, début et fin sont obligatoires.");
      if (minutesDe(endTime) <= minutesDe(startTime)) return qeErreur("L'heure de fin doit être après l'heure de début.");

      qe.submit.disabled = true;
      qeErreur("");
      try {
        // 1) Le créneau visé est-il déjà pris ? (hors ce rendez-vous lui-même)
        let forcerSurRdv = false;
        const q = new URLSearchParams({ date, startTime, endTime, employeeId });
        const verif = await fetch(`/history/edit/${qeId}/conflicts?${q}`).then((r) => r.json()).catch(() => ({ hasConflict: false }));
        if (verif.hasConflict) {
          const ok = await window.confirmModal(
            "Créneau déjà occupé",
            "Un autre rendez-vous occupe ce créneau. Êtes-vous sûr de vouloir continuer ? Le rendez-vous sera placé par-dessus.",
            { confirmLabel: "Oui, placer quand même", cancelLabel: "Non, annuler", danger: true, icon: "warning" }
          ).catch(() => false);
          if (!ok) { qe.submit.disabled = false; return; }
          forcerSurRdv = true;
        }
        // 2) Enregistrer
        const res = await fetch(`/history/edit/${qeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, startTime, endTime, employeeId, forcerSurRdv }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          qe.submit.disabled = false;
          return qeErreur(data.message || data.error || "Le rendez-vous n'a pas pu être modifié.");
        }
        window.location.reload();
      } catch (e) {
        qe.submit.disabled = false;
        qeErreur("Erreur réseau. Réessayez.");
      }
    });
  }

  /* ── Hide popup ── */
  function hidePopup() {
    popup.classList.remove("open");
    currentId = null;
  }

  /* ── Pill click → open popup ── */
  document.addEventListener("click", (e) => {
    const pill = e.target.closest(".appt-pill[data-id]");

    if (pill) {
      e.stopPropagation();
      // Toggle: same pill while open → close
      if (currentId === pill.dataset.id && popup.classList.contains("open")) {
        hidePopup();
      } else {
        showPopup(pill);
      }
      return;
    }

    // Click outside popup → close
    if (popup.classList.contains("open") && !popup.contains(e.target)) {
      hidePopup();
    }
  });

  // Action buttons
  closeBtn.addEventListener("click",  (e) => { e.stopPropagation(); hidePopup(); });

  if (deleteBtn) deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!currentId) return;
    const id = currentId;
    showDeleteConfirm({
      onConfirm: async (closeModal) => {
        try {
          const res  = await fetch(`/appointment/${id}/delete`, { method: "DELETE" });
          const data = await res.json();
          closeModal();
          if (data.success) { hidePopup(); window.location.reload(); }
          else alert(data.message || "Erreur lors de la suppression.");
        } catch (err) { closeModal(); console.error("Delete error:", err); }
      }
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hidePopup();
  });
};

export const initCalendarHeader = function () {
  const calendar = document.querySelector(".calendar");
  if (!calendar) return console.log("no calendar");

  const params = new URLSearchParams(window.location.search);

  let currentDate = params.get("date")
    ? new Date(params.get("date") + "T12:00:00")
    : new Date();

  // Helper: navigate to date preserving the employee filter
  function navigateTo(dateStr) {
    const emp = params.get("employee") || "all";
    window.location.href = `/appointment?date=${dateStr}&employee=${emp}`;
  }

  calendar.addEventListener("click", (e) => {
    const directionBtn = e.target.closest(".calendar__date-btn");
    if (!directionBtn) return;

    const direction = directionBtn.dataset.direction;
    const isMobile = window.matchMedia("(max-width: 819px)").matches;
    const step = isMobile ? 1 : 7;

    if (direction === "prev") currentDate.setDate(currentDate.getDate() - step);
    if (direction === "next") currentDate.setDate(currentDate.getDate() + step);

    navigateTo(currentDate.toISOString().split("T")[0]);
  });

  // Employee filter: reload page with selected employee
  const empSelect = document.getElementById("empFilterSelect");
  if (empSelect) {
    empSelect.addEventListener("change", () => {
      const dateStr = currentDate.toISOString().split("T")[0];
      window.location.href = `/appointment?date=${dateStr}&employee=${empSelect.value}`;
    });
  }
};
