const history__actionsPanel = document.querySelector(".history__actions-panel");
const templateDialog = document.getElementById("templateDialog");
import { initDialog } from "../templates/dialog.js";
let idTransfer;
document.addEventListener("click", async (event) => {
  const button = event.target.closest(".btn-icon.btn-panel");
  const rowDelete = event.target.closest(".history__actions-row.delete");
  const rowEdit = event.target.closest(".history__actions-row.edit");
  const rowShow = event.target.closest(".history__actions-row.show");

  if (rowEdit) {
    location.href = `/history/edit/${idTransfer}`;
  }

  if (rowShow) {
    location.href = `/appointement/${idTransfer}`;
  }

  if (rowDelete) {
    const tmp = templateDialog.content.cloneNode(true);

    tmp.querySelector("h2").textContent = window.__t.delete_confirm_title;
    tmp.querySelector(".dialog__p").textContent = window.__t.delete_confirm_desc;
    tmp.querySelector(".dialog__btn1").innerHTML = `<span>${window.__t.cancel}</span>`;
    tmp.querySelector(".dialog__btn2").innerHTML = `<span>${window.__t.confirm_delete}</span>`;

    document.querySelector("body").appendChild(tmp);

    const isTrue = await initDialog("/history", "DELETE", {
      id: idTransfer,
    });

    if (isTrue) {
      document.querySelector(`tr[data-id="${idTransfer}"]`).remove();
    }

    return;
  }

  if (button) {
    history__actionsPanel.style.display = "flex";

    const row = button.closest("tr") || button.closest(".history__card");
    idTransfer = row.dataset.id;

    const rect = button.getBoundingClientRect();
    const panelWidth = 200; // min-width du panel
    history__actionsPanel.style.top = `${rect.bottom + 5}px`;

    // Eviter que le panel sorte à droite de l'écran
    const rawLeft = rect.right - panelWidth;
    const safeLeft = Math.max(8, Math.min(rawLeft, window.innerWidth - panelWidth - 8));
    history__actionsPanel.style.left = `${safeLeft}px`;
    return;
  } else {
    history__actionsPanel.style.display = `none`;
    return;
  }
});

const searchClient = document.getElementById("searchClient");
const tbody = document.querySelector(".history__table tbody");
let debounceTimer;

if (searchClient) {
  searchClient.addEventListener("input", async () => {
    clearTimeout(debounceTimer);
    const v = searchClient.value.trim();
    debounceTimer = setTimeout(async () => {
      const response = await fetch(`/history/search?client=${encodeURIComponent(v)}`);
      const data = await response.json();

      renderData(data.results);
    }, 300);
  });
}

function renderData(appointments) {
  console.log(appointments);

  if (appointments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;max-width: none;">${(window.__t && window.__t.no_client_found) || "Aucun client trouvé"}</td></tr>`;
    return;
  }

  tbody.innerHTML = appointments
    .map(
      (h) => `
        <tr data-id="${h._id}">
            <td>${h.name} ${h.surname}</td>
            <td>${h.email}</td>
            <td>${h.phone}</td>
            <td>${new Date(h.date).toLocaleDateString("fr-FR")} | ${h.startTime}-${h.endTime}</td>
            <td>${h.message || ""}</td>
            <td style="padding:8px 1.5rem">
                <div class="${h.status}">${h.status === "canceled" ? window.__t.status_canceled : window.__t.status_confirmed}</div>
            </td>
            <td class="btn-td flex-c j-start">
                <button class="btn-icon flex-c btn-panel">
                    <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#e3e3e3"><path d="M480-160q-33 0-56.5-23.5T400-240q0-33 23.5-56.5T480-320q33 0 56.5 23.5T560-240q0 33-23.5 56.5T480-160Zm0-240q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm0-240q-33 0-56.5-23.5T400-720q0-33 23.5-56.5T480-800q33 0 56.5 23.5T560-720q0 33-23.5 56.5T480-640Z"/></svg>
                </button>
            </td>
        </tr>
    `,
    )
    .join("");
}

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
