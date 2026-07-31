// ── Petit sélecteur d'heure (façon "Disponibilités") : un champ cliquable
// qui ouvre un panneau avec une recherche filtrée (ex: "9" ou "0930") sur une
// liste d'horaires toutes les 10 min. Composant générique, réutilisé sur
// toutes les pages qui ont besoin de choisir une heure (RDV, cours collectifs…).
// Requiert les classes CSS .appt-time-box / .appt-time-panel / .appt-time-search
// / .appt-time-list / .appt-time-opt (définies dans appointment.admin.css).
const pad2 = (n) => String(n).padStart(2, "0");

// Interprète une suite de chiffres en heure EXACTE, à la minute près, quand
// c'est possible sans ambiguïté. Conventions usuelles : "930" = 09:30,
// "0930" = 09:30. Sur 1 ou 2 chiffres on ne devine rien (c'est un filtre
// d'heure, pas une heure), et "093" est rejeté (0h93 n'existe pas) — il reste
// alors traité comme un préfixe de "09:3x", ce qui est bien ce qu'on veut
// pendant la frappe de "0930".
export function parseTimeDigits(digits) {
  let h, m;
  if (digits.length === 3) {
    h = Number(digits[0]);
    m = Number(digits.slice(1));
  } else if (digits.length === 4) {
    h = Number(digits.slice(0, 2));
    m = Number(digits.slice(2));
  } else {
    return null;
  }
  if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) return null;
  return `${pad2(h)}:${pad2(m)}`;
}

// Une option "HH:MM" correspond-elle à ce que l'utilisateur tape ?
//
// L'ancienne version comparait `"0900".startsWith("9")` : taper "9" ne
// remontait donc AUCUNE heure, alors que le placeholder invite explicitement à
// le faire. Sur 1 chiffre on compare donc l'heure seule, avec et sans son zéro
// de tête.
export function timeOptionMatches(optValue, digits, exact) {
  if (!digits) return true;
  const flat = optValue.replace(":", "");
  const hh = optValue.slice(0, 2);
  if (digits.length === 1) return hh === `0${digits}` || hh.startsWith(digits);
  if (digits.length === 2) return hh === digits;
  if (exact) return flat === exact.replace(":", "");
  return flat.startsWith(digits);
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

  // Option "à la minute près" — la liste ne propose que des paliers de 10 min,
  // mais rien n'oblige un rendez-vous ou une absence à tomber dessus (11:05,
  // 12:12…). Dès que ce qui est tapé forme une heure valide absente de la
  // liste, cette option apparaît en tête et devient sélectionnable (clic ou
  // Entrée). Sans elle, ces heures-là étaient tout simplement impossibles.
  const exactOpt = document.createElement("div");
  exactOpt.className = "appt-time-opt appt-time-opt--exact is-hidden";
  listEl.insertBefore(exactOpt, listEl.firstChild);

  const searchInput = panelEl.querySelector(".appt-time-search");
  let value = "";

  function setValue(v) {
    value = v;
    boxEl.textContent = v || "--:--";
    if (onChange) onChange(v);
  }

  function filterOptions(query) {
    const q = query.replace(/[^0-9]/g, "");
    const exact = parseTimeDigits(q);
    let exactAlreadyListed = false;

    listEl.querySelectorAll(".appt-time-opt").forEach((opt) => {
      if (opt === exactOpt) return;
      const matches = timeOptionMatches(opt.dataset.value, q, exact);
      opt.classList.toggle("is-hidden", !matches);
      if (exact && opt.dataset.value === exact) exactAlreadyListed = true;
    });

    // Inutile de proposer "11:20" en doublon quand le palier existe déjà.
    const showExact = !!exact && !exactAlreadyListed;
    exactOpt.classList.toggle("is-hidden", !showExact);
    if (showExact) {
      exactOpt.textContent = exact;
      exactOpt.dataset.value = exact;
    }
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
    const exact = parseTimeDigits(digits);
    // Affiche l'heure reconnue plutôt qu'un découpage aveugle : "930" devenait
    // "93:0" avec l'ancien slice(0,2), une heure qui n'existe pas.
    searchInput.value = exact || (digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits);
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
