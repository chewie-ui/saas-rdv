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
// L'ensemble est exposé sur `window.__pwa` pour que d'autres éléments d'interface
// (le bouton du menu mobile) déclenchent exactement le même parcours, sans
// dupliquer cette logique.
(function () {
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
    // `MSStream` : de vieux Windows Phone se faisaient passer pour iPhone.
    var ios = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    // iPadOS 13+ s'annonce comme un Mac : on le repère au tactile.
    var iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return ios || iPadOS;
  }

  function isSnoozed() {
    try {
      return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now();
    } catch (e) {
      // Navigation privée / stockage bloqué : on n'empêche pas l'affichage,
      // mais on ne plante pas non plus.
      return false;
    }
  }

  function snooze() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 864e5));
    } catch (e) {}
  }

  // Installable d'une manière ou d'une autre ? Sert au menu mobile pour ne pas
  // afficher un bouton qui ne mènerait à rien.
  function canInstall() {
    return !isInstalled() && (!!deferred || isIOS());
  }

  // ── Carte flottante ───────────────────────────────────────────────────────
  var card = document.getElementById("pwaCard");
  var btnInstall = document.getElementById("pwaInstall");
  var btnLater = document.getElementById("pwaLater");
  var btnClose = document.getElementById("pwaClose");
  var iosPane = document.getElementById("pwaIos");

  function applyIosMode() {
    if (!card) return;
    card.classList.add("is-ios");
    if (iosPane) iosPane.hidden = false;
    if (btnInstall) btnInstall.hidden = true;
  }

  function showCard() {
    if (!card) return;
    if (isIOS()) applyIosMode();
    card.hidden = false;
    // Le retrait de `hidden` et l'ajout de la classe doivent tomber sur deux
    // frames différentes, sinon la transition d'entrée ne joue pas.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        card.classList.add("is-open");
      });
    });
  }

  function hideCard(remember) {
    if (!card) return;
    if (remember) snooze();
    card.classList.remove("is-open");
    setTimeout(function () {
      card.hidden = true;
    }, 260);
  }

  // Déclenche la vraie boîte de dialogue du système (Android) ou, à défaut,
  // ouvre la carte avec la marche à suivre (iOS).
  function promptInstall() {
    if (!deferred) {
      showCard();
      return;
    }
    deferred.prompt();
    deferred.userChoice
      .then(function (choice) {
        hideCard(choice && choice.outcome !== "accepted");
      })
      .catch(function () {
        hideCard(false);
      })
      .then(function () {
        // Un `beforeinstallprompt` ne se rejoue pas : la référence est morte.
        deferred = null;
        notify();
      });
  }

  // Prévient l'interface (menu mobile) que l'état d'installabilité a changé.
  function notify() {
    document.dispatchEvent(
      new CustomEvent("pwa:state", { detail: { canInstall: canInstall(), isIOS: isIOS() } })
    );
  }

  window.__pwa = {
    canInstall: canInstall,
    isIOS: isIOS,
    isInstalled: isInstalled,
    promptInstall: promptInstall,
    showCard: showCard,
  };

  // ── Android / Chrome ──────────────────────────────────────────────────────
  window.addEventListener("beforeinstallprompt", function (e) {
    // Empêche la mini-barre native de Chrome : on veut notre propre carte, au
    // moment qu'on choisit.
    e.preventDefault();
    deferred = e;
    notify();
    if (card && !isSnoozed() && !isInstalled()) setTimeout(showCard, DELAY_MS);
  });

  window.addEventListener("appinstalled", function () {
    deferred = null;
    hideCard(false);
    snooze();
    notify();
  });

  if (btnInstall) btnInstall.addEventListener("click", promptInstall);
  if (btnLater) btnLater.addEventListener("click", function () { hideCard(true); });
  if (btnClose) btnClose.addEventListener("click", function () { hideCard(true); });

  // ── iOS / Safari ──────────────────────────────────────────────────────────
  // Pas d'événement à attendre : si on est sur iOS hors app, on programme
  // l'affichage de la carte en mode « marche à suivre ».
  if (card && isIOS() && !isInstalled() && !isSnoozed()) {
    setTimeout(showCard, DELAY_MS);
  }

  // État initial, pour le bouton du menu mobile (iOS notamment, où rien ne
  // viendra le déclencher autrement).
  notify();
  document.addEventListener("DOMContentLoaded", notify);
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

// ── Points d'entrée « Installer » disséminés dans l'interface ───────────────
// N'importe quel élément portant `data-pwa-install` devient un déclencheur :
// menu mobile de la vitrine, en-tête bureau, barre latérale admin, espace
// client… Un seul comportement, aucune logique dupliquée.
//
// Tous restent MASQUÉS tant que l'installation n'est pas réellement possible :
// sur un navigateur qui ne sait pas installer (Firefox mobile, Safari bureau),
// ou quand l'app est déjà installée, un bouton inerte est pire que pas de
// bouton du tout.
(function () {
  function sync() {
    var ok = !!(window.__pwa && window.__pwa.canInstall());
    var els = document.querySelectorAll("[data-pwa-install]");
    for (var i = 0; i < els.length; i++) els[i].hidden = !ok;
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-pwa-install]");
    if (!el || !window.__pwa) return;
    e.preventDefault();

    // Referme le menu mobile s'il est ouvert : sur iOS la carte s'ouvrirait
    // dessous, et sur Android la boîte système derrière un panneau resté
    // affiché.
    var cb = document.getElementById("headerNav");
    if (cb) cb.checked = false;

    window.__pwa.promptInstall();
  });

  document.addEventListener("pwa:state", sync);
  document.addEventListener("DOMContentLoaded", sync);
  sync();
})();
