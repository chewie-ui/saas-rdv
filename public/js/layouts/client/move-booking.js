/* ── Déplacer un rendez-vous (espace client) ────────────────────────────────
   Le serveur reste seul juge : il revérifie l'horaire du pro, les conflits et
   le délai minimum au moment du POST. Ce fichier n'est qu'une vitrine — il ne
   décide de rien, il affiche ce que le serveur propose et rapporte ce qu'il
   refuse.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  var overlay = document.getElementById("moveOverlay");
  if (!overlay) return;

  var champDate = document.getElementById("moveDate");
  var statut = document.getElementById("moveStatus");
  var zoneSlots = document.getElementById("moveSlots");
  var btnOk = document.getElementById("moveConfirm");
  var btnFermer = document.getElementById("moveClose");
  var info = document.getElementById("moveInfo");

  var courant = null;   // { id, token }
  var choisi = null;    // "HH:MM"

  function ferme() {
    overlay.style.display = "none";
    courant = null; choisi = null;
    zoneSlots.innerHTML = "";
    btnOk.disabled = true;
  }

  function jourIso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
           "-" + String(d.getDate()).padStart(2, "0");
  }

  function rendreSlots(liste) {
    zoneSlots.innerHTML = "";
    choisi = null;
    btnOk.disabled = true;
    if (!liste.length) {
      statut.textContent = "Aucun créneau libre ce jour-là. Essayez une autre date.";
      return;
    }
    statut.textContent = liste.length > 1
      ? liste.length + " créneaux libres — choisissez le vôtre."
      : "1 créneau libre.";
    liste.forEach(function (h) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mv-slot";
      b.textContent = h;
      b.addEventListener("click", function () {
        var actif = zoneSlots.querySelector(".mv-slot.is-on");
        if (actif) actif.classList.remove("is-on");
        b.classList.add("is-on");
        choisi = h;
        btnOk.disabled = false;
      });
      zoneSlots.appendChild(b);
    });
  }

  function chargeSlots() {
    if (!courant || !champDate.value) return;
    statut.textContent = "Recherche des créneaux…";
    zoneSlots.innerHTML = "";
    btnOk.disabled = true;
    fetch("/reprogrammer-booking/" + encodeURIComponent(courant.id) + "/creneaux" +
          "?token=" + encodeURIComponent(courant.token) +
          "&date=" + encodeURIComponent(champDate.value))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.error) { statut.textContent = d.error; return; }
        if (d.closed) { statut.textContent = "Le professionnel est fermé ce jour-là."; return; }
        rendreSlots(d.slots || []);
      })
      .catch(function () { statut.textContent = "Impossible de charger les créneaux."; });
  }

  document.querySelectorAll(".js-move-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      courant = { id: btn.dataset.id, token: btn.dataset.token };
      info.textContent = btn.dataset.name +
        (btn.dataset.service ? " · " + btn.dataset.service : "") +
        " — actuellement " + btn.dataset.current + ".";
      // Par défaut demain : on ne propose pas de déplacer vers aujourd'hui,
      // dont la plupart des créneaux sont déjà passés.
      var demain = new Date(); demain.setDate(demain.getDate() + 1);
      champDate.value = jourIso(demain);
      champDate.min = jourIso(new Date());
      statut.textContent = "Recherche des créneaux…";
      zoneSlots.innerHTML = "";
      btnOk.disabled = true;
      overlay.style.display = "flex";
      chargeSlots();
    });
  });

  champDate.addEventListener("change", chargeSlots);
  btnFermer.addEventListener("click", ferme);
  overlay.addEventListener("click", function (e) { if (e.target === overlay) ferme(); });

  btnOk.addEventListener("click", function () {
    if (!courant || !choisi) return;
    btnOk.disabled = true;
    btnOk.textContent = "Déplacement…";
    fetch("/reprogrammer-booking/" + encodeURIComponent(courant.id) +
          "?token=" + encodeURIComponent(courant.token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: champDate.value, startTime: choisi }),
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        btnOk.textContent = "Confirmer le déplacement";
        if (!res.ok || res.d.error) {
          // Le créneau a pu être pris entre l'affichage et le clic : on
          // recharge la liste plutôt que de laisser un choix périmé à l'écran.
          statut.textContent = res.d.error || "Le report a échoué.";
          chargeSlots();
          return;
        }
        // Rechargement complet : la carte, les compteurs et l'ordre des
        // rendez-vous changent tous — les recalculer à la main ici les ferait
        // diverger de ce que le serveur vient d'écrire.
        window.location.reload();
      })
      .catch(function () {
        btnOk.textContent = "Confirmer le déplacement";
        btnOk.disabled = false;
        statut.textContent = "Le report a échoué. Réessayez.";
      });
  });
})();
