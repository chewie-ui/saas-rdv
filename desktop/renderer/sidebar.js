async function mountSidebar(activeKey) {
  const mount = document.getElementById("sidebarMount");
  const html = await fetch("sidebar.html").then((r) => r.text());
  mount.innerHTML = html;

  mount.querySelectorAll(".sb-link[data-key]").forEach((link) => {
    if (link.dataset.key === activeKey) link.classList.add("active");
    link.addEventListener("click", (e) => {
      e.preventDefault();
      if (link.dataset.key === activeKey) return;
      window.branshee.goTo(link.dataset.page, link.dataset.title ? { title: link.dataset.title } : undefined);
    });
  });

  document.getElementById("sbLogout").addEventListener("click", async (e) => {
    e.preventDefault();
    await window.branshee.logout();
    window.branshee.goTo("login.html");
  });

  const result = await window.branshee.getMe();
  if (result.ok) {
    document.getElementById("sbUserName").textContent = result.data.fullName || result.data.email;
    if (result.data.profilePicture) {
      document.getElementById("sbAvatar").src = result.data.profilePicture.startsWith("http")
        ? result.data.profilePicture
        : `${window.branshee.BASE_URL}${result.data.profilePicture}`;
    }
  } else {
    window.branshee.goTo("login.html");
  }
}
