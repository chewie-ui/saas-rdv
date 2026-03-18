const forgotPwdSendCode = document.getElementById("forgotPwdSendCode");
const forgotPwdEmail = document.getElementById("forgotPwdEmail");
const secondFormTemplate = document.getElementById("secondFormTemplate");
const thirdFormTemplate = document.getElementById("thirdFormTemplate");
const container = document.querySelector(".auth-form__container");
const firstForm = document.querySelector(".first-form");
const digitalCode = document.getElementById("digitalCode");
let emailValue;
if (forgotPwdSendCode && forgotPwdEmail) {
  forgotPwdSendCode.onclick = async function () {
    firstForm.style.display = "none";

    const template = secondFormTemplate.content.cloneNode(true);
    container.appendChild(template);

    const value = forgotPwdEmail.value;
    emailValue = value;

    await fetch(`/forgot-password/verify-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        value,
      }),
    });
  };
}

container.addEventListener("click", async (e) => {
  const btn = e.target.closest("#checkDigitalCode");
  const parent = e.target.closest(".form-body");
  const input = parent.querySelector("input");
  const errorTxt = parent.querySelector(".error");
  if (btn) {
    const digitalCode = document.getElementById("digitalCode");
    const secondForm = document.querySelector(".second-form");

    const response = await fetch(`/forgot-password/check-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: digitalCode.value }),
    });

    const data = await response.json();

    if (data.success) {
      secondForm.style.display = "none";

      const clone = thirdFormTemplate.content.cloneNode(true);
      container.appendChild(clone);
    } else {
      input.classList.add("input-error");
      errorTxt.classList.remove("none");
      errorTxt.textContent = "Invalid code, please retry";

      errorTxt.classList.add("input-error-repeat");
      errorTxt.addEventListener("animationend", () => {
        errorTxt.classList.remove("input-error-repeat");
      });
    }
  }

  const btn2 = e.target.closest("#checkPasswords");

  if (btn2) {
    const parent2 = btn2.closest(".form-body");
    const newPwd = document.getElementById("password");
    const conformPwd = document.getElementById("conformPassword");

    if (newPwd.value === conformPwd.value) {
      const response = await fetch(`/forgot-password/new-password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPwd.value, email: emailValue }),
      });

      const data = await response.json();

      if (data.success) {
        location.href = "/login";
      }
    }
  }
});
