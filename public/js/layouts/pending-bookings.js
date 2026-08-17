/* ══════════════════════════════════════════════════════════════════════════
   DEMANDES DE RENDEZ-VOUS EN ATTENTE
   ─────────────────────────────────────────────────────────────────────────
   Accepter → PATCH /appointment/:id/confirm  (le RDV devient confirmé)
   Refuser  → PATCH /appointment/:id/refuse   (annulé, créneau libéré)

   Les deux endpoints filtrent sur `status: "pending"` côté serveur : deux
   clics rapides, ou deux onglets ouverts, ne peuvent pas traiter deux fois
   la même demande — le second reçoit un 404 explicite.
   ═════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var root = document.getElementById("pbRoot");
  if (!root) return;

  function json(url, method, body) {
    return fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || d.success === false) {
          var e = new Error(d.message || "HTTP " + r.status);
          e.serveur = d.message || "";
          throw e;
        }
        return d;
      });
    });
  }

  function verrouiller(carte, actif) {
    carte.querySelectorAll("button").forEach(function (b) { b.disabled = actif; });
    carte.style.opacity = actif ? ".5" : "";
  }

  root.addEventListener("click", function (e) {
    var carte = e.target.closest(".pb-card");
    if (!carte) return;
    var id = carte.dataset.pbid;

    // ── Accepter ──
    if (e.target.closest(".pb-accept")) {
      verrouiller(carte, true);
      json("/appointment/" + id + "/confirm", "PATCH")
        .then(function () { window.location.reload(); })
        .catch(function (err) {
          verrouiller(carte, false);
          alert(err.serveur || "L'acceptation a échoué.");
        });
      return;
    }

    // ── Déplier / replier la zone de refus ──
    if (e.target.closest(".pb-refuse")) {
      carte.querySelector(".pb-refuse-box").hidden = false;
      var champ = carte.querySelector(".pb-motif");
      if (champ) champ.focus();
      return;
    }
    if (e.target.closest(".pb-refuse-cancel")) {
      carte.querySelector(".pb-refuse-box").hidden = true;
      return;
    }

    // ── Refuser (avec motif) ──
    if (e.target.closest(".pb-refuse-confirm")) {
      var motif = (carte.querySelector(".pb-motif") || {}).value || "";
      verrouiller(carte, true);
      json("/appointment/" + id + "/refuse", "PATCH", { motif: motif.trim() })
        .then(function () { window.location.reload(); })
        .catch(function (err) {
          verrouiller(carte, false);
          alert(err.serveur || "Le refus a échoué.");
        });
      return;
    }

    // ── Demande expirée : libération directe, sans motif ──
    // La date est passée, un message au client n'aurait plus de sens.
    if (e.target.closest(".pb-refuse-direct")) {
      verrouiller(carte, true);
      json("/appointment/" + id + "/refuse", "PATCH", { motif: "" })
        .then(function () { window.location.reload(); })
        .catch(function (err) {
          verrouiller(carte, false);
          alert(err.serveur || "La libération a échoué.");
        });
    }
  });
})();
