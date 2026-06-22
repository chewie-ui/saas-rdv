// ── Petit sélecteur d'heure (façon "Disponibilités") : un champ cliquable
// qui ouvre un panneau avec une recherche filtrée (ex: "9" ou "0930") sur une
// liste d'horaires toutes les 10 min. Composant générique, réutilisé sur
// toutes les pages qui ont besoin de choisir une heure (RDV, cours collectifs…).
// Requiert les classes CSS .appt-time-box / .appt-time-panel / .appt-time-search
// / .appt-time-list / .appt-time-opt (définies dans appointment.admin.css).
export function createTimePicker(boxEl, panelEl, listEl, onChange) {
  const TIME_OPTIONS = [];
  for (let m = 0; m < 24 * 60; m += 10) {
    TIME_OPTIONS.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  TIME_OPTIONS.forEach((t) => {
    const opt = document.createElement("div");
    opt.className = "appt-time-opt";
    opt.textContent = t;
    opt.dataset.value = t;
    listEl.appendChild(opt);
  });

  const searchInput = panelEl.querySelector(".appt-time-search");
  let value = "";

  function setValue(v) {
    value = v;
    boxEl.textContent = v || "--:--";
    if (onChange) onChange(v);
  }

  function filterOptions(query) {
    const q = query.replace(/[^0-9]/g, "");
    listEl.querySelectorAll(".appt-time-opt").forEach((opt) => {
      const matches = !q || opt.dataset.value.replace(":", "").startsWith(q);
      opt.classList.toggle("is-hidden", !matches);
    });
  }

  function open() {
    document.querySelectorAll(".appt-time-panel.open").forEach((p) => { if (p !== panelEl) p.classList.remove("open"); });
    const rect = boxEl.getBoundingClientRect();
    panelEl.style.top = `${rect.bottom + 4}px`;
    panelEl.style.left = `${rect.left}px`;
    panelEl.classList.add("open");
    boxEl.classList.add("is-open");
    searchInput.value = "";
    filterOptions("");
    searchInput.focus();
  }

  function close() {
    panelEl.classList.remove("open");
    boxEl.classList.remove("is-open");
  }

  boxEl.addEventListener("click", () => {
    panelEl.classList.contains("open") ? close() : open();
  });
  boxEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });

  searchInput.addEventListener("input", () => {
    let digits = searchInput.value.replace(/[^0-9]/g, "").slice(0, 4);
    if (digits.length > 2) digits = `${digits.slice(0, 2)}:${digits.slice(2)}`;
    searchInput.value = digits;
    filterOptions(digits);
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key !== "Enter") return;
    const firstVisible = listEl.querySelector(".appt-time-opt:not(.is-hidden)");
    if (firstVisible) { setValue(firstVisible.dataset.value); close(); }
  });
  listEl.addEventListener("click", (e) => {
    const opt = e.target.closest(".appt-time-opt");
    if (!opt) return;
    setValue(opt.dataset.value);
    close();
  });
  document.addEventListener("click", (e) => {
    if (panelEl.classList.contains("open") && !panelEl.contains(e.target) && e.target !== boxEl) close();
  });

  return {
    get: () => value,
    set: (v) => setValue(v || ""),
  };
}
