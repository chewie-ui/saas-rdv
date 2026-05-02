// 1. Géolocalisation (GPS)
const getMyLocation = () => {
  if (!navigator.geolocation) {
    alert((window.__t && window.__t.geoloc_not_supported) || "Désolé, votre navigateur ne supporte pas la géolocalisation.");
    return;
  }

  const options = { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 };

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      // On appelle la fonction de recherche de commerces avec le GPS
      fetchNearbyCommerces(latitude, longitude);
    },
    (error) => {
      console.warn(`Erreur (${error.code}): ${error.message}`);
      alert((window.__t && window.__t.geoloc_denied) || "Veuillez autoriser la position dans les réglages de votre navigateur.");
    },
    options,
  );
};

// 2. Recherche d'adresse via Photon (Autocomplétion)
let debounceTimer;
async function searchAddress() {
  const query = document.getElementById("addressInput").value.trim();
  const resultsList = document.getElementById("resultsList");

  clearTimeout(debounceTimer);
  if (query.length < 3) {
    resultsList.innerHTML = "";
    return;
  }

  debounceTimer = setTimeout(async () => {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lang=fr&filter=countrycode:BE&limit=5`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      resultsList.innerHTML = ""; // On vide la liste précédente

      if (data.features && data.features.length > 0) {
        data.features.forEach((place) => {
          const p = place.properties;
          const label =
            `${p.name || ""} ${p.street || ""} ${p.housenumber || ""}, ${p.city || ""}`.trim();
          const [lng, lat] = place.geometry.coordinates; // Photon renvoie [lng, lat]

          // Création de l'élément de liste cliquable
          const li = document.createElement("li");
          li.className =
            "p-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 text-sm";
          li.textContent = label;
          li.onclick = () => {
            document.getElementById("addressInput").value = label;
            resultsList.innerHTML = "";
            fetchNearbyCommerces(lat, lng); // On lance la recherche de commerces
          };
          resultsList.appendChild(li);
        });
      }
    } catch (error) {
      console.error("Erreur avec Photon :", error);
    }
  }, 400); // On attend 400ms après la frappe pour éviter de spammer l'API
}

// 3. Fonction commune pour appeler ton Backend
async function fetchNearbyCommerces(lat, lng) {
  console.log(`Recherche des commerces proches de : ${lat}, ${lng}`);
  try {
    const response = await fetch(
      `/api/commerces/proches?lat=${lat}&lng=${lng}`,
    );
    const commerces = await response.json();

    console.log("Commerces trouvés :", commerces);
    // updateUI(commerces);
  } catch (err) {
    console.error("Erreur fetch backend:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const header = document.querySelector(".header");
  const headerPhone = document.querySelector(".header-phone");

  window.addEventListener("scroll", (e) => {
    if (header) header.classList.toggle("sticky", window.scrollY > 0);
    if (headerPhone) headerPhone.classList.toggle("sticky", window.scrollY > 0);
  });

  // Close mobile nav when a link inside is clicked
  const headerNavToggle = document.getElementById("headerNavToggle");
  if (headerNavToggle) {
    document.querySelectorAll(".header .menu a").forEach((link) => {
      link.addEventListener("click", () => {
        headerNavToggle.checked = false;
      });
    });
  }

  document.addEventListener("click", (e) => {
    const formGrp = e.target.closest(".form-group");
    const citySearchClicked = e.target.closest(".menu-search div");
    const menuSearch = document.querySelector(".menu-search");

    if (citySearchClicked) {
      const grp = citySearchClicked.closest(".form-group");
      const input = grp.querySelector("input");
      input.value = citySearchClicked.textContent;
      const menuSearch = citySearchClicked.closest(".menu-search");
      menuSearch.classList.remove("active");
      return;
    }

    if (formGrp) {
      const input = formGrp.querySelector("input");
      input.focus();
      formGrp.classList.add("active");

      input.onblur = function () {
        formGrp.classList.remove("active");
      };
    } else {
      document.querySelectorAll(".form-group, .menu-search").forEach((el) => {
        el.classList.remove("active");
      });
    }
  });

  const searchBtn = document.getElementById("searchBtn");
  const inputName = document.getElementById("inputName");
  const inputLocation = document.getElementById("inputLocation");
  const resultsLocation = document.querySelector(".menu-locations");
  const menuNames = document.querySelector(".menu-names");

  // ---- Service suggestions dropdown ----
  function normalizeStr(str) {
    return str.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function renderServiceItems(items) {
    if (!menuNames) return;
    menuNames.innerHTML = "";
    if (items.length === 0) {
      menuNames.classList.remove("active");
      return;
    }
    items.forEach((item) => {
      const div = document.createElement("div");
      div.textContent = item;
      menuNames.appendChild(div);
    });
    menuNames.classList.add("active");
  }

  // Ferme tous les dropdowns
  function closeAllDropdowns() {
    if (menuNames) menuNames.classList.remove("active");
    if (resultsLocation) {
      resultsLocation.classList.remove("active");
      resultsLocation.innerHTML = "";
    }
  }

  if (inputName && menuNames && window.__services) {
    inputName.addEventListener("focus", () => {
      // Ferme le dropdown lieu avant d'ouvrir services
      if (resultsLocation) {
        resultsLocation.classList.remove("active");
        resultsLocation.innerHTML = "";
      }
      const q = normalizeStr(inputName.value.trim());
      const filtered = q
        ? window.__services.filter((s) => normalizeStr(s).includes(q)).slice(0, 10)
        : window.__services.slice(0, 10);
      renderServiceItems(filtered);
    });

    inputName.addEventListener("input", () => {
      const q = normalizeStr(inputName.value.trim());
      const filtered = q
        ? window.__services.filter((s) => normalizeStr(s).includes(q)).slice(0, 10)
        : window.__services.slice(0, 10);
      renderServiceItems(filtered);
    });

    inputName.addEventListener("blur", () => {
      setTimeout(() => menuNames.classList.remove("active"), 150);
    });
  }

  let debounceTimer;

  if (inputLocation) {
    inputLocation.addEventListener("focus", () => {
      // Ferme le dropdown services quand on entre dans le champ lieu
      if (menuNames) menuNames.classList.remove("active");
    });

    inputLocation.addEventListener("input", () => {
      // Ferme le dropdown services
      if (menuNames) menuNames.classList.remove("active");

      clearTimeout(debounceTimer);
      const val = inputLocation.value.trim();

      debounceTimer = setTimeout(async () => {
        if (val.length < 2) {
          resultsLocation.classList.remove("active");
          resultsLocation.innerHTML = "";
          return;
        }

        try {
          const res = await fetch(
            `https://quentin-project.site/api/search?name=${encodeURIComponent(val)}`,
          );

          if (!res.ok) throw new Error("Erreur API");

          const data = await res.json();

          resultsLocation.innerHTML = "";
          resultsLocation.classList.add("active");

          if (data.length === 0) {
            const div = document.createElement("div");
            div.textContent = (window.__t && window.__t.no_result) || "Aucun résultat";
            resultsLocation.appendChild(div);
            return;
          }
          data.forEach((el) => {
            const div = document.createElement("div");
            div.textContent = el.name;
            resultsLocation.appendChild(div);
          });
        } catch (err) {
          console.error("Erreur de fetch :", err);
        }
      }, 300);
    });

    inputLocation.addEventListener("blur", () => {
      setTimeout(() => {
        if (resultsLocation) resultsLocation.classList.remove("active");
      }, 150);
    });
  }

  // Clic en dehors = ferme tout
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".hero__form-container")) {
      closeAllDropdowns();
    }
  }, true);

  if (searchBtn) {
    searchBtn.addEventListener("click", () => {
      const name = inputName.value.trim();
      const location = inputLocation.value.trim();

      const params = new URLSearchParams({
        name,
        location,
      });

      window.location.href = `/search?${params.toString()}`;
    });
  }
});
