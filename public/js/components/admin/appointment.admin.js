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
  const editBtn    = document.getElementById("apptPopupEdit");
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

    // Edit / detail links — "Voir le détail" mène à la page d'édition d'un
    // vrai RDV (nom, email...) : ça n'a pas de sens pour un bloc d'absence,
    // qui n'a pas de client.
    if (editBtn) editBtn.onclick = () => { window.location.href = `/clients-hub/${currentId}?edit=1`; };
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
            hidePopup();
            if (typeof window.__openBlockApptEdit === "function") {
              window.__openBlockApptEdit({
                id: currentId,
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

    // Dossier client → fiche clients-hub, onglet « Dossier » (et non plus
    // l'ancienne page /clients/:email). Caché si pas d'email (événement
    // "autre" sans client, ou dossier impossible à tenir sans email).
    if (dossierBtn) {
      if (d.email && d.isBlock !== "1") {
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
