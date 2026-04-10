const validDigitalCode = document.getElementById("validDigitalCode");
const digitalCode = document.getElementById("digitalCode");
const emailOpen = document.getElementById("emailOpen");
const emailClose = document.getElementById("emailClose");
const email__editor = document.querySelector(".email__editor");
const emailInput = document.getElementById("email");
const templateDialog = document.getElementById("templateDialog");
const templatePrompt = document.getElementById("templatePrompt");

emailInput.onblur = function () {
  setTimeout(() => {
    emailInput.disabled = true;
    // Optionnel : on remet le style par défaut si tu l'avais changé
    emailInput.style.borderColor = "";
  }, 100);
};

if (validDigitalCode && digitalCode) {
  validDigitalCode.onclick = async function () {
    const response = await fetch(`/account/check-digital-code`, {
      method: "POST", // Plus sécurisé pour déclencher un envoi
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: digitalCode.value }),
    });
    const data = await response.json();
    if (data.success) {
      email__editor.classList.remove("open");
      emailInput.disabled = false;
      emailInput.focus();
    }
  };
}

if (emailOpen) {
  emailOpen.onclick = async function () {
    try {
      const tmp = templatePrompt.content.cloneNode(true);
      const dialogField = tmp.querySelector(".dialog__field");
      const parentPrompt = tmp.querySelector("#promptWrp");
      tmp.querySelector("h2").textContent = "Confirm your email";
      tmp.querySelector(".dialog__p").textContent =
        "Confirm youir emai land we gonna send you un code de verificatyion pour valdier ovotre identite";
      tmp.querySelector(".dialog__btn1").textContent = "Cancel";
      tmp.querySelector(".dialog__btn2").textContent = "Send code";
      function closePrompt() {
        parentPrompt.remove();
      }
      tmp.querySelector(".dialog__icon").onclick = closePrompt;
      tmp.querySelector(".dialog__btn1").onclick = closePrompt;
      const email = tmp.querySelector("input");

      tmp.querySelector(".dialog__btn2").onclick = async function () {
        console.log(email.value);
        const response = await fetch("/account/edit-email-confirmation", {
          method: "POST", // Plus sécurisé pour déclencher un envoi
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.value }),
        });
        const data = await response.json();
        console.log(data);

        if (data.success) {
          const existingError = document.querySelector(".error");
          if (existingError) {
            document.querySelector(".error").remove();
          }

          closePrompt();

          const tmp2 = templatePrompt.content.cloneNode(true);
          const secparentPrompt2 = tmp2.querySelector("#promptWrp");

          tmp2.querySelector("h2").textContent = "Enter verification code";
          tmp2.querySelector(".dialog__p").textContent =
            "Completet your verificationb code please";
          tmp2.querySelector(".dialog__btn1").textContent = "Cancel";
          tmp2.querySelector(".dialog__btn2").textContent = "Confirm";
          const closePrompt2 = () => {
            if (secparentPrompt2) {
              secparentPrompt2.remove();
            }
          };
          tmp2.querySelector(".dialog__icon").onclick = closePrompt2;
          tmp2.querySelector(".dialog__btn1").onclick = closePrompt2;
          const val = tmp2.querySelector("input").value;
          tmp2.querySelector(".dialog__btn2").onclick = async function () {
            closePrompt2();
            const response = await fetch("/account/verification/code", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ val: val.value }),
            });

            const data = await response.json();
            if (data.success) {
              const editEmailPopup = templatePrompt.content.cloneNode(true);
              const parent = editEmailPopup.querySelector("#promptWrp");
              const email = editEmailPopup.querySelector("input");
              const clsPrmp = () => {
                if (parent) {
                  parent.remove();
                }
              };

              editEmailPopup.querySelector("h2").textContent =
                "Enter new email";
              editEmailPopup.querySelector(".dialog__p").textContent =
                "enter your new email and it wiill be chagned";
              editEmailPopup.querySelector(".dialog__btn1").textContent =
                "Cancel";
              editEmailPopup.querySelector(".dialog__btn2").textContent =
                "Confirm";

              editEmailPopup.querySelector(".dialog__btn1").onclick = clsPrmp;
              editEmailPopup.querySelector(".dialog__icon").onclick = clsPrmp;

              editEmailPopup.querySelector(".dialog__btn2").onclick =
                async function () {
                  const response = await fetch("/account/edit/email", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: email.value }),
                  });

                  const data = await response.json();

                  if (data.success) {
                    location.reload();
                  } else {
                    
                  }
                };

              document.querySelector("body").appendChild(editEmailPopup);
            }
          };

          document.querySelector("body").appendChild(tmp2);
        } else {
          const existingError = document.querySelector(".error");

          // 2. Si elle existe, on l'enlève
          if (existingError) {
            existingError.remove();
          }

          // 3. On crée la nouvelle erreur
          const errorEl = document.createElement("div");
          errorEl.classList.add("error");
          errorEl.textContent = data.message;

          // 4. On l'affiche
          dialogField.after(errorEl);
        }
      };
      document.querySelector("body").appendChild(tmp);
    } catch (error) {
      console.error("Erreur réseau :", error);
    }
  };
}

if (emailClose) {
  emailClose.onclick = function () {
    email__editor.classList.remove("open");
  };
}
