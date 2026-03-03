export default function () {
  const bookingWrapper = document.getElementById("bookingWrapper");
  const scheduleWrapper = document.getElementById("scheduleWrapper");

  if (!bookingWrapper) return;

  const backBtn = bookingWrapper.querySelector(".back-btn");

  if (!backBtn || !scheduleWrapper) return;

  backBtn.addEventListener("click", () => {
    bookingWrapper.classList.remove("show");
    scheduleWrapper.classList.add("show");
  });
}
