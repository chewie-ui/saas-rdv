const getProPlan = document.getElementById("getProPlan");
const cancelSubscriptionPro = document.getElementById("cancelSubscriptionPro");
const getFreePlan = document.getElementById("getFreePlan");

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
if (cancelSubscriptionPro)
  cancelSubscriptionPro.onclick = handleSubscriptionCancel;
if (getFreePlan) getFreePlan.onclick = handleSubscriptionCancel;
