export default function () {
  const scheduleWrapper = document.getElementById("scheduleWrapper");

  if (!scheduleWrapper) return;

  const backBtn = scheduleWrapper.querySelector(".back-btn");

  if (!backBtn) return;

  backBtn.addEventListener("click", () => {
    scheduleWrapper.classList.remove("show");
  });
}
