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
