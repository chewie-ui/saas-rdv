document.addEventListener("DOMContentLoaded", () => {
  const searchCompanyInput = document.getElementById("searchCompanyInput");
  const resultsWrapper = document.getElementById("resultsWrapper");

  let timeout = null;

  searchCompanyInput.addEventListener("input", () => {
    clearTimeout(timeout);

    timeout = setTimeout(async () => {
      const value = searchCompanyInput.value;

      const results = await fetch(`/companies/search?name=${value}`);
      const companies = await results.json();
      console.log(companies);

      if (!companies.length) {
        resultsWrapper.innerHTML = `<p class='result-msg'>No results yet. Start searching to find a company.</div>`;
        return;
      }

      resultsWrapper.innerHTML = companies
        .map((company) => {
          const isRequested = company.requestStatus === "pending";
          return `
            <div class="result-box flex-c space-b">
                <div class="box-name">
                    <p>
                        ${company.name}
                    </p>
                </div>
                
                <div class="box-actions">
                    <button class="btn request-sender" data-id="${company._id}" ${isRequested ? "disabled" : ""}>
                        ${isRequested ? "Request sent" : "Send request"}
                    </button>
                </div>
        `;
        })
        .join("");
    }, 400);
  });

  resultsWrapper.addEventListener("click", async (e) => {
    const button = e.target.closest(".request-sender");
    const companyId = button.dataset.id;

    if (!button) return;

    await fetch("/companies/send-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId }),
    });

    button.textContent = "Request sent";
    button.disabled = true;
  });
});
