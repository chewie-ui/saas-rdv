const history__actionsPanel = document.querySelector(".history__actions-panel");
const templateDialog = document.getElementById("templateDialog");
import { initDialog } from "../templates/dialog.js";
let idTransfer;

document.addEventListener("click", async (event) => {
  const rowDelete  = event.target.closest(".history__actions-row.delete");
  const rowEdit    = event.target.closest(".history__actions-row.edit");
  const rowShow    = event.target.closest(".history__actions-row.show");
  const inlineDelete = event.target.closest(".hist-action-btn--danger");

  if (rowEdit)  { location.href = `/history/edit/${idTransfer}`; return; }
  if (rowShow)  { location.href = `/appointement/${idTransfer}`; return; }

  const deleteId = inlineDelete ? inlineDelete.dataset.delId : (rowDelete ? idTransfer : null);

  if (deleteId) {
    const tmp = templateDialog.content.cloneNode(true);
    tmp.querySelector("h2").textContent          = window.__t.delete_confirm_title;
    tmp.querySelector(".dialog__p").textContent  = window.__t.delete_confirm_desc;
    tmp.querySelector(".dialog__btn1").innerHTML = `<span>${window.__t.cancel}</span>`;
    tmp.querySelector(".dialog__btn2").innerHTML = `<span>${window.__t.confirm_delete}</span>`;
    document.querySelector("body").appendChild(tmp);

    const isTrue = await initDialog("/history", "DELETE", { id: deleteId });
    if (isTrue) {
      document.querySelector(`tr[data-id="${deleteId}"]`)?.remove();
      document.querySelector(`.hist-card-mobile[data-id="${deleteId}"]`)?.remove();
    }
    return;
  }

  // Close panel on outside click
  if (history__actionsPanel && !event.target.closest(".history__actions-panel")) {
    history__actionsPanel.style.display = "none";
  }
});

/* ── Select-all checkbox ───────────────────────────────────── */
const checkAll = document.getElementById("checkAll");
if (checkAll) {
  checkAll.addEventListener("change", () => {
    document.querySelectorAll(".hist-row input[type='checkbox']").forEach((cb) => {
      cb.checked = checkAll.checked;
    });
  });
  // Sync header checkbox when individual rows change
  document.addEventListener("change", (e) => {
    if (e.target.matches(".hist-row input[type='checkbox']")) {
      const all  = document.querySelectorAll(".hist-row input[type='checkbox']");
      const checked = document.querySelectorAll(".hist-row input[type='checkbox']:checked");
      checkAll.checked = all.length > 0 && checked.length === all.length;
      checkAll.indeterminate = checked.length > 0 && checked.length < all.length;
    }
  });
}

/* ── Search (server-side) ──────────────────────────────────── */
const searchClient = document.getElementById("searchClient");
const clearSearch  = document.getElementById("clearSearch");
const tbody        = document.querySelector(".hist-table tbody");
let debounceTimer;

if (searchClient) {
  searchClient.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const v = searchClient.value.trim();
    if (clearSearch) clearSearch.style.display = v ? "flex" : "none";
    debounceTimer = setTimeout(async () => {
      const res  = await fetch(`/history/search?client=${encodeURIComponent(v)}`);
      const data = await res.json();
      renderData(data.results);
    }, 300);
  });
}

if (clearSearch) {
  clearSearch.addEventListener("click", async () => {
    searchClient.value = "";
    clearSearch.style.display = "none";
    const res  = await fetch(`/history/search?client=`);
    const data = await res.json();
    renderData(data.results);
    searchClient.focus();
  });
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function pillClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "canceled" || s === "cancelled") return "cancelled";
  if (s === "no-show")  return "no-show";
  if (s === "completed") return "completed";
  return "confirmed";
}

