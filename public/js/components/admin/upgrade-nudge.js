/* Encart « passer au plan payant » : affichage et mise en sourdine.

   L'encart est rendu masqué par le serveur et révélé ici seulement s'il n'a pas
   été écarté récemment. Faire l'inverse ferait clignoter un bandeau que le pro
   avait justement demandé à ne plus voir.

   La mise en sourdine est stockée par MOTIF, pas globalement : masquer « il
   vous reste 3 rendez-vous » ne doit pas masquer, la semaine suivante,
   « vos clients ne peuvent plus réserver ». */
(function () {
  "use strict";

  var encart = document.querySelector(".upnudge");
  if (!encart) return;

  var CLE = "bs_upnudge_" + (encart.dataset.nudge || "defaut");
  var SILENCE_MS = 7 * 24 * 60 * 60 * 1000;

  function ecarteRecemment() {
    try {
      var t = parseInt(localStorage.getItem(CLE) || "0", 10);
      return Number.isFinite(t) && Date.now() - t < SILENCE_MS;
    } catch (e) {
      return false; // navigation privée, cookies bloqués : on affiche
    }
  }

  if (!ecarteRecemment()) encart.hidden = false;

  var fermer = encart.querySelector(".upnudge__close");
  if (fermer) {
    fermer.addEventListener("click", function () {
      encart.hidden = true;
      try { localStorage.setItem(CLE, String(Date.now())); } catch (e) { /* sans stockage : réapparaîtra */ }
    });
  }
})();
