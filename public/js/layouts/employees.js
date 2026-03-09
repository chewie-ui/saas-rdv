document.addEventListener("DOMContentLoaded", () => {
  const headerActions = document.querySelector(".header-actions");
  const tableBody = document.querySelector("#tableShowing tbody");
  const template = document.getElementById("requestRowTemplate");
  const thead = document.querySelector("#tableShowing thead");
  const requestHeaderTemplate = document.getElementById(
    "requestHeaderTemplate",
  );

  if (!headerActions || !tableBody) return;

  tableBody.addEventListener("change", async (e) => {
    const selectRole = e.target.closest(".select-role");
    if (!selectRole) return;

    const row = selectRole.closest("tr");
    const userId = row.dataset.id;
    const newRole = selectRole.value;

    try {
      await fetch(`/employees/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
    } catch (err) {
      console.error(err);
    }
  });

  tableBody.addEventListener("click", async (e) => {
    const setNewOwner = e.target.closest(".set-new-owner");
    const approveBtn = e.target.closest(".approve");
    const rejectBtn = e.target.closest(".reject:not(.fire-btn)");
    const fireBtn = e.target.closest(".fire-btn");
    const selectRole = e.target.closest(".select-role");
    console.log(e.target);

    if (!approveBtn && !rejectBtn && !fireBtn && !selectRole && !setNewOwner)
      return;

    const row = e.target.closest("tr");
    const requestId = row.dataset.id;

    try {
      if (approveBtn) {
        await fetch(`/employees/requests/${requestId}/approve`, {
          method: "PATCH",
        });
        row.remove();
      }
      if (rejectBtn) {
        await fetch(`/employees/requests/${requestId}/reject`, {
          method: "DELETE",
        });
        row.remove();
      }

      if (fireBtn) {
        const confirmPopup = document.querySelector(".confirm-popup");
        confirmPopup.dataset.type = "fire-employee";
        confirmPopup.dataset.requestId = row.dataset.id;
        confirmPopup.classList.add("show");
        confirmPopup.querySelector(".confirm-popup__title").innerHTML =
          `Terminate Employee Account?`;
        confirmPopup.querySelector(".confirm-popup__description").innerHTML =
          `This action cannot be undone. All associated data and access for this user will be permanently revoked.`;
        confirmPopup.addEventListener("click", (e) => {
          if (confirmPopup.querySelector(".confirm-btn").contains(e.target))
            confirmPopup.classList.remove("show");
          row.remove();
        });
      }

      if (setNewOwner) {
        const confirmPopup = document.querySelector(".confirm-popup");
        confirmPopup.dataset.type = "transfer-owner";
        confirmPopup.dataset.userId = row.dataset.id;
        confirmPopup.classList.add("show");
        confirmPopup.querySelector(".confirm-popup__title").innerHTML =
          `Transfer company ownership?`;
        confirmPopup.querySelector(".confirm-popup__description").innerHTML =
          `This action will transfer ownership of the company to another user. You will no longer be the owner and your role will change to admin, which may limit your permissions.`;
      }
    } catch (err) {
      console.error(er);
    }
  });

  headerActions.addEventListener("click", async (e) => {
    const requestSwitcher = e.target.closest("#requestSwitcher");
    const addEmployeeSwitcher = e.target.closest("#addEmployeeSwitcher");

    if (requestSwitcher) {
      try {
        const res = await fetch(`/employees/requests?companyId=${companyId}`);
        const requests = await res.json();

        thead.innerHTML = "";
        thead.appendChild(requestHeaderTemplate.content.cloneNode(true));

        const results = requests.result;

        tableBody.innerHTML = "";

        results.forEach((req, index) => {
          const clone = template.content.cloneNode(true);
          clone.querySelector("tr").dataset.id = req._id;
          clone.querySelector(".index").textContent = index + 1;
          clone.querySelector(".fullName").textContent = req.user.fullName;
          clone.querySelector(".status").textContent = "Pending";
          clone.querySelector(".email").textContent = req.user.email;

          tableBody.appendChild(clone);
        });
      } catch (err) {
        console.error(err);
      }
      return;
    }

    if (addEmployeeSwitcher) {
      location.reload();
    }
  });
});
