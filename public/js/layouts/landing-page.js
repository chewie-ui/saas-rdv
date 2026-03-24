const faq = document.querySelector(".faq");

if (faq) {
  faq.addEventListener("click", (event) => {
    const question = event.target.closest(".faq__question");
    const questions = document.querySelectorAll(".faq__question");
    questions.forEach((q) => q.classList.remove("open"));
    question.classList.toggle("open");
  });
}

document.addEventListener("click", (event) => {
  const lang__selector = event.target.closest(".lang__selector");
  console.log(event.target);

  if (lang__selector) {
    const panel = lang__selector.querySelector(".lang__panel");
    panel.classList.toggle("open");
  } else {
    const panel = document.querySelector(".lang__panel");
    panel.classList.remove("open");
  }
});

function changeLanguage(lang) {
  console.log(lang);

  document.cookie = `user_lang=${lang}; path=/; max-age=${60 * 60 * 24 * 365}`;
  window.location.reload();
}
window.changeLanguage = changeLanguage;
