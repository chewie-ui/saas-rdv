const history__actionsPanel = document.querySelector(".history__actions-panel");
const templateDialog = document.getElementById("templateDialog");
import { initDialog } from "../templates/dialog.js";
let idTransfer;

document.addEventListener("click", async (event) => {
  const rowDelete = event.target.closest(".history__actions-row.delete");
  const rowEdit   = event.target.closest(".history__actions-row.edit");
  const rowShow   = event.target.closest(".history__actions-row.show");

  if (rowEdit)  { location.href = `/history/edit/${idTransfer}`; return; }
  if (rowShow)  { location.href = `/appointement/${idTransfer}`; return; }

  if (rowDelete) {
    const tmp = templateDialog.content.cloneNode(true);
    tmp.querySelector("h2").textContent          = window.__t.delete_confirm_title;
    tmp.querySelector(".dialog__p").textContent  = window.__t.delete_confirm_desc;
    tmp.querySelector(".dialog__btn1").innerHTML = `<span>${window.__t.cancel}</span>`;
    tmp.querySelector(".dialog__btn2").innerHTML = `<span>${window.__t.confirm_delete}</span>`;
    document.querySelector("body").appendChild(tmp);

    const isTrue = await initDialog("/history", "DELETE", { id: idTransfer });
    if (isTrue) {
      document.querySelector(`tr[data-id="${idTransfer}"]`)?.remove();
    }
    return;
  }

  // Close panel on outside click
  if (history__actionsPanel && !event.target.closest(".history__actions-panel")) {
    history__actionsPanel.style.display = "none";
  }
});

/* ── Search (server-side) ──────────────────────────────────── */
const searchClient = document.getElementById("searchClient");
const tbody        = document.querySelector(".hist-table tbody");
let debounceTimer;

if (searchClient) {
  searchClient.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const v = searchClient.value.trim();
    debounceTimer = setTimeout(async () => {
      const res  = await fetch(`/history/search?client=${encodeURIComponent(v)}`);
      const data = await res.json();
      renderData(data.results);
    }, 300);
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
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">${(window.__t && window.__t.no_client_found) || "No results found"}</td></tr>`;
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
      <tr class="hist-row" data-id="${h._id}" data-status="${sk}" data-employee="${h.employeeId||""}">
        <td class="hist-td hist-td--client">
          <div class="hist-avatar av-${idx}">${initials}</div>
          <span class="hist-name">${h.name||""} ${h.surname||""}</span>
        </td>
        <td class="hist-td">${h.serviceName||"-"}</td>
        <td class="hist-td">${h.employeeName||"-"}</td>
        <td class="hist-td hist-td--mono">${dateStr}</td>
        <td class="hist-td">${dur}</td>
        <td class="hist-td">
          <span class="pill pill--${pc}">
            <span class="pill__dot"></span>${pl}
          </span>
        </td>
        <td class="hist-td hist-td--action">
          <a class="hist-open-btn" href="/history/edit/${h._id}">
            Open
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
              <path d="M5 12h14M13 6l6 6-6 6"/>
            </svg>
          </a>
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
    tr.innerHTML = `<td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted)">${(window.__t && window.__t.no_client_found) || "No results found"}</td>`;
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

/* ── Save button (edit page) ── */
const saveBtnEdit = document.getElementById("saveBtnEdit");

if (saveBtnEdit) {
  saveBtnEdit.addEventListener("click", async () => {
    const id = window.location.pathname.split("/").pop();
    const label = document.getElementById("saveBtnLabel");

    saveBtnEdit.classList.add("saving");

    const response = await fetch(`/history/edit/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: document.getElementById("editName")?.value || "",
        surname: document.getElementById("editSurname")?.value || "",
        email: document.getElementById("editEmail")?.value || "",
        phone: document.getElementById("editPhone")?.value || "",
        message: document.getElementById("editMessage")?.value || "",
        date: document.getElementById("editDate")?.value || "",
        startTime: document.getElementById("editStartTime")?.value || "",
        endTime: document.getElementById("editEndTime")?.value || "",
        status: document.getElementById("editStatus")?.value || "confirmed",
        adminNotes: document.getElementById("editAdminNotes")?.value || "",
        // legacy fields kept for backward compat
        fullName: (document.getElementById("editName")?.value || "") + " " + (document.getElementById("editSurname")?.value || ""),
      }),
    });

    saveBtnEdit.classList.remove("saving");

    const data = await response.json();
    if (data.success) {
      saveBtnEdit.classList.add("saved");
      if (label) label.textContent = (window.__t && window.__t.changes_saved) || "✓ Enregistré";
      setTimeout(() => {
        saveBtnEdit.classList.remove("saved");
        if (label) label.textContent = "Enregistrer";
      }, 2500);
    }
  });
}
