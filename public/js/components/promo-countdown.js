/**
 * Compte à rebours de fin de campagne promo.
 *
 * Cible tout élément portant `data-promo-countdown="<date ISO>"` — le bandeau
 * peut donc apparaître plusieurs fois sur une même page (en-tête + section
 * tarifs) sans code supplémentaire.
 *
 * Quand l'échéance est passée, le bandeau est RETIRÉ plutôt que figé à zéro :
 * le serveur cesse déjà d'appliquer la remise à cet instant (utils/
 * promoCampaign.estEnCours), laisser l'offre affichée promettrait un prix que
 * le paiement refuserait.
 */
(function () {
  "use strict";

  function deuxChiffres(n) { return String(n).padStart(2, "0"); }

  function formater(ms) {
    var s = Math.floor(ms / 1000);
    var j = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    // Au-delà de 24 h, les secondes n'apportent qu'un scintillement inutile.
    if (j > 0) return j + "j " + h + "h " + deuxChiffres(m) + "m";
    return deuxChiffres(h) + ":" + deuxChiffres(m) + ":" + deuxChiffres(sec);
  }

  function init() {
    var cibles = [].slice.call(document.querySelectorAll("[data-promo-countdown]"));
    if (!cibles.length) return;

    var horloges = cibles.map(function (el) {
      var fin = new Date(el.getAttribute("data-promo-countdown")).getTime();
      return { el: el, fin: fin, valeur: el.querySelector(".promo__compte__valeur") };
    }).filter(function (h) { return !isNaN(h.fin); });

    if (!horloges.length) return;

    function tick() {
      var maintenant = Date.now();
      var restants = 0;

      horloges.forEach(function (h) {
        var delta = h.fin - maintenant;
        if (delta <= 0) {
          // On retire le bandeau entier, pas seulement le chrono.
          var bandeau = h.el.closest(".promo");
          if (bandeau) bandeau.remove(); else h.el.remove();
          return;
        }
        restants++;
        if (h.valeur) h.valeur.textContent = formater(delta);
      });

      if (!restants) clearInterval(minuteur);
    }

    tick();
    var minuteur = setInterval(tick, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
