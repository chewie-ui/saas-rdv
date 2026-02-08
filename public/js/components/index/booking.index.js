export default function () {
  const bookingWrapper = document.getElementById("bookingWrapper");
  const scheduleWrapper = document.getElementById("scheduleWrapper");
  const backBtn = bookingWrapper.querySelector(".back-btn");

  backBtn.addEventListener("click", () => {
    bookingWrapper.classList.remove("show");
    scheduleWrapper.classList.add("show");
  });
}
