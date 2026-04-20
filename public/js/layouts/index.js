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

// document.addEventListener("DOMContentLoaded", () => {
//   const templateDialog = document.getElementById("templateDialog");
//   if (templateDialog) {
//     const tmp = templateDialog.content.cloneNode(true);

//     tmp.querySelector("h2").textContent = "Booking Cancelled";
//     tmp.querySelector(".dialog__p").textContent =
//       "Your appointment has been successfully cancelled. If this was a mistake, you can easily book a new session anytime.";
//     tmp.querySelector(".dialog__btn1").style.display = "none";
//     tmp.querySelector(".dialog__btn2").textContent = "Close";
//     console.log(tmp.querySelector(".dialog__wrapper"));
//     const dataID = tmp.querySelector(".dialog__wrapper").dataset.id;
//     tmp.querySelector(".dialog__btn2").onclick = function () {
//       if (dataID) {
//         location.href = "/" + dataID;
//       } else {
//         location.href = "/";
//       }
//     };

//     document.querySelector("body").appendChild(tmp);
//   }
// });
