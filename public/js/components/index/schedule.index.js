export default function () {
  const scheduleWrapper = document.getElementById("scheduleWrapper");
  const backBtn = scheduleWrapper.querySelector(".back-btn");

  backBtn.addEventListener("click", () => {
    scheduleWrapper.classList.remove("show");
  });
}
