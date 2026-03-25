const passwordOpen = document.getElementById("passwordOpen");
const passwordClose = document.getElementById("passwordClose");
const password__editor = document.querySelector(".password__editor");

if (passwordClose) {
  passwordClose.onclick = function () {
    password__editor.classList.remove("open");
  };
}

if (passwordOpen) {
  passwordOpen.onclick = function () {
    location.href = "/forgot-password";
  };
}
