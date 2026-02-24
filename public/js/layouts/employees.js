document.addEventListener("DOMContentLoaded", () => {
  const headerActions = document.querySelector(".header-actions");
  const tableBody = document.querySelector("#tableShowing tbody");
  const template = document.getElementById("requestRowTemplate");
  const thead = document.querySelector("#tableShowing thead");
  const requestHeaderTemplate = document.getElementById(
    "requestHeaderTemplate",
  );
  const employeeHeaderTemplate = document.getElementById(
    "employeeHeadTemplate",
  );
  if (!headerActions || !tableBody || !template) return;

  tableBody.addEventListener("click", async (e) => {
    const approveBtn = e.target.closest(".approve");
    const rejectBtn = e.target.closest(".reject:not(.fire-btn)");
    const fireBtn = e.target.closest(".fire-btn");

    if (!approveBtn && !rejectBtn && !fireBtn) return;

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
        // const res = await fetch(
        //   `/employees/requests/${requestId}/fire?companyId=${companyId}`,
        //   {
        //     method: "DELETE",
        //   },
        // );

        // const response = await res.json();
        // if (response.success) {
        //   row.remove();
        // }

        socket.emit("fired");
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
