// ── Petit sélecteur d'heure (façon "Disponibilités") : un champ cliquable
// qui ouvre un panneau avec une recherche filtrée (ex: "9" ou "0930") sur une
// liste d'horaires toutes les 10 min. Composant générique, réutilisé sur
// toutes les pages qui ont besoin de choisir une heure (RDV, cours collectifs…).
// Requiert les classes CSS .appt-time-box / .appt-time-panel / .appt-time-search
// / .appt-time-list / .appt-time-opt (définies dans appointment.admin.css).
// Une option "HH:MM" correspond-elle aux chiffres tapés ?
//
// L'ancienne version faisait `"0900".startsWith("9")` → taper "9" ne remontait
// AUCUNE heure, alors que le placeholder invite explicitement à le faire. Sur
// 1 chiffre on compare donc l'heure seule, avec et sans son zéro de tête ; sur
// 3 chiffres on essaie aussi la lecture "H MM" ("930" = 09:30).
export function timeOptionMatches(optValue, digits) {
  if (!digits) return true;
  const flat = optValue.replace(":", "");
  const hh = optValue.slice(0, 2);
  if (digits.length === 1) return hh === `0${digits}` || hh.startsWith(digits);
  if (digits.length === 2) return hh === digits;
  if (digits.length === 3) return flat === `0${digits}` || flat.startsWith(digits);
  return flat.startsWith(digits);
}

// Rendu lisible de la frappe en cours. L'ancien code découpait aveuglément aux
// 2 premiers chiffres : "930" s'affichait "93:0", une heure qui n'existe pas.
export function formatTimeQuery(digits) {
  if (digits.length <= 2) return digits;
  const mm = digits.slice(-2);
  const hh = digits.slice(0, -2);
  if (Number(mm) > 59) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return `${hh.padStart(2, "0")}:${mm}`;
}

export function createTimePicker(boxEl, panelEl, listEl, onChange) {
  // Le panneau est position:fixed et positionné via getBoundingClientRect()
  // (coordonnées relatives au viewport). Si un ancêtre a une transform CSS
  // (ex: les modals .service-modal centrés en transform: translate(-50%,-50%)),
  // le navigateur fait de cet ancêtre le containing block du panneau "fixed" —
  // le panneau se positionne alors par rapport au modal, pas au viewport, et
  // apparaît décalé/coupé. On le rattache directement à <body> pour garantir
  // un positionnement fiable peu importe où le composant est utilisé.
  document.body.appendChild(panelEl);

  // Pas de 5 min : 12:25, 10:05, 08:45… sont des horaires courants et doivent
  // être directement dans la liste. Le pas de 10 les rendait inatteignables.
  const TIME_OPTIONS = [];
  for (let m = 0; m < 24 * 60; m += 5) {
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
      opt.classList.toggle("is-hidden", !timeOptionMatches(opt.dataset.value, q));
    });
  }

  function open() {
    document.querySelectorAll(".appt-time-panel.open").forEach((p) => { if (p !== panelEl) p.classList.remove("open"); });
    const rect = boxEl.getBoundingClientRect();
    // Le panneau a une hauteur fixe (recherche + liste max-height 190px) —
    // s'il ne tient pas sous le champ jusqu'au bas de l'écran (mobile, champ
    // proche du bas), on l'ouvre vers le haut à la place pour ne jamais le
    // laisser dépasser le viewport et devenir inaccessible/coupé.
    const panelHeight = panelEl.offsetHeight || 240;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < panelHeight + 8 && rect.top > panelHeight + 8;
    panelEl.style.top = openUpward
      ? `${Math.max(4, rect.top - panelHeight - 4)}px`
      : `${rect.bottom + 4}px`;
    // Idem horizontalement : ne jamais dépasser le bord droit de l'écran.
    const panelWidth = panelEl.offsetWidth || 190;
    const left = Math.min(rect.left, window.innerWidth - panelWidth - 4);
    panelEl.style.left = `${Math.max(4, left)}px`;
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
    const digits = searchInput.value.replace(/[^0-9]/g, "").slice(0, 4);
    searchInput.value = formatTimeQuery(digits);
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
