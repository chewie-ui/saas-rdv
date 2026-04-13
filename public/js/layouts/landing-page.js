const faq = document.querySelector(".faq");

if (faq) {
  faq.addEventListener("click", (event) => {
    const question = event.target.closest(".faq__question");
    const questions = document.querySelectorAll(".faq__question");
    questions.forEach((q) => q.classList.remove("open"));
    question.classList.toggle("open");
  });
}