function pillLabel(status) {
  const pc = pillClass(status);
  const t = window.__t || {};
  if (pc === "confirmed")  return t.status_confirmed || "Confirmed";
  if (pc === "cancelled")  return t.status_canceled  || "Cancelled";
  if (pc === "completed")  return t.status_completed || "Completed";
  return t.status_noshow || "No-show";
}

function avatarIdx(name, surname) {
  return (((name || "A").charCodeAt(0) + (surname || "A").charCodeAt(0)) % 8);
}

function renderData(appointments) {
  if (!tbody) return;

  if (!appointments || appointments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:48px 24px;color:var(--text-muted)">${(window.__t && window.__t.no_client_found) || "No results found"}</td></tr>`;
    return;
  }

  tbody.innerHTML = appointments.map((h) => {
    const initials = ((h.name||"").charAt(0) + (h.surname||"").charAt(0)).toUpperCase();
    const idx      = avatarIdx(h.name, h.surname);
    const d        = h.date ? new Date(h.date) : null;
    const dateStr  = d ? `${MONTHS[d.getMonth()]} ${d.getDate()}, ${h.startTime||""}` : "-";
    const sk       = (h.status || "confirmed").toLowerCase();
    const pc       = pillClass(sk);
    const pl       = pillLabel(sk);
    const dur      = h.slotTime ? `${h.slotTime} min` : "-";

    return `
      <tr class="hist-row" data-id="${h._id}" data-status="${sk}" data-employee="${h.employeeId||""}" data-date="${h.date ? new Date(h.date).toISOString().slice(0,10) : ""}">
        <td class="hist-td hist-td--check">
          <input type="checkbox" data-id="${h._id}">
        </td>
        <td class="hist-td hist-td--client" title="${h.name||""} ${h.surname||""}">
          <div class="hist-avatar av-${idx}">${initials}</div>
          <span class="hist-name">${h.name||""} ${h.surname||""}</span>
        </td>
        <td class="hist-td" title="${h.serviceName||""}">${h.serviceName||"-"}</td>
        <td class="hist-td" title="${h.employeeName||""}">${h.employeeName||"-"}</td>
        <td class="hist-td">${dateStr}</td>
        <td class="hist-td">${dur}</td>
        <td class="hist-td">
          <span class="pill pill--${pc}">
            <span class="pill__dot"></span>${pl}
          </span>
        </td>
        <td class="hist-td hist-td--action">
          <div class="hist-row-actions">
            <a class="hist-action-btn" href="/history/edit/${h._id}" title="Voir">
              <span class="material-symbols-outlined">edit</span>
            </a>
            <button class="hist-action-btn hist-action-btn--danger" type="button" data-del-id="${h._id}" title="Supprimer">
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
        </td>
      </tr>`;
  }).join("");
}

/* ── Client-side filters (status + employee) ────────────────── */
const statusFilter = document.getElementById("statusFilter");
const empFilter    = document.getElementById("empFilterHist");
const dateFilter   = document.getElementById("dateFilter");

function applyClientFilters() {
  const statusVal = statusFilter ? statusFilter.value : "all";
  const empVal    = empFilter    ? empFilter.value    : "all";
  const daysVal   = dateFilter   ? parseInt(dateFilter.value) || 0 : 0;
  const cutoff    = daysVal && daysVal !== 0 ? Date.now() - daysVal * 86400000 : 0;

  const filtersActive = statusVal !== "all" || empVal !== "all";

  const rows = document.querySelectorAll(".hist-row");
  let visibleCount = 0;

  rows.forEach((row) => {
    const matchStatus = statusVal === "all" || row.dataset.status === statusVal;
    const matchEmp    = empVal    === "all" || row.dataset.employee === empVal;
    const rowDate     = row.dataset.date ? new Date(row.dataset.date).getTime() : Infinity;
    const matchDate   = !cutoff || rowDate >= cutoff;
    const visible     = matchStatus && matchEmp && matchDate;
    row.style.display = visible ? "" : "none";
    if (visible) visibleCount++;
  });

  // Show "no results" row if all rows are hidden
  const noResultsRow = document.getElementById("histNoResults");
  if (noResultsRow) {
    noResultsRow.style.display = visibleCount === 0 ? "" : "none";
  } else if (visibleCount === 0 && tbody) {
    const tr = document.createElement("tr");
    tr.id = "histNoResults";
    tr.innerHTML = `<td colspan="8" style="text-align:center;padding:24px;color:var(--text-muted)">${(window.__t && window.__t.no_client_found) || "No results found"}</td>`;
    tbody.appendChild(tr);
  }

  // Hide server-side pagination when client filters are active
  // (page numbers are meaningless when rows are filtered client-side)
  const pagination = document.querySelector(".hist-pagination");
  if (pagination) {
    pagination.style.display = filtersActive ? "none" : "";
  }
}

