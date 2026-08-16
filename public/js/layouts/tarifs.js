/* ══════════════════════════════════════════════════════════════════════════
   TARIFS — bascule mensuel / annuel, et questions dépliables
   ─────────────────────────────────────────────────────────────────────────
   Les deux comportements sont des AMÉLIORATIONS : sans ce fichier, la page
   reste juste et lisible — prix mensuels affichés, réponses toutes visibles.
   C'est pourquoi les questions sont ouvertes dans le HTML et refermées ici,
   et jamais l'inverse.

   Les montants ne sont pas recalculés côté client : chaque prix porte ses
   deux valeurs en `data-mois` / `data-an`, écrites par le serveur depuis
   utils/tarifs.js. Rien à tenir en double.
   ═════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── Bascule mensuel / annuel ─────────────────────────────────────────── */
  var boutons = document.querySelectorAll(".tp-toggle__btn");

  function appliquer(periode) {
    var annuel = periode === "an";

    boutons.forEach(function (b) {
      var actif = b.dataset.periode === periode;
      b.classList.toggle("is-on", actif);
      b.setAttribute("aria-pressed", actif ? "true" : "false");
    });

    document.querySelectorAll(".tp-plan__price").forEach(function (el) {
      var v = annuel ? el.dataset.an : el.dataset.mois;
      if (v !== undefined) el.textContent = v + " €";
    });

    document.querySelectorAll(".tp-plan__per").forEach(function (el) {
      var v = annuel ? el.dataset.perAn : el.dataset.perMois;
      if (v) el.textContent = v;
    });

    document.querySelectorAll(".tp-plan__note").forEach(function (el) {
      // La note mensuelle est celle rendue par le serveur : on la garde en
      // mémoire au premier passage plutôt que de la reconstruire.
      if (el.dataset.noteMois === undefined) el.dataset.noteMois = el.textContent.trim();
      el.textContent = annuel ? (el.dataset.noteAn || "") : el.dataset.noteMois;
    });
  }

  boutons.forEach(function (b) {
    b.addEventListener("click", function () { appliquer(b.dataset.periode); });
  });

  /* ── Questions fréquentes ─────────────────────────────────────────────── */
  var items = document.querySelectorAll(".tp-faq__item");

  items.forEach(function (item) {
    var q = item.querySelector(".tp-faq__q");
    var signe = item.querySelector(".tp-faq__sign");
    if (!q) return;

    // Fermé au chargement — l'état ouvert du HTML est le repli sans script.
    item.classList.add("is-closed");
    q.setAttribute("aria-expanded", "false");
    if (signe) signe.textContent = "+";

    q.addEventListener("click", function () {
      var ouvert = !item.classList.contains("is-closed");
      item.classList.toggle("is-closed", ouvert);
      q.setAttribute("aria-expanded", ouvert ? "false" : "true");
      if (signe) signe.textContent = ouvert ? "+" : "−";
    });
  });
})();
