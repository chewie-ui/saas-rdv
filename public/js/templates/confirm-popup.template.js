const popupContainer = document.querySelector(".confirm-popup");

if (popupContainer) {
  popupContainer.addEventListener("click", async (e) => {
    const cancelBtn = e.target.closest(".cancel-btn");
    const confirmBtn = e.target.closest(".confirm-btn");

    if (!cancelBtn && !confirmBtn) return;

    if (cancelBtn) {
      popupContainer.classList.remove("show");
    }

    if (confirmBtn) {
      const type = popupContainer.dataset.type;

      if (!type) return;

      if (type === "transfer-owner") {
        try {
          const userId = popupContainer.dataset.userId;
          const res = await fetch(`/company/transfer-owner`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              newOwnerId: userId,
            }),
          });

          location.reload();
        } catch (e) {
          return console.error(e);
        }
      } else if (type === "fire-employee") {
        const requestId = popupContainer.dataset.requestId;
        const res = await fetch(`/employees/requests/${requestId}/fire`, {
          method: "DELETE",
        });

        const response = await res.json();
        if (response.success) {
          return true;
        }
      }
    }
  });
}