if (statusFilter) statusFilter.addEventListener("change", applyClientFilters);
if (empFilter)    empFilter.addEventListener("change", applyClientFilters);
if (dateFilter)   dateFilter.addEventListener("change", applyClientFilters);

/* ── Status pills (edit page) ── */
const statusPills = document.querySelectorAll(".status-pill");
const editStatusInput = document.getElementById("editStatus");

if (statusPills.length && editStatusInput) {
  statusPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      const value = pill.dataset.value;
      editStatusInput.value = value;

      statusPills.forEach((p) => {
        p.classList.remove("active", "confirmed", "canceled");
      });

      pill.classList.add("active", value);
    });
  });
}

/* ── Service selector: show duration/price chips + auto end-time ── */
(function () {
  const svcSelect     = document.getElementById("editService");
  const startInput    = document.getElementById("editStartTime");
  const endInput      = document.getElementById("editEndTime");
  const chipsWrap     = document.getElementById("svcInfoChips");
  const durationChip  = document.getElementById("svcDurationChip");
  const durationLbl   = document.getElementById("svcDurationLabel");
  const priceChip     = document.getElementById("svcPriceChip");
  const priceLbl      = document.getElementById("svcPriceLabel");

  if (!svcSelect) return;

  function addMinutes(hhmm, mins) {
    if (!hhmm || !mins) return hhmm;
    const [h, m] = hhmm.split(":").map(Number);
    const total = h * 60 + m + mins;
    const nh = Math.floor(total / 60) % 24;
    const nm = total % 60;
    return String(nh).padStart(2, "0") + ":" + String(nm).padStart(2, "0");
  }

  function updateServiceInfo() {
    const opt      = svcSelect.selectedOptions[0];
    const duration = parseInt(opt?.dataset?.duration || "0", 10);
    const price    = opt?.dataset?.price;
    const hasInfo  = duration > 0 || (price !== undefined && price !== "");

    if (hasInfo && opt.value) {
      chipsWrap.style.display = "flex";
      if (duration > 0) {
        durationChip.style.display = "flex";
        durationLbl.textContent = duration >= 60
          ? `${Math.floor(duration / 60)}h${duration % 60 ? String(duration % 60).padStart(2, "0") : ""}  (${duration} min)`
          : `${duration} min`;
        // Auto-update end time
        if (startInput && endInput && startInput.value) {
          endInput.value = addMinutes(startInput.value, duration);
        }
      } else {
        durationChip.style.display = "none";
      }
      if (price !== undefined && price !== "") {
        priceChip.style.display = "flex";
        priceLbl.textContent = parseFloat(price).toFixed(2).replace(".", ",") + " €";
      } else {
        priceChip.style.display = "none";
      }
    } else {
      chipsWrap.style.display = "none";
    }
  }

  function subtractMinutes(hhmm, mins) {
    if (!hhmm || !mins) return hhmm;
    const [h, m] = hhmm.split(":").map(Number);
    let total = h * 60 + m - mins;
    if (total < 0) total = 0;
    const nh = Math.floor(total / 60) % 24;
    const nm = total % 60;
    return String(nh).padStart(2, "0") + ":" + String(nm).padStart(2, "0");
  }

  svcSelect.addEventListener("change", updateServiceInfo);

  // Heure début → recalcule heure fin
  startInput?.addEventListener("change", () => {
    const opt = svcSelect.selectedOptions[0];
    const dur = parseInt(opt?.dataset?.duration || "0", 10);
    if (dur > 0 && endInput) endInput.value = addMinutes(startInput.value, dur);
  });

  // Heure fin → recalcule heure début
  endInput?.addEventListener("change", () => {
    const opt = svcSelect.selectedOptions[0];
    const dur = parseInt(opt?.dataset?.duration || "0", 10);
    if (dur > 0 && startInput) startInput.value = subtractMinutes(endInput.value, dur);
  });

  // Init on load
  updateServiceInfo();
})();

