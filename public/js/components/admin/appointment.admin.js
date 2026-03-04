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

  const params = new URLSearchParams(window.location.search);

  let currentDate = params.get("date")
    ? new Date(params.get("date"))
    : new Date();

  calendar.addEventListener("click", (e) => {
    const directionBtn = e.target.closest(".calendar__date-btn");
    if (!directionBtn) return;

    const direction = directionBtn.dataset.direction;

    if (direction === "prev") {
      currentDate.setDate(currentDate.getDate() - 7);
    }

    if (direction === "next") {
      currentDate.setDate(currentDate.getDate() + 7);
    }

    window.location.search = `?date=${currentDate.toISOString().split("T")[0]}`;
  });
};
