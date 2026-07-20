const params = new URLSearchParams(window.location.search);
const title = params.get("title") || "Bientôt disponible";
document.title = `BranShee — ${title}`;
document.getElementById("soonTitle").textContent = title;

mountSidebar(null);
