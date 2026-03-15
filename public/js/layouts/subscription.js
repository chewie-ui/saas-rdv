const getProPlan = document.getElementById("getProPlan");

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
