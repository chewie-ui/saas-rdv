document.addEventListener("click", (event) => {
  const isSelectMenu = event.target.closest(".selectmenu");
  const isSearchMenu = event.target.closest(".searchmenu");
  const langSelector = event.target.closest("#langSelector");

  // ── Dropdown langue (topbar + sidebar) ──
  const headerLang = event.target.closest(".header__lang");
  if (headerLang) {
    headerLang.classList.toggle("open");
  }
  // Fermer si clic ailleurs
  document.querySelectorAll(".header__lang").forEach(el => {
    if (el !== headerLang) el.classList.remove("open");
  });

  if (langSelector) {
    langSelector.classList.toggle("open");
  }

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

  document.querySelectorAll(".selectmenu, #langSelector").forEach((menu) => {
    if (menu !== isSelectMenu && menu !== langSelector) {
      menu.classList.remove("open");
    }
  });
});

function changeLanguage(lang) {
  console.log(lang);

  document.cookie = `user_lang=${lang}; path=/; max-age=${60 * 60 * 24 * 365}`;
  window.location.reload();
}
window.changeLanguage = changeLanguage;
