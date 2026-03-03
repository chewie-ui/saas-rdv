export const initDeleteAppointment = function () {
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".appointment-action");
    if (!btn) return;

    const { link, method } = btn.dataset;

    try {
      const result = await fetch(link, { method });
      const data = await result.json();

      if (data.success) {
        location.href = "/appointment";
      } else {
        console.error("error");
      }
    } catch (err) {
      console.error("Network error", err);
    }
  });
};

export const initCalendarHeader = function () {
  const calendar = document.querySelector(".calendar");
  if (!calendar) return console.log("no calendar");

  let currentDate = new Date();
  calendar.addEventListener("click", async (e) => {
    const directionBtn = e.target.closest(".calendar__date-btn");
    console.log("no direction btn");
    if (!directionBtn) return;

    const direction = directionBtn.dataset.direction;

    if (direction === "prev") {
      currentDate.setDate(currentDate.getDate() - 7);
    } else if (direction === "next") {
      currentDate.setDate(currentDate.getDate() + 7);
    }

    window.location.search = `?date=${currentDate.toISOString()}`;

    // const res = await fetch(
    //   `/appointment/week-data?date=${currentDate.toISOString()}`,
    // );
    // const data = await res.json();

    // updateCalendar(data);

    // console.log(currentDate);
  });
};
