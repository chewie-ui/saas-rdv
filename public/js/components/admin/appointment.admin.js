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
        alert(data.message);
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
    ? new Date(params.get("date") + "T12:00:00")
    : new Date();

  // Helper: navigate to date preserving the employee filter
  function navigateTo(dateStr) {
    const emp = params.get("employee") || "all";
    window.location.href = `/appointment?date=${dateStr}&employee=${emp}`;
  }

  calendar.addEventListener("click", (e) => {
    const directionBtn = e.target.closest(".calendar__date-btn");
    if (!directionBtn) return;

    const direction = directionBtn.dataset.direction;
    const isMobile = window.matchMedia("(max-width: 819px)").matches;
    const step = isMobile ? 1 : 7;

    if (direction === "prev") currentDate.setDate(currentDate.getDate() - step);
    if (direction === "next") currentDate.setDate(currentDate.getDate() + step);

    navigateTo(currentDate.toISOString().split("T")[0]);
  });

  // Employee filter: reload page with selected employee
  const empSelect = document.getElementById("empFilterSelect");
  if (empSelect) {
    empSelect.addEventListener("change", () => {
      const dateStr = currentDate.toISOString().split("T")[0];
      window.location.href = `/appointment?date=${dateStr}&employee=${empSelect.value}`;
    });
  }
};
