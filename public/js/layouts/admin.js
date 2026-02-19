document.addEventListener("DOMContentLoaded", () => {
  const switchCompany = document.getElementById("switchCompany");
  const action = switchCompany.querySelector(".button-company");
  const panel = switchCompany.querySelector(".sidebar-header__panel");

  document.addEventListener("click", (e) => {
    const target = e.target;
    if (action.contains(target)) {
      panel.classList.toggle("show");
      return;
    }

    if (!panel.contains(target) && !action.contains(target)) {
      panel.classList.remove("show");
    }

    const companyItem = target.closest(".company");

    if (companyItem) {
      console.log("new company:", companyItem.dataset.id);
      panel.classList.remove("show");
    }
  });
});
