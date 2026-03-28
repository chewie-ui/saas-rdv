// document.addEventListener("DOMContentLoaded", () => {
//   const switchCompany = document.getElementById("switchCompany");
//   const action = switchCompany.querySelector(".button-company");
//   const panel = switchCompany.querySelector(".sidebar-header__panel");

//   document.addEventListener("click", (e) => {
//     const target = e.target;
//     if (action.contains(target)) {
//       panel.classList.toggle("show");
//       return;
//     }

//     if (!panel.contains(target) && !action.contains(target)) {
//       panel.classList.remove("show");
//     }

//     const companyItem = target.closest(".company");

//     if (companyItem) {
//       console.log("new company:", companyItem.dataset.id);
//       panel.classList.remove("show");
//     }
//   });
// });

const openMenu = document.getElementById("openMenu");
const closeSidebar = document.getElementById("closeSidebar");
const sidebar = document.querySelector(".sidebar");

if (openMenu && sidebar && closeSidebar) {
  openMenu.onclick = function (e) {
    sidebar.classList.add("open");
  };

  closeSidebar.onclick = function () {
    sidebar.classList.remove("open");
  };
}

document.addEventListener("click", (event) => {
  const isSelectMenu = event.target.closest(".selectmenu");
  const isSearchMenu = event.target.closest(".searchmenu");

  if (isSearchMenu) {
    isSearchMenu.querySelector("input").addEventListener("input", () => {
      if (isSearchMenu.querySelector("input").value.trim() !== "") {
        isSearchMenu
          .querySelector(".searchmenu__drop-icon")
          .classList.add("show");
      } else {
        isSearchMenu
          .querySelector(".searchmenu__drop-icon")
          .classList.remove("show");
      }
    });

    isSearchMenu.querySelector(".searchmenu__drop-icon").onclick = function () {
      isSearchMenu.querySelector("input").value = "";
      isSearchMenu
        .querySelector(".searchmenu__drop-icon")
        .classList.remove("show");
    };
  }

  if (isSelectMenu) {
    isSelectMenu.classList.toggle("open");
  }

  document.querySelectorAll(".selectmenu").forEach((selectmenu) => {
    if (selectmenu !== isSelectMenu) {
      selectmenu.classList.remove("open");
    }
  });
});
