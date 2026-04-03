import initCalendar from "../components/index/calendar.index.js";
import initSchedule from "../components/index/schedule.index.js";
import initBooking from "../components/index/booking.index.js";

initBooking();
initSchedule();
initCalendar();

const cancelBooking = document.getElementById("cancelBooking");

if (cancelBooking) {
  cancelBooking.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (button) {
      location.href = `/${cancelBooking.dataset.id}`;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const templateDialog = document.getElementById("templateDialog");
  if (templateDialog) {
    const tmp = templateDialog.content.cloneNode(true);

    tmp.querySelector("h2").textContent = "Booking Cancelled";
    tmp.querySelector(".dialog__p").textContent =
      "Your appointment has been successfully cancelled. If this was a mistake, you can easily book a new session anytime.";
    tmp.querySelector(".dialog__btn1").style.display = "none";
    tmp.querySelector(".dialog__btn2").textContent = "Close";

    tmp.querySelector(".dialog__btn2").onclick = function () {
      location.href = "/" + tmp.querySelector(".dialog__wrapper").dataset.id;
    };

    document.querySelector("body").appendChild(tmp);
  }
});

document.addEventListener("click", (event) => {
  const isSelectMenu = event.target.closest(".selectmenu");
  const isSearchMenu = event.target.closest(".searchmenu");
  const langSelector = event.target.closest("#langSelector");

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
