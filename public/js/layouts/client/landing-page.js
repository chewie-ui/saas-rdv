/* ══════════════════════════════════════════════════════
   Landing page JS — BranShee v3
   ══════════════════════════════════════════════════════ */

// ── Animated headline word ──────────────────────────────
const WORDS = ["haircut", "coaching", "massage", "yoga", "tatoo", "nails"];
let wordIdx = 0;
const wordEl = document.getElementById("lpWord");

if (wordEl) {
  setInterval(() => {
    wordEl.classList.add("fade-out");
    setTimeout(() => {
      wordIdx = (wordIdx + 1) % WORDS.length;
      wordEl.textContent = WORDS[wordIdx];
      wordEl.classList.remove("fade-out");
    }, 200);
  }, 2800);
}

// ── Category filter (chips + sidebar) ──────────────────
const cards      = document.querySelectorAll(".lp__card");
const catBtns    = document.querySelectorAll(".lp__cat, .lp__sb-item");
const countEl    = document.getElementById("visibleCount");

const CATEGORY_MAP = {
  hair:     ["coiffeur", "coiffeuse", "hairdresser", "kapper", "hair"],
  barber:   ["barbier", "barber"],
  coach:    ["coach", "personal trainer", "fitness", "sport", "yoga", "pilates"],
  wellness: ["massage", "spa", "bien-être", "wellness", "ostéopathe", "osteopaat", "kiné",
             "kinésithérapeute", "physiotherapist", "hypno", "naturo", "sophrolog"],
  tattoo:   ["tatoueur", "tattoo", "tatoueuse", "tattoo artist"],
  nails:    ["manucure", "nail", "ongulaire", "prothésiste"],
};

function cardMatchesCat(card, catKey) {
  if (catKey === "all") return true;
  const type = (card.dataset.type || "").toLowerCase();
  const terms = CATEGORY_MAP[catKey] || [];
  return terms.some((t) => type.includes(t));
}

function applyFilter(catKey) {
  let visible = 0;
  cards.forEach((card) => {
    const show = cardMatchesCat(card, catKey);
    card.classList.toggle("hidden", !show);
    if (show) visible++;
  });
  if (countEl) countEl.textContent = visible;

  // Sync active state on ALL filter buttons
  catBtns.forEach((btn) => {
    const active = btn.dataset.cat === catKey;
    btn.classList.toggle("lp__cat--active", active && btn.classList.contains("lp__cat"));
    btn.classList.toggle("active",           active && btn.classList.contains("lp__sb-item"));
  });
}

catBtns.forEach((btn) => {
  btn.addEventListener("click", () => applyFilter(btn.dataset.cat));
});

// ── Distance range ──────────────────────────────────────
const rangeEl  = document.getElementById("distanceRange");
const rangeVal = document.getElementById("distanceVal");
if (rangeEl && rangeVal) {
  rangeEl.addEventListener("input", () => {
    rangeVal.textContent = rangeEl.value + " km";
  });
}

// ── Service suggestions dropdown ────────────────────────
const inputName    = document.getElementById("inputName");
const menuNames    = document.getElementById("menuNames");
const inputLoc     = document.getElementById("inputLocation");
const menuLoc      = document.getElementById("menuLocations");

function normalizeStr(str) {
  return str.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function renderDropdown(menu, items, onSelect) {
  menu.innerHTML = "";
  if (!items.length) { menu.classList.remove("active"); return; }

  items.forEach((text) => {
    const div = document.createElement("div");
    const dot = document.createElement("span");
    dot.className = "dd-icon";
    div.appendChild(dot);
    div.appendChild(document.createTextNode(text));
    div.addEventListener("mousedown", (e) => {
      e.preventDefault(); // stop blur from firing first
      onSelect(text);
    });
    menu.appendChild(div);
  });
  menu.classList.add("active");
}

function closeAll() {
  menuNames?.classList.remove("active");
  menuLoc?.classList.remove("active");
}

// Service name input
if (inputName && menuNames && window.__services) {
  inputName.addEventListener("focus", () => {
    menuLoc?.classList.remove("active");
    const q  = normalizeStr(inputName.value.trim());
    const filtered = q
      ? window.__services.filter((s) => normalizeStr(s).includes(q)).slice(0, 10)
      : window.__services.slice(0, 10);
    renderDropdown(menuNames, filtered, (val) => {
      inputName.value = val;
      menuNames.classList.remove("active");
      inputName.focus();
    });
  });

  inputName.addEventListener("input", () => {
    menuLoc?.classList.remove("active");
    const q = normalizeStr(inputName.value.trim());
    const filtered = q
      ? window.__services.filter((s) => normalizeStr(s).includes(q)).slice(0, 10)
      : window.__services.slice(0, 10);
    renderDropdown(menuNames, filtered, (val) => {
      inputName.value = val;
      menuNames.classList.remove("active");
    });
  });

  inputName.addEventListener("blur", () => {
    setTimeout(() => menuNames.classList.remove("active"), 160);
  });
}

// Location autocomplete (Photon / existing API)
let locTimer;
if (inputLoc && menuLoc) {
  inputLoc.addEventListener("focus", () => {
    menuNames?.classList.remove("active");
  });

  inputLoc.addEventListener("input", () => {
    menuNames?.classList.remove("active");
    clearTimeout(locTimer);
    const val = inputLoc.value.trim();

    if (val.length < 2) {
      menuLoc.classList.remove("active");
      menuLoc.innerHTML = "";
      return;
    }

    locTimer = setTimeout(async () => {
      try {
        const res  = await fetch(`https://quentin-project.site/api/search?name=${encodeURIComponent(val)}`);
        if (!res.ok) throw new Error("API error");
        const data = await res.json();

        const items = data.map ? data.map((el) => el.name).filter(Boolean) : [];

        if (!items.length) {
          const div = document.createElement("div");
          div.textContent = (window.__t?.no_result) || "No results";
          menuLoc.innerHTML = "";
          menuLoc.appendChild(div);
          menuLoc.classList.add("active");
          return;
        }

        renderDropdown(menuLoc, items.slice(0, 8), (val) => {
          inputLoc.value = val;
          menuLoc.classList.remove("active");
        });
      } catch (err) {
        console.error("Location fetch error:", err);
      }
    }, 300);
  });

  inputLoc.addEventListener("blur", () => {
    setTimeout(() => menuLoc.classList.remove("active"), 160);
  });
}

// Close dropdowns on outside click
document.addEventListener("click", (e) => {
  if (!e.target.closest(".lp__searchbar")) closeAll();
});

// ── Search button ───────────────────────────────────────
const searchBtn = document.getElementById("searchBtn");
if (searchBtn) {
  searchBtn.addEventListener("click", () => {
    const name = inputName?.value.trim() || "";
    const loc  = inputLoc?.value.trim()  || "";
    const params = new URLSearchParams({ name, location: loc });
    window.location.href = `/search?${params.toString()}`;
  });
}

// Also trigger search on Enter key in either input
[inputName, inputLoc].forEach((inp) => {
  inp?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") searchBtn?.click();
  });
});
