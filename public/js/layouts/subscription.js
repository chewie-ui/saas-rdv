const getProPlan = document.getElementById("getProPlan");
const cancelSubscriptionPro = document.getElementById("cancelSubscriptionPro");
const getFreePlan = document.getElementById("getFreePlan");
const retakeSubscription = document.getElementById("retakeSubscription");

const templateDialog = document.getElementById("templateDialog");

if (getProPlan) {
  getProPlan.onclick = async function () {
    const response = await fetch(`/account/create-checkout`, {
      method: "POST",
    });

    const data = await response.json();
    console.log(data);

    window.location = data.url;
  };
}

// On crée la fonction une seule fois
const handleSubscriptionCancel = async function (e) {
  e.preventDefault();

  const confirmCancel = () => {
    return new Promise((resolve) => {
      const tmp = templateDialog.content.cloneNode(true);
      const parentTmp = tmp.querySelector("#dialogWrp");
      const close = (value) => {
        parentTmp.remove();
        resolve(value); // On "répond" à la promesse avec true ou false
      };

      tmp.querySelector(".dialog__h2").textContent = "Stop pro plan";
      tmp.querySelector(".dialog__p").textContent = "Are you sure you want to stop your pro plan?";
      tmp.querySelector(".dialog__btn2").innerHTML = `<span>Confirm</span>`;
      tmp.querySelector(".dialog__btn1").innerHTML = `<span>Close</span>`;
      tmp.querySelector(".dialog__btn1").onclick = () => close(false);
      tmp.querySelector(".dialog__icon").onclick = () => close(false);

      tmp.querySelector(".dialog__btn2").onclick = () => close(true);

      document.querySelector("body").appendChild(tmp);
    });
  };

  const isConfirmed = await confirmCancel();

  if (!isConfirmed) return;

  try {
    const response = await fetch("/account/cancel-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const data = await response.json();

    if (data.success) {
      alert("Your subscription has been set to cancel at the end of the billing period.");
      window.location.reload();
    } else {
      alert("Error: " + data.error);
    }
  } catch (err) {
    console.error("Fetch error:", err);
    alert("An error occurred. Please try again.");
  }
};

// On attache la fonction aux boutons s'ils existent dans la page
if (cancelSubscriptionPro) cancelSubscriptionPro.onclick = handleSubscriptionCancel;
if (getFreePlan) getFreePlan.onclick = handleSubscriptionCancel;

if (retakeSubscription) {
  retakeSubscription.onclick = async function (e) {
    e.preventDefault();

    const confirmRestore = () => {
      return new Promise((resolve) => {
        const tmp = templateDialog.content.cloneNode(true);
        const parent = tmp.querySelector("#dialogWrp");

        const close = (value) => {
          parent.remove();
          resolve(true);
        };

        tmp.querySelector(".dialog__h2").textContent = "Restore pro plan";
        tmp.querySelector(".dialog__p").textContent = "Are you sure you want to restore your pro plan?";
        tmp.querySelector(".dialog__btn2").innerHTML = `<span>Confirm</span>`;
        tmp.querySelector(".dialog__btn1").innerHTML = `<span>Close</span>`;
        tmp.querySelector(".dialog__btn1").onclick = () => close(false);
        tmp.querySelector(".dialog__icon").onclick = () => close(false);

        tmp.querySelector(".dialog__btn2").onclick = () => close(true);

        document.querySelector("body").appendChild(tmp);
      });
    };

    const ifConfirmed = await confirmRestore();

    if (ifConfirmed) {
      const response = await fetch(`/subscription/resume`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const data = await response.json();

      if (data.success) {
        alert(data.message);
        location.reload();
      }
    }
  };
}
