// ── Installation de l'app (PWA) ─────────────────────────────────────────────
// Deux mondes très différents :
//
//  • Android / Chrome : le navigateur émet `beforeinstallprompt`. On l'intercepte
//    pour proposer NOTRE carte au bon moment, puis on déclenche la vraie boîte
//    de dialogue système au clic.
//  • iOS / Safari : AUCUNE API d'installation n'existe. La seule voie est le
//    menu Partager → « Sur l'écran d'accueil ». On affiche donc la marche à
//    suivre au lieu d'un bouton qui ne pourrait rien faire.
//
// Rien ne s'affiche si l'app est déjà installée, ni si l'utilisateur a refusé
// récemment : une invite d'installation qui revient à chaque page est le
// meilleur moyen de faire fuir les gens.
(function () {
  var card = document.getElementById("pwaCard");
  if (!card) return;

  var btnInstall = document.getElementById("pwaInstall");
  var btnLater = document.getElementById("pwaLater");
  var btnClose = document.getElementById("pwaClose");
  var iosPane = document.getElementById("pwaIos");

  var SNOOZE_KEY = "bs_pwa_snooze";
  var SNOOZE_DAYS = 30;
  var DELAY_MS = 2500; // laisse la page se poser avant de solliciter

  var deferred = null;

  // Déjà installée ? `standalone` couvre Android ; `navigator.standalone` est
  // la propriété propriétaire d'iOS, seule fiable là-bas.
  function isInstalled() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  function isIOS() {
    var ua = window.navigator.userAgent;
    // `MSStream` : vieux Windows Phone se faisaient passer pour iPhone.
    var ios = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    // iPadOS 13+ s'annonce comme un Mac : on le repère au tactile.
    var iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return ios || iPadOS;
  }

  function isSnoozed() {
    try {
      var until = Number(localStorage.getItem(SNOOZE_KEY) || 0);
      return until > Date.now();
    } catch (e) {
      // Navigation privée / stockage bloqué : on ne bloque pas l'affichage
      // pour autant, mais on ne plante pas non plus.
      return false;
    }
  }

  function snooze() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 864e5));
    } catch (e) {}
  }

  function show() {
    card.hidden = false;
    // Le retrait de `hidden` et l'ajout de la classe doivent être sur deux
    // frames différentes, sinon la transition d'entrée ne joue pas.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        card.classList.add("is-open");
      });
    });
  }

  function hide(remember) {
    if (remember) snooze();
    card.classList.remove("is-open");
    setTimeout(function () {
      card.hidden = true;
    }, 260);
  }

  if (isInstalled() || isSnoozed()) return;

  // ── Android / Chrome ──────────────────────────────────────────────────────
  window.addEventListener("beforeinstallprompt", function (e) {
    // Empêche la mini-barre native de Chrome : on veut notre propre carte,
    // au moment qu'on choisit.
    e.preventDefault();
    deferred = e;
    setTimeout(show, DELAY_MS);
  });

  if (btnInstall) {
    btnInstall.addEventListener("click", function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice
        .then(function (choice) {
          // Refus : on met en sourdine, sinon on harcèle.
          hide(choice && choice.outcome !== "accepted");
        })
        .catch(function () {
          hide(false);
        })
        .then(function () {
          // Un `beforeinstallprompt` ne se rejoue pas : la référence est morte.
          deferred = null;
        });
    });
  }

  // Installée depuis notre carte (ou depuis le menu du navigateur) : on range.
  window.addEventListener("appinstalled", function () {
    hide(false);
    snooze();
  });

  // ── iOS / Safari ──────────────────────────────────────────────────────────
  // Pas d'événement à attendre : si on est sur iOS hors app, on affiche la
  // carte en mode « marche à suivre ».
  if (isIOS()) {
    card.classList.add("is-ios");
    if (iosPane) iosPane.hidden = false;
    if (btnInstall) btnInstall.hidden = true;
    setTimeout(show, DELAY_MS);
  }

  if (btnLater) btnLater.addEventListener("click", function () { hide(true); });
  if (btnClose) btnClose.addEventListener("click", function () { hide(true); });
})();

// ── Enregistrement du service worker ────────────────────────────────────────
// Requis par Chrome pour proposer l'installation. Volontairement sans cache
// (cf. public/sw.js) : un cache mal maîtrisé fige les visiteurs sur une vieille
// version du site après un déploiement.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {
      // Échec silencieux : le site fonctionne parfaitement sans, on perd
      // seulement la proposition d'installation.
    });
  });
}
