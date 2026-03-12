const uploadBtn = document.getElementById("uploadBtn");
const fileInput = document.getElementById("fileInput");
const avatarPreview = document.getElementById("avatarPreview");

if (uploadBtn && fileInput && avatarPreview) {
  uploadBtn.onclick = () => fileInput.click();

  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;

    avatarPreview.src = URL.createObjectURL(file);

    const formData = new FormData();

    formData.append("profilePicture", file);

    try {
      const response = fetch("/account/profile-picture", {
        method: "PATCH",
        body: formData,
      });

      console.log(await response);
    } catch (err) {
      console.error(err);
    }
  };
}

const saveChanges = document.getElementById("saveChanges");
const accountForm = document.querySelector(".account__form");

if (saveChanges && accountForm) {
  saveChanges.onclick = async function (e) {
    const fullName = document.getElementById("fullname").value;
    const email = document.getElementById("email").value;
    const phone = document.getElementById("phone").value;

    try {
      const response = await fetch(`/account/update-info`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, phone }),
      });

      console.log(await response);
    } catch (err) {
      console.error(err);
    }
  };
}

const socialContainer = document.querySelector(".social__container");

if (socialContainer) {
  socialContainer.onclick = async function (e) {
    const button = e.target.closest(".btn__social-save");

    if (button) {
      const box = button.closest(".social__box");

      const name = box.dataset.name;
      console.log(box.name);

      const value = box.querySelector("input").value;

      const response = await fetch("/account/update-social", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldName: name, fieldValue: value }),
      });

      console.log(await response);
    }
  };
}
