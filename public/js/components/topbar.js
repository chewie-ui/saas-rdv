document.addEventListener("DOMContentLoaded", () => {
  const header = document.querySelector(".header");
  const headerPhone = document.querySelector(".header-phone");

  if (!header || !header.classList.contains("sticky")) {
    window.addEventListener("scroll", () => {
      if (header) header.classList.toggle("sticky", window.scrollY > 0);
      if (headerPhone) headerPhone.classList.toggle("sticky", window.scrollY > 0);
    });
  }

  // Close mobile nav when a link inside is clicked
  const headerNavToggle = document.getElementById("headerNavToggle");
  if (headerNavToggle) {
    document.querySelectorAll(".header .menu a").forEach((link) => {
      link.addEventListener("click", () => {
        headerNavToggle.checked = false;
      });
    });
  }
});
