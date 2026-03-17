const getProPlan = document.getElementById("getProPlan");
const cancelSubscriptionPro = document.getElementById("cancelSubscriptionPro");

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

if (cancelSubscriptionPro) {
  cancelSubscriptionPro.onclick = async function (e) {
    e.preventDefault();

    if (!confirm("Are you sure you want to cancel your Pro plan?")) return;

    try {
      const response = await fetch("/account/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (data.success) {
        alert(
          "Your subscription has been set to cancel at the end of the billing period.",
        );
        window.location.reload(); // Pour mettre à jour l'affichage
      } else {
        alert("Error: " + data.error);
      }
    } catch (err) {
      console.error(err);
    }
  };
}