/* ── Conflict check helpers ── */
function collectPayload() {
  return {
    name:       document.getElementById("editName")?.value || "",
    surname:    document.getElementById("editSurname")?.value || "",
    email:      document.getElementById("editEmail")?.value || "",
    phone:      document.getElementById("editPhone")?.value || "",
    message:    document.getElementById("editMessage")?.value || "",
    date:       document.getElementById("editDate")?.value || "",
    startTime:  document.getElementById("editStartTime")?.value || "",
    endTime:    document.getElementById("editEndTime")?.value || "",
    status:     document.getElementById("editStatus")?.value || "confirmed",
    adminNotes: document.getElementById("editAdminNotes")?.value || "",
    serviceId:  document.getElementById("editService")?.value ?? undefined,
    serviceName: document.getElementById("editService")?.selectedOptions?.[0]?.dataset?.name ?? undefined,
    employeeId: document.getElementById("editEmployee")?.value ?? undefined,
    fullName:   (document.getElementById("editName")?.value || "") + " " + (document.getElementById("editSurname")?.value || ""),
  };
}

async function doSave(extraFields = {}) {
  const id    = window.__bookingId || window.location.pathname.split("/").pop();
  const label = document.getElementById("saveBtnLabel");
  const btn   = document.getElementById("saveBtnEdit");

  btn?.classList.add("saving");

  const response = await fetch(`/history/edit/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...collectPayload(), ...extraFields }),
  });

  btn?.classList.remove("saving");
  const data = await response.json();

  if (data.success) {
    btn?.classList.add("saved");
    if (label) label.textContent = "✓ Enregistré";
    setTimeout(() => {
      btn?.classList.remove("saved");
      if (label) label.textContent = "Enregistrer";
    }, 2500);
  }
}

/* ── Save button (edit page) ── */
const saveBtnEdit = document.getElementById("saveBtnEdit");

if (saveBtnEdit) {
  saveBtnEdit.addEventListener("click", async () => {
    const payload = collectPayload();
    const id      = window.__bookingId || window.location.pathname.split("/").pop();

    // Only check conflicts when there's a time + date
    if (payload.date && payload.startTime && payload.endTime) {
      try {
        const params = new URLSearchParams({
          date:       payload.date,
          startTime:  payload.startTime,
          endTime:    payload.endTime,
          employeeId: payload.employeeId || "",
        });
        const check = await fetch(`/history/edit/${id}/conflicts?${params}`);
        const result = await check.json();

        if (result.hasConflict) {
          // Show conflict modal
          const list = document.getElementById("conflictList");
          if (list) {
            list.innerHTML = result.conflicts.map(c =>
              `<li class="conflict-item">
                <span class="conflict-item__name">${c.name || "Client inconnu"}</span>
                <span class="conflict-item__time">${c.time}${c.service ? " · " + c.service : ""}</span>
              </li>`
            ).join("");
          }
          document.getElementById("conflictOverlay").style.display = "flex";
          return; // block save
        }
      } catch (e) {
        console.error("Conflict check failed:", e);
        // On network error, let the save proceed
      }
    }

    await doSave();
  });
}

/* ── Conflict modal buttons ── */
document.getElementById("conflictCancel")?.addEventListener("click", () => {
  document.getElementById("conflictOverlay").style.display = "none";
});

document.getElementById("conflictForce")?.addEventListener("click", async () => {
  document.getElementById("conflictOverlay").style.display = "none";
  await doSave({ forceDeleteConflicts: true });
});

// ── Custom date picker ────────────────────────────────────────────────────────
(function () {
  const trigger   = document.getElementById("datepickerTrigger");
  const popup     = document.getElementById("datepickerPopup");
  const hidden    = document.getElementById("editDate");
  const display   = document.getElementById("datepickerDisplay");
  const prevBtn   = document.getElementById("dpPrevMonth");
  const nextBtn   = document.getElementById("dpNextMonth");
  const monthLbl  = document.getElementById("dpMonthLabel");
  const daysGrid  = document.getElementById("dpDays");

  if (!trigger || !popup || !hidden) return;

  const MONTHS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  const DAYS_FR   = ["lun.","mar.","mer.","jeu.","ven.","sam.","dim."];

  // Parse initial value (YYYY-MM-DD)
  function parseHidden() {
    const v = hidden.value;
    if (v) {
      const [y, m, d] = v.split("-").map(Number);
      return { y, m: m - 1, d };
    }
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
  }

  let sel = parseHidden();
  let cur = { y: sel.y, m: sel.m };

  function formatDisplay(y, m, d) {
    const date = new Date(y, m, d);
    return date.toLocaleDateString("fr-FR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function renderCalendar() {
    monthLbl.textContent = MONTHS_FR[cur.m] + " " + cur.y;
    daysGrid.innerHTML = "";

    const firstDay = new Date(cur.y, cur.m, 1);
    // Monday = 0
    let startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(cur.y, cur.m + 1, 0).getDate();
    const daysInPrev  = new Date(cur.y, cur.m, 0).getDate();

    // Previous month filler
    for (let i = 0; i < startOffset; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dp-day dp-day--other";
      btn.textContent = daysInPrev - startOffset + 1 + i;
      btn.disabled = true;
      daysGrid.appendChild(btn);
    }

    // Current month
    const today = new Date();
    for (let d = 1; d <= daysInMonth; d++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dp-day";
      btn.textContent = d;

      const isToday = today.getFullYear() === cur.y && today.getMonth() === cur.m && today.getDate() === d;
      const isSel   = sel.y === cur.y && sel.m === cur.m && sel.d === d;

      if (isToday) btn.classList.add("dp-day--today");
      if (isSel)   btn.classList.add("dp-day--selected");

      btn.addEventListener("click", () => {
        sel = { y: cur.y, m: cur.m, d };
        hidden.value   = `${cur.y}-${pad(cur.m + 1)}-${pad(d)}`;
        display.textContent = formatDisplay(cur.y, cur.m, d);
        popup.style.display = "none";
        renderCalendar();
      });

      daysGrid.appendChild(btn);
    }

    // Next month filler
    const total = startOffset + daysInMonth;
    const remaining = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let i = 1; i <= remaining; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dp-day dp-day--other";
      btn.textContent = i;
      btn.disabled = true;
      daysGrid.appendChild(btn);
    }
  }

  function positionPopup() {
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const popupH = 320; // approx popup height

    if (spaceBelow >= popupH || spaceBelow >= spaceAbove) {
      // Open below
      popup.style.top  = (rect.bottom + 6) + "px";
      popup.style.bottom = "auto";
    } else {
      // Open above
      popup.style.bottom = (window.innerHeight - rect.top + 6) + "px";
      popup.style.top    = "auto";
    }
    popup.style.left  = Math.min(rect.left, window.innerWidth - 298) + "px";
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = popup.style.display !== "none";
    if (isOpen) {
      popup.style.display = "none";
    } else {
      // Reset to the selected date's month on every open
      cur = { y: sel.y, m: sel.m };
      popup.style.display = "block";
      positionPopup();
      renderCalendar();
    }
  });

  prevBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    cur.m--;
    if (cur.m < 0) { cur.m = 11; cur.y--; }
    renderCalendar();
  });

  nextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    cur.m++;
    if (cur.m > 11) { cur.m = 0; cur.y++; }
    renderCalendar();
  });

  document.addEventListener("click", (e) => {
    if (!trigger.contains(e.target) && !popup.contains(e.target)) {
      popup.style.display = "none";
    }
  });

  // Keep popup aligned when scrolling or resizing
  window.addEventListener("scroll", () => {
    if (popup.style.display !== "none") positionPopup();
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (popup.style.display !== "none") positionPopup();
  }, { passive: true });

  // Init display
  renderCalendar();
})();

/* ── Table height & lignes/page adaptées à l'écran ─────────────────────
   Le tableau ne doit jamais forcer un scroll de toute la page : .hist-card
   est borné à la hauteur dispo sous la nav (--hist-card-max-h) pour que la
   pagination reste toujours visible. En plus, au premier chargement "propre"
   (sans ?limit= dans l'URL), on mesure combien de lignes tiennent réellement
   et on redemande la page au serveur avec ce nombre — pour éviter le scroll
   interne dans la plupart des cas plutôt que juste le tolérer. */
(function adaptHistoryTableHeight() {
  const page = document.querySelector(".hist-page");
  const card = document.querySelector(".hist-card");
  const tableWrap = card ? card.querySelector(".hist-table-wrap") : null;
  if (!page || !card || !tableWrap) return;

  const MIN_ROWS = 5;
  const MAX_ROWS = 50;

  function applyMaxHeight() {
    if (window.innerWidth <= 819) {
      card.style.removeProperty("--hist-card-max-h");
      return null;
    }
    const top = card.getBoundingClientRect().top;
    const bottomMargin = 24; // marge basse de .main-wrapper
    const available = Math.max(window.innerHeight - top - bottomMargin, 240);
    card.style.setProperty("--hist-card-max-h", `${available}px`);
    return available;
  }

  const available = applyMaxHeight();
  window.addEventListener("resize", applyMaxHeight, { passive: true });

  if (available == null) return;

  const url = new URL(location.href);
  if (url.searchParams.has("limit")) return; // déjà ajusté (lien de pagination ou reload)

  const totalBookings = parseInt(page.dataset.totalBookings, 10) || 0;
  const currentLimit = parseInt(page.dataset.currentLimit, 10) || 13;
  if (totalBookings <= MIN_ROWS) return;

  const cardTopEl = card.querySelector(".hist-card__top");
  const headerRow = tableWrap.querySelector("thead tr");
  const sampleRow = tableWrap.querySelector("tbody tr.hist-row");
  const paginationEl = card.querySelector(":scope > .hist-pagination");
  if (!headerRow || !sampleRow) return;

  // `available` couvre toute la carte (filtres + tableau + pagination) — il
  // faut retirer la barre de filtres (.hist-card__top) en plus de l'en-tête
  // du tableau et de la pagination pour obtenir l'espace réel dispo pour
  // les lignes, sinon on surestime et la dernière ligne déborde.
  const cardTopH = cardTopEl ? cardTopEl.getBoundingClientRect().height : 0;
  const headerH = headerRow.getBoundingClientRect().height;
  const rowH = sampleRow.getBoundingClientRect().height;
  const paginationH = paginationEl ? paginationEl.getBoundingClientRect().height : 0;
  if (!rowH) return;

  const bodyAvailable = available - cardTopH - headerH - paginationH;
  const idealRows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.floor(bodyAvailable / rowH)));

  // Écart minime (arrondis) : pas la peine de recharger la page pour ça.
  if (Math.abs(idealRows - currentLimit) >= 2) {
    url.searchParams.set("limit", idealRows);
    url.searchParams.set("page", "1");
    location.replace(url.toString());
  }
})();
