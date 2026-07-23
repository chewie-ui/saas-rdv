/* ════════════════════════════════════════════════════════════════════════
   DsDragSort — tri par glisser-déposer, réutilisable, sans dépendance.

   Pointer Events (souris + tactile), fluide (transforms + rAF), avec animation
   FLIP du reflux des voisins, « soulèvement » de l'élément tiré et défilement
   automatique près des bords. Un clic normal reste possible (seuil de départ).

   Utilisation :
     DsDragSort.init(conteneur, {
       itemSelector:   '[data-ds-drag]',   // enfants triables
       handleSelector: '[data-ds-handle]', // (option) poignée ; sinon tout l'item
       onReorder: function (ids, info) {     // ids = data-ds-drag-id dans l'ordre
         // info = { item, from, to }
       }
     });
   Renvoie un contrôleur : { destroy() }.

   Le HTML doit porter, sur chaque item, un identifiant :
     <li data-ds-drag data-ds-drag-id="42"> … </li>
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var SEUIL = 6;               // px avant de considérer que c'est un glisser
  var BORD_SCROLL = 48;        // zone de déclenchement du défilement auto
  var VITESSE_SCROLL = 14;     // px par frame max

  function positionScrollable(el) {
    // Remonte jusqu'au premier ancêtre réellement défilable (sinon la fenêtre).
    var n = el.parentElement;
    while (n && n !== document.body) {
      var oy = getComputedStyle(n).overflowY;
      if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
      n = n.parentElement;
    }
    return null; // = fenêtre
  }

  function init(conteneur, opts) {
    if (!conteneur) return { destroy: function () {} };
    opts = opts || {};
    var itemSelector = opts.itemSelector || "[data-ds-drag]";
    var handleSelector = opts.handleSelector || null;

    var etat = null; // { item, pointerId, startY, startX, offsetX, offsetY, dragging, from }

    function items() {
      return Array.prototype.filter.call(conteneur.children, function (c) {
        return c.matches && c.matches(itemSelector);
      });
    }

    function indexDe(item) { return items().indexOf(item); }

    // ── FLIP : anime le déplacement des voisins entre deux états du DOM ──────
    function flip(mesureAvant) {
      items().forEach(function (el) {
        if (el === (etat && etat.item)) return;
        var avant = mesureAvant.get(el);
        if (avant == null) return;
        var d = avant - el.getBoundingClientRect().top;
        if (!d) return;
        el.style.transition = "none";
        el.style.transform = "translateY(" + d + "px)";
        // Force le reflow puis relâche vers 0 → glissement animé.
        void el.offsetHeight;
        el.style.transition = "transform .18s cubic-bezier(.2,.9,.3,1)";
        el.style.transform = "";
      });
    }
    function mesurerTops() {
      var m = new Map();
      items().forEach(function (el) { m.set(el, el.getBoundingClientRect().top); });
      return m;
    }

    // ── Départ du glisser ────────────────────────────────────────────────────
    function onPointerDown(e) {
      if (e.button != null && e.button !== 0) return; // clic gauche / tactile
      var item = e.target.closest(itemSelector);
      if (!item || item.parentElement !== conteneur) return;
      if (handleSelector && !e.target.closest(handleSelector)) return;

      var r = item.getBoundingClientRect();
      etat = {
        item: item,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: e.clientX - r.left,
        offsetY: e.clientY - r.top,
        width: r.width,
        dragging: false,
        from: indexDe(item),
      };
      document.addEventListener("pointermove", onPointerMove, { passive: false });
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
    }

    function demarrer() {
      etat.dragging = true;
      var it = etat.item;
      try { it.setPointerCapture(etat.pointerId); } catch (_) {}
      it.classList.add("ds-dragging");
      // Fige la largeur (l'item passe en position relative « soulevé »).
      it.style.width = etat.width + "px";
      it.style.zIndex = "50";
      it.style.position = "relative";
      it.style.pointerEvents = "none";
      document.body.classList.add("ds-drag-active");
      document.body.style.userSelect = "none";
    }

    // ── Déplacement ────────────────────────────────────────────────────────
    function onPointerMove(e) {
      if (!etat) return;
      var dx = e.clientX - etat.startX;
      var dy = e.clientY - etat.startY;

      if (!etat.dragging) {
        if (Math.abs(dx) < SEUIL && Math.abs(dy) < SEUIL) return;
        demarrer();
      }
      e.preventDefault();

      etat.item.style.transform = "translate(" + dx + "px," + dy + "px)";
      reordonnerSelonPointeur(e.clientY);
      defilementAuto(e.clientY);
    }

    // Réordonne le DOM si le pointeur a franchi le milieu d'un voisin.
    function reordonnerSelonPointeur(y) {
      var voisins = items().filter(function (el) { return el !== etat.item; });
      var cible = null;
      var avant = false;
      for (var i = 0; i < voisins.length; i++) {
        var r = voisins[i].getBoundingClientRect();
        var milieu = r.top + r.height / 2;
        if (y < milieu) { cible = voisins[i]; avant = true; break; }
      }
      var refNode = cible;
      // Si sous tous les voisins → à la fin.
      if (!refNode) {
        var mesure = mesurerTops();
        conteneur.appendChild(etat.item);
        flip(mesure);
        return;
      }
      // Déjà à la bonne place ?
      var suivant = etat.item.nextElementSibling;
      if (avant && suivant === refNode) return;
      var mesure2 = mesurerTops();
      conteneur.insertBefore(etat.item, refNode);
      flip(mesure2);
    }

    // ── Défilement automatique près des bords ──────────────────────────────
    var rafScroll = null;
    var scrollDir = 0;
    var scroller = null;
    function defilementAuto(y) {
      scroller = scroller || positionScrollable(conteneur);
      var haut, bas;
      if (scroller) {
        var r = scroller.getBoundingClientRect();
        haut = r.top; bas = r.bottom;
      } else {
        haut = 0; bas = window.innerHeight;
      }
      if (y < haut + BORD_SCROLL) scrollDir = -1;
      else if (y > bas - BORD_SCROLL) scrollDir = 1;
      else scrollDir = 0;

      if (scrollDir && !rafScroll) boucleScroll();
      if (!scrollDir && rafScroll) { cancelAnimationFrame(rafScroll); rafScroll = null; }
    }
    function boucleScroll() {
      if (!scrollDir || !etat) { rafScroll = null; return; }
      var pas = scrollDir * VITESSE_SCROLL;
      if (scroller) scroller.scrollTop += pas;
      else window.scrollBy(0, pas);
      rafScroll = requestAnimationFrame(boucleScroll);
    }

    // ── Dépôt ────────────────────────────────────────────────────────────────
    function onPointerUp() {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      if (rafScroll) { cancelAnimationFrame(rafScroll); rafScroll = null; }
      scrollDir = 0; scroller = null;

      if (!etat) return;
      var it = etat.item;

      if (!etat.dragging) { etat = null; return; } // simple clic

      // Repose l'élément à sa place finale, animé (le translate courant → 0).
      it.style.transition = "transform .18s cubic-bezier(.2,.9,.3,1)";
      it.style.transform = "translate(0,0)";
      var etatFige = etat;
      etat = null;

      function nettoyer() {
        it.classList.remove("ds-dragging");
        it.style.transition = "";
        it.style.transform = "";
        it.style.width = "";
        it.style.zIndex = "";
        it.style.position = "";
        it.style.pointerEvents = "";
        document.body.classList.remove("ds-drag-active");
        document.body.style.userSelect = "";
        it.removeEventListener("transitionend", nettoyer);
      }
      it.addEventListener("transitionend", nettoyer);
      // Filet : si aucune transition ne se déclenche (translate déjà nul).
      setTimeout(nettoyer, 240);

      var to = indexDe(it);
      if (to !== etatFige.from && typeof opts.onReorder === "function") {
        var ids = items().map(function (el) { return el.getAttribute("data-ds-drag-id"); });
        opts.onReorder(ids, { item: it, from: etatFige.from, to: to });
      }
    }

    conteneur.addEventListener("pointerdown", onPointerDown);

    return {
      destroy: function () {
        conteneur.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerUp);
      },
    };
  }

  window.DsDragSort = { init: init };
})();
