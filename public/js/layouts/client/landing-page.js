// 1. Géolocalisation (GPS)
const getMyLocation = () => {
  if (!navigator.geolocation) {
    alert("Désolé, votre navigateur ne supporte pas la géolocalisation.");
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
      alert(
        "Veuillez autoriser la position dans les réglages de votre navigateur.",
      );
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

  window.addEventListener("scroll", (e) => {
    header.classList.toggle("sticky", window.scrollY > 0);
  });

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

  let debounceTimer; // On crée une variable pour stocker le "chrono"

  if (inputLocation) {
    inputLocation.addEventListener("input", () => {
      // 1. On annule le chrono précédent à chaque fois qu'on tape une lettre
      clearTimeout(debounceTimer);

      const val = inputLocation.value.trim();

      // 2. On lance un nouveau chrono de 300 millisecondes
      debounceTimer = setTimeout(async () => {
        if (val.length < 2) {
          resultsLocation.classList.remove("active");
          resultsLocation.innerHTML = "";
          return;
        }

        try {
          const res = await fetch(
            `https://quentin-project.site/api/search?name=${val}`,
          );

          if (!res.ok) throw new Error("Erreur API");

          const data = await res.json();

          // On vide le menu AVANT d'afficher les nouveaux résultats
          resultsLocation.innerHTML = "";
          resultsLocation.classList.add("active");

          if (data.length === 0) {
            const div = document.createElement("div");
            div.textContent = "Aucun resultat";
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
      }, 300); // 300ms de délai
    });
  }

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
