export default function () {
  const bookingWrapper = document.getElementById("bookingWrapper");
  const scheduleWrapper = document.getElementById("scheduleWrapper");
  const formStepWrapper = document.getElementById("formStepWrapper");

  if (!bookingWrapper) return;

  const backBtn = bookingWrapper.querySelector(".back-btn");

  if (!backBtn) return;

  backBtn.addEventListener("click", () => {
    bookingWrapper.classList.remove("show");
    // If form step exists and has questions rendered, go back to it
    if (formStepWrapper && formStepWrapper.querySelector(".form-step-question")) {
      formStepWrapper.classList.add("show");
    } else if (scheduleWrapper) {
      scheduleWrapper.classList.add("show");
    }
  });
}
