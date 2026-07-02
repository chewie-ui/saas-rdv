const faq = document.querySelector(".faq");

if (faq) {
  faq.addEventListener("click", (event) => {
    const question = event.target.closest(".faq__question");
    if (!question) return;
    const wasOpen = question.classList.contains("open");
    document.querySelectorAll(".faq__question").forEach((q) => q.classList.remove("open"));
    question.classList.toggle("open", !wasOpen);
  });
}
