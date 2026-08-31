/* ══════════════════════════════════════════════════════════════════════════
   BranShee — script d'intégration pour le site d'un professionnel
   ══════════════════════════════════════════════════════════════════════════

   Jusqu'ici il n'existait qu'un seul format : l'iframe posée dans la page.
   Elle marche, mais elle impose au pro de lui trouver une place et une
   hauteur — et sur beaucoup de sites, le calendrier finit coincé en bas de
   page, coupé, ou noyé dans le reste du contenu.

   Ce script en ajoute deux, qui n'ont pas ces défauts :

     • mode « popup »  — un bouton posé là où le pro veut ; au clic, le
       calendrier s'ouvre par-dessus la page, à la bonne taille, tout seul.
     • mode « bulle »  — un bouton flottant, présent sur TOUTES les pages du
       site, qui ouvre le même panneau.

   Dans les deux cas la page de réservation reste une iframe, mais elle n'est
   chargée qu'à l'ouverture : le site du pro ne paie rien tant que personne ne
   clique.

   Usage (le code est généré par Personnaliser → Intégration) :

     <script src="https://www.branshee.com/js/embed.js"
             data-branshee-url="https://www.branshee.com/mon-cabinet"
             data-branshee-mode="popup"
             data-branshee-label="Prendre rendez-vous"
             data-branshee-color="#12a06e"></script>

   Contraintes tenues volontairement :
   - aucune dépendance, aucun style global touché (tout est préfixé `bshe-`) ;
   - `document.currentScript` est lu AU CHARGEMENT : il vaut null plus tard,
     et plusieurs intégrations peuvent cohabiter sur une même page ;
   - les styles ne sont injectés qu'une fois, quel que soit le nombre de
     boutons.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return; // chargé en `async` sans currentScript : rien à ancrer

  var d = script.dataset || {};
  var url = (d.bransheeUrl || "").trim();
  if (!url) {
    // Sans URL, il n'y a rien à ouvrir. On le dit dans la console du pro
    // plutôt que de laisser un bouton mort sur son site.
    if (window.console) console.error("[BranShee] data-branshee-url est manquant.");
    return;
  }

  var mode     = (d.bransheeMode || "popup").toLowerCase();
  var label    = d.bransheeLabel || "Prendre rendez-vous";
  var couleur  = d.bransheeColor || "#12a06e";
  var position = (d.bransheePosition || "right").toLowerCase() === "left" ? "left" : "right";

  /* ── Styles (une seule fois par page) ──────────────────────────────────── */
  if (!document.getElementById("bshe-style")) {
    var st = document.createElement("style");
    st.id = "bshe-style";
    st.textContent = [
      /* Bouton posé dans la page. `all: unset` d'abord : sur un site inconnu,
         un `button` hérite de règles qu'on ne maîtrise pas (thème WordPress,
         reset agressif…). On repart de zéro plutôt que de lutter. */
      ".bshe-btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;",
      "cursor:pointer;font-family:inherit;font-size:15px;font-weight:600;line-height:1;",
      "padding:13px 22px;border-radius:10px;color:#fff;text-align:center;",
      "transition:filter .15s ease,transform .15s ease}",
      ".bshe-btn:hover{filter:brightness(1.08)}",
      ".bshe-btn:active{transform:translateY(1px)}",
      ".bshe-btn:focus-visible{outline:2px solid currentColor;outline-offset:3px}",
      ".bshe-btn svg{flex:none}",

      /* Bulle flottante */
      ".bshe-bubble{position:fixed;bottom:20px;z-index:2147483000;box-shadow:0 6px 24px rgba(0,0,0,.22);padding:14px 20px;border-radius:100px}",
      ".bshe-bubble--right{right:20px}",
      ".bshe-bubble--left{left:20px}",

      /* Panneau */
      ".bshe-ov{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;",
      "justify-content:center;padding:24px;background:rgba(15,23,42,.55);opacity:0;",
      "transition:opacity .18s ease}",
      ".bshe-ov.is-open{opacity:1}",
      ".bshe-panel{position:relative;width:100%;max-width:900px;height:min(92vh,900px);",
      "background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.35);",
      "transform:translateY(8px);transition:transform .18s ease}",
      ".bshe-ov.is-open .bshe-panel{transform:none}",
      ".bshe-panel iframe{display:block;width:100%;height:100%;border:0}",
      ".bshe-close{all:unset;box-sizing:border-box;position:absolute;top:10px;right:10px;",
      "width:34px;height:34px;display:flex;align-items:center;justify-content:center;",
      "cursor:pointer;border-radius:50%;background:rgba(255,255,255,.94);color:#0f172a;",
      "box-shadow:0 2px 8px rgba(0,0,0,.18);font-size:20px;line-height:1;z-index:2}",
      ".bshe-close:hover{background:#fff}",
      ".bshe-close:focus-visible{outline:2px solid #0f172a;outline-offset:2px}",

      /* Téléphone : plein écran, sinon le calendrier se retrouve dans un
         timbre-poste entouré de gris. */
      "@media (max-width:640px){",
      ".bshe-ov{padding:0}",
      ".bshe-panel{max-width:none;height:100%;border-radius:0}",
      ".bshe-bubble{bottom:14px}.bshe-bubble--right{right:14px}.bshe-bubble--left{left:14px}",
      "}",

      "@media (prefers-reduced-motion:reduce){",
      ".bshe-ov,.bshe-panel,.bshe-btn{transition:none}",
      "}",
    ].join("");
    document.head.appendChild(st);
  }

  /* ── Icône calendrier ──────────────────────────────────────────────────── */
  var ICONE =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>' +
    '<line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

  /* ── Le panneau ────────────────────────────────────────────────────────── */
  var overlay = null;
  var frame = null;
  var declencheur = null; // élément à re-focaliser à la fermeture

  function construire() {
    overlay = document.createElement("div");
    overlay.className = "bshe-ov";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Réservation en ligne");

    var panel = document.createElement("div");
    panel.className = "bshe-panel";

    var close = document.createElement("button");
    close.className = "bshe-close";
    close.type = "button";
    close.setAttribute("aria-label", "Fermer");
    close.innerHTML = "&times;";
    close.addEventListener("click", fermer);

    frame = document.createElement("iframe");
    frame.title = "Réservation en ligne";
    frame.setAttribute("allow", "payment");
    // `src` reste vide : on ne charge la page qu'à la première ouverture.

    panel.appendChild(close);
    panel.appendChild(frame);
    overlay.appendChild(panel);

    // Clic sur le fond (et pas dans le panneau) = fermer.
    overlay.addEventListener("mousedown", function (e) {
      if (e.target === overlay) fermer();
    });

    document.body.appendChild(overlay);
    return close;
  }

  function surEchap(e) {
    if (e.key === "Escape" || e.key === "Esc") fermer();
  }

  var scrollBloque = "";
  function ouvrir(src) {
    var close = overlay ? overlay.querySelector(".bshe-close") : construire();
    declencheur = document.activeElement;
    if (!frame.getAttribute("src")) frame.setAttribute("src", src || url);
    overlay.style.display = "flex";
    // Le navigateur doit avoir peint l'état fermé avant la transition.
    requestAnimationFrame(function () { overlay.classList.add("is-open"); });
    scrollBloque = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", surEchap);
    if (close && close.focus) close.focus();
  }

  function fermer() {
    if (!overlay) return;
    overlay.classList.remove("is-open");
    document.body.style.overflow = scrollBloque;
    document.removeEventListener("keydown", surEchap);
    var fin = function () { if (overlay) overlay.style.display = "none"; };
    // On attend la fin de la transition, sauf si elle est désactivée.
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches) fin();
    else setTimeout(fin, 190);
    if (declencheur && declencheur.focus) declencheur.focus();
    declencheur = null;
  }

  /* ── Le bouton ─────────────────────────────────────────────────────────── */
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bshe-btn" + (mode === "bubble" ? " bshe-bubble bshe-bubble--" + position : "");
  btn.style.background = couleur;
  btn.innerHTML = ICONE + "<span></span>";
  // Le libellé passe par textContent : il vient d'un champ libre côté admin,
  // et rien ne justifie d'y interpréter du HTML sur le site d'un client.
  btn.querySelector("span").textContent = label;
  btn.addEventListener("click", function () { ouvrir(url); });

  if (mode === "bubble") {
    // La bulle vit dans <body> : le script peut être placé n'importe où, y
    // compris dans le <head> d'un thème, où <body> n'existe pas encore.
    if (document.body) document.body.appendChild(btn);
    else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(btn); });
  } else {
    // Popup : le bouton prend la place exacte du <script>, donc l'endroit où
    // le pro a collé le code.
    script.parentNode.insertBefore(btn, script);
  }

  /* ── API publique, pour un pro qui veut son propre bouton ──────────────── */
  window.Branshee = window.Branshee || {};
  window.Branshee.open  = function (u) { ouvrir(u || url); };
  window.Branshee.close = fermer;
})();
