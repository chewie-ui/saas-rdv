/**
 * ds-select — habille les <select> marqués `data-ds-select`.
 *
 * Pourquoi : un <select> natif ne se laisse pas styler. On peut redessiner le
 * champ, mais la LISTE reste celle du système (fond bleu Windows, police
 * système), ce qui casse la cohérence visuelle du reste du site.
 *
 * Principe : on construit un bouton + un panneau maison, et on GARDE le
 * <select> d'origine dans le DOM, masqué. Il reste la source de vérité :
 *   • `select.value` et `select.selectedOptions` restent justes ;
 *   • un événement `change` est émis à chaque choix ;
 *   • le JS déjà écrit sur ces <select> continue donc de marcher tel quel.
 *
 * Usage :
 *   <select data-ds-select class="js-mon-select">…</select>
 *   <select data-ds-select data-ds-select-size="sm" multiple>…</select>
 *
 * Les <select> ajoutés après coup (lignes injectées en JS) sont pris en charge
 * automatiquement : appeler window.dsSelect.scan() ou laisser l'observateur.
 */
(function () {
  "use strict";

  /* ── Panneaux flottants ───────────────────────────────────────────────────
     Un tableau est presque toujours dans un conteneur `overflow: auto` (pour
     le défilement horizontal). Or `overflow-x: auto` implique `overflow-y`,
     donc TOUT panneau ouvert depuis une cellule est coupé au bas du tableau.
     Solution : au moment de l'ouverture, on déplace le panneau dans <body> et
     on le positionne en `fixed` sous son bouton. Il échappe ainsi à tout
     ancêtre qui découpe. Les écouteurs posés sur le panneau et ses enfants
     suivent le déplacement, donc rien d'autre à changer.                     */
  function placerPanneau(panneau, ancre) {
    var r = ancre.getBoundingClientRect();
    if (panneau.parentElement !== document.body) document.body.appendChild(panneau);
    panneau.style.position = "fixed";
    panneau.style.minWidth = r.width + "px";
    panneau.style.left = r.left + "px";
    panneau.style.right = "auto";
    panneau.style.zIndex = "9999";

    // Mesure réelle puis bascule vers le haut s'il n'y a pas la place en bas.
    panneau.style.top = "-9999px";
    panneau.style.display = "block";
    var h = panneau.getBoundingClientRect().height;
    var placeEnDessous = window.innerHeight - r.bottom;
    if (h + 8 > placeEnDessous && r.top > placeEnDessous) {
      panneau.style.top = Math.max(8, r.top - h - 6) + "px";
    } else {
      panneau.style.top = r.bottom + 6 + "px";
    }

    // Ne pas déborder à droite de la fenêtre.
    var largeur = panneau.getBoundingClientRect().width;
    if (r.left + largeur > window.innerWidth - 8) {
      panneau.style.left = Math.max(8, window.innerWidth - largeur - 8) + "px";
    }
  }
  // Fonctions de fermeture de tous les selects habillés de la page.
  var instances = [];

  function rangerPanneau(panneau) {
    panneau.style.display = "";
    panneau.style.position = "";
    panneau.style.top = panneau.style.left = panneau.style.right = "";
    panneau.style.minWidth = panneau.style.zIndex = "";
  }

  function construire(sel) {
    if (!sel || sel.dataset.dsSelectDone === "1") return;
    sel.dataset.dsSelectDone = "1";

    var multi = sel.multiple;
    var petit = sel.dataset.dsSelectSize === "sm";

    var wrap = document.createElement("div");
    wrap.className = "ds-sel" + (petit ? " ds-sel--sm" : "");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ds-sel__btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML =
      '<span class="ds-sel__label"></span>' +
      '<span class="material-symbols-outlined ds-sel__chev">expand_more</span>';

    var menu = document.createElement("div");
    menu.className = "ds-sel__menu";
    menu.setAttribute("role", "listbox");

    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(btn);
    wrap.appendChild(menu);
    wrap.appendChild(sel);              // le natif reste dedans, masqué par le CSS
    sel.classList.add("ds-sel__native");
    sel.setAttribute("tabindex", "-1");

    // Recopie des options (une entrée par <option>, hors placeholder vide)
    function peupler() {
      menu.innerHTML = "";
      Array.prototype.forEach.call(sel.options, function (opt, i) {
        if (opt.disabled && opt.value === "") return;   // placeholder
        var it = document.createElement("div");
        it.className = "ds-sel__opt";
        it.setAttribute("role", "option");
        it.dataset.index = i;
        it.innerHTML =
          '<span class="ds-sel__opt-txt"></span>' +
          '<span class="material-symbols-outlined ds-sel__check">check</span>';
        if (opt.dataset.flag) {
          var img = document.createElement("img");
          img.className = "psel__flag";           // pastille drapeau (cf. ds.css)
          img.src = opt.dataset.flag;
          img.alt = "";
          it.insertBefore(img, it.firstChild);
        }
        it.querySelector(".ds-sel__opt-txt").textContent = opt.textContent.trim();
        menu.appendChild(it);
      });
    }

    function placeholder() {
      var ph = sel.querySelector('option[value=""]');
      return ph ? ph.textContent.trim() : "Sélectionner…";
    }

    function sync() {
      var choisis = Array.prototype.filter.call(sel.options, function (o) {
        return o.selected && o.value;
      });
      var lbl = wrap.querySelector(".ds-sel__label");
      lbl.textContent = "";
      if (!choisis.length) {
        lbl.textContent = placeholder();
        lbl.classList.add("is-empty");
      } else {
        lbl.classList.remove("is-empty");
        choisis.forEach(function (o, i) {
          if (i) lbl.appendChild(document.createTextNode(", "));
          if (o.dataset.flag) {
            var img = document.createElement("img");
            img.className = "psel__flag";
            img.src = o.dataset.flag;
            img.alt = "";
            lbl.appendChild(img);
          }
          lbl.appendChild(document.createTextNode(o.textContent.trim()));
        });
      }
      menu.querySelectorAll(".ds-sel__opt").forEach(function (it) {
        it.classList.toggle("is-selected", sel.options[+it.dataset.index].selected);
      });
    }

    // Idempotente : elle doit pouvoir être appelée même si la classe `is-open`
    // a déjà été retirée par quelqu'un d'autre, sinon le panneau reste orphelin
    // dans <body>, affiché, alors que son select est « fermé ».
    function fermer() {
      wrap.classList.remove("is-open");
      btn.setAttribute("aria-expanded", "false");
      if (menu.parentElement === document.body) {
        rangerPanneau(menu);
        wrap.appendChild(menu);        // on le remet à sa place dans le DOM
      }
    }
    instances.push(fermer);

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var ouvert = wrap.classList.contains("is-open");
      // Fermeture PROPRE des autres panneaux (et pas un simple retrait de
      // classe) : chacun doit ranger son panneau sorti dans <body>.
      instances.forEach(function (f) { f(); });
      // Les menus « ⋮ » sont pilotés par les pages : l'observateur plus bas
      // les range quand la classe disparaît.
      document.querySelectorAll(".psel.is-open, .ds-menu.is-open")
        .forEach(function (w) { w.classList.remove("is-open"); });
      if (!ouvert) {
        wrap.classList.add("is-open");
        btn.setAttribute("aria-expanded", "true");
        placerPanneau(menu, btn);
      }
    });

    // Le panneau est en position fixe : un défilement le laisserait en l'air.
    window.addEventListener("scroll", fermer, true);
    window.addEventListener("resize", fermer);

    menu.addEventListener("click", function (e) {
      var it = e.target.closest(".ds-sel__opt");
      if (!it) return;
      var opt = sel.options[+it.dataset.index];
      if (multi) {
        opt.selected = !opt.selected;          // coche / décoche
      } else {
        sel.value = opt.value;
        fermer();
      }
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
    });

    // `pointerdown` et non `click` : d'autres composants (menu « ⋮ », modales)
    // appellent stopPropagation() sur le clic, et le panneau restait alors
    // ouvert derrière le leur. Le pointerdown, lui, nous parvient toujours.
    document.addEventListener("pointerdown", function (e) {
      // `menu` peut être déplacé dans <body> : le tester séparément.
      if (!wrap.contains(e.target) && !menu.contains(e.target)) fermer();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") fermer();
    });

    // Si du code modifie le <select> par programme, on se resynchronise.
    sel.addEventListener("ds-sel:refresh", function () { peupler(); sync(); });

    peupler();
    sync();
  }

  function scan(racine) {
    (racine || document).querySelectorAll("select[data-ds-select]").forEach(construire);
  }

  /* ── Menus « ⋮ » (.ds-menu) ───────────────────────────────────────────────
     Composant purement CSS : ce sont les pages qui posent/enlèvent `is-open`.
     On les surveille ici pour leur appliquer le même traitement anti-découpe,
     sans rien changer dans les pages. */
  function surveillerMenus() {
    var observateur = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName !== "class") return;
        var el = m.target;
        if (!el.classList || !el.classList.contains("ds-menu")) return;
        var liste = el.dataset.dsList
          ? document.getElementById(el.dataset.dsList)
          : el.querySelector(".ds-menu__list") ||
            document.querySelector('.ds-menu__list[data-ds-owner="' + el.dataset.dsId + '"]');
        if (!liste) return;
        var declencheur = el.querySelector(".ds-kebab, .ds-ico, button");
        if (el.classList.contains("is-open")) {
          if (!el.dataset.dsId) {
            el.dataset.dsId = "dsm" + Math.round(performance.now() * 1000);
            liste.dataset.dsOwner = el.dataset.dsId;
          }
          placerPanneau(liste, declencheur || el);
        } else if (liste.dataset.dsOwner) {
          rangerPanneau(liste);
          el.appendChild(liste);
        }
      });
    });
    observateur.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  window.dsSelect = { scan: scan, build: construire, place: placerPanneau };

  function demarrer() { scan(); surveillerMenus(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", demarrer);
  } else {
    demarrer();
  }
})();
