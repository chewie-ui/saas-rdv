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
