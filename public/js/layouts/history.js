const history__actionsPanel = document.querySelector(".history__actions-panel");
const templateDialog = document.getElementById("templateDialog");
import { initDialog } from "../templates/dialog.js";
let idTransfer;
document.addEventListener("click", async (event) => {
  const button = event.target.closest(".btn-icon");
  const rowDelete = event.target.closest(".history__actions-row.delete");

  if (rowDelete) {
    const tmp = templateDialog.content.cloneNode(true);

    tmp.querySelector("h2").textContent = "Delete confirmation";
    tmp.querySelector(".dialog__p").textContent =
      "If you confoirm this is gonna be derelteld and you dgonna have no backup";
    tmp.querySelector(".dialog__btn1").textContent = "Cancel";
    tmp.querySelector(".dialog__btn2").textContent = "Confirm delete";

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

    idTransfer = button.closest("tr").dataset.id;

    const rect = button.getBoundingClientRect();
    const panelWidth = history__actionsPanel.offsetWidth;
    history__actionsPanel.style.top = `${rect.bottom + window.scrollY + 5}px`;

    history__actionsPanel.style.left = `${rect.right + window.scrollX - panelWidth}px`;
    return;
  } else {
    history__actionsPanel.style.display = `none`;
    return;
  }
});
