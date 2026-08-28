/* ══════════════════════════════════════════════════════════════════════════
   SERVICE-NEW — comportements de la page (copie de la maquette)
   ─────────────────────────────────────────────────────────────────────────
   Stratégie volontaire après deux régressions dues à la cascade CSS : chaque
   mutation qui touche le serveur (créer/modifier/supprimer/réordonner) fait
   son appel puis RECHARGE la page. Le HTML repart alors du rendu serveur,
   qui est la seule source de vérité pour le groupement par catégorie, les
   compteurs et l'ordre — aucune resynchronisation DOM à la main, donc aucun
   risque de désync. Seuls les onglets, le repli d'une catégorie et l'état
   des modales restent purement côté client (rien à resynchroniser).

   Les routes appelées sont celles qui existent déjà :
     POST/PATCH/DELETE /api/services[/:id]     (prestations individuelles)
     PATCH/DELETE      /api/services/:id/image (image d'une prestation)
     PATCH             /api/services/reorder   (ordre — clé « items »)
     POST/PATCH/DELETE /api/courses[/:id]      (cours collectifs — API SÉPARÉE)
     PATCH/DELETE      /account/categories     (catégories)
   ═════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var root = document.getElementById("svnRoot");
  if (!root) return;

  var ACCENT = "#12a06e";
  var $ = function (id) { return document.getElementById(id); };

  // Le serveur explique ses refus (limite de forfait, couleur déjà prise, nom
  // manquant). Jeter un « HTTP 403 » nu remplacerait un message utile par un
  // message générique — c'est le refus le plus fréquent, il doit se lire.
  function json(url, method, body) {
    return fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || d.success === false) {
          var e = new Error(d.message || d.error || "HTTP " + r.status);
          e.serveur = d.message || d.error || "";
          throw e;
        }
        return d;
      });
    });
  }
  function jsonForm(url, method, formData) {
    return fetch(url, { method: method, body: formData }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok || d.success === false) {
          var e = new Error(d.message || d.error || "HTTP " + r.status);
          e.serveur = d.message || d.error || "";
          throw e;
        }
        return d;
      });
    });
  }

  function fmtDur(min, max) {
    var n = parseInt(min, 10) || 0;
    if (max && Number(max) > n) return n + "–" + max + " min";
    return n >= 60 ? (n % 60 ? Math.floor(n / 60) + " h " + (n % 60) : Math.floor(n / 60) + " h") : n + " min";
  }
  function fmtPrice(p) {
    if (p === null || p === undefined || p === "") return "0 €";
    return Number(p) === 0 ? "Gratuit" : Number(p) + " €";
  }

  var svcFiches = JSON.parse(($("svnServiceFiches") || {}).textContent || "{}");
  var crsFiches = JSON.parse(($("svnCourseFiches") || {}).textContent || "{}");
  var EMPLOYEES = JSON.parse(($("svnEmployees") || {}).textContent || "[]");
  var CATEGORIES = JSON.parse(($("svnCategories") || {}).textContent || "[]");
  var COLORS = JSON.parse(($("svnColors") || {}).textContent || "[]");
  var USED_COLORS = JSON.parse(($("svnUsedColors") || {}).textContent || "[]");
  var DOW = [{ l: "Lu", d: 1 }, { l: "Ma", d: 2 }, { l: "Me", d: 3 }, { l: "Je", d: 4 }, { l: "Ve", d: 5 }, { l: "Sa", d: 6 }, { l: "Di", d: 0 }];

  /* ── Onglets ──────────────────────────────────────────────────────────── */
  var tabS = $("svnTabServices"), tabC = $("svnTabCourses");
  function selectTab(which) {
    var onS = which === "services";
    tabS.style.color = onS ? ACCENT : "#8c968f";
    $("svnTabServicesBar").style.background = onS ? ACCENT : "transparent";
    $("svnTabServicesN").style.background = onS ? "#e6f6ee" : "#f2f4f2";
    $("svnTabServicesN").style.color = onS ? "#0d7a54" : "#8c968f";
    tabC.style.color = !onS ? ACCENT : "#8c968f";
    $("svnTabCoursesBar").style.background = !onS ? ACCENT : "transparent";
    $("svnTabCoursesN").style.background = !onS ? "#e6f6ee" : "#f2f4f2";
    $("svnTabCoursesN").style.color = !onS ? "#0d7a54" : "#8c968f";
    $("svnPanelServices").hidden = !onS;
    $("svnPanelCourses").hidden = onS;
    updateSummary(which);
    try { sessionStorage.setItem("svnTab", which); } catch (e) {}
  }
  function updateSummary(which) {
    if (which === "services") {
      var rows = document.querySelectorAll("#svnPanelServices .svn-row");
      var off = 0;
      rows.forEach(function (r) { if (r.querySelector(".svn-sw__lb").textContent === "Masqué") off++; });
      $("svnSummary").textContent = rows.length + (rows.length > 1 ? " prestations · " : " prestation · ")
        + CATEGORIES.length + (CATEGORIES.length > 1 ? " catégories · " : " catégorie · ") + off + " masquée(s)";
    } else {
      var cards = document.querySelectorAll("#svnPanelCourses .svn-course");
      var rec = 0;
      cards.forEach(function (c) { if (c.querySelector(".svn-modebadge").textContent.trim() === "Récurrent") rec++; });
      $("svnSummary").textContent = cards.length + (cards.length > 1 ? " cours collectifs · " : " cours collectif · ") + rec + " récurrents";
    }
  }
  tabS.addEventListener("click", function () { selectTab("services"); });
  tabC.addEventListener("click", function () { selectTab("courses"); });
  try {
    var memo = sessionStorage.getItem("svnTab");
    selectTab(memo === "courses" ? "courses" : "services");
  } catch (e) { selectTab("services"); }

  /* ── Repli d'une catégorie ────────────────────────────────────────────── */
  root.addEventListener("click", function (e) {
    var t = e.target.closest(".svn-gtoggle");
    if (!t) return;
    var group = t.closest(".svn-group");
    var body = group.querySelector(".svn-gbody");
    var chevron = t.querySelector(".svn-chevron");
    var closed = body.style.display === "none";
    body.style.display = closed ? "" : "none";
    chevron.textContent = closed ? "expand_more" : "chevron_right";
  });

  /* ── Suppression de catégorie (immédiate, comme la maquette) ──────────── */
  root.addEventListener("click", function (e) {
    var t = e.target.closest("[data-svncatdel]");
    if (!t) return;
    json("/account/categories/" + encodeURIComponent(t.dataset.svncatdel), "DELETE")
      .then(function () { window.location.reload(); })
      .catch(function () { window.location.reload(); });
  });

  /* ── Activation / masquage d'un service ───────────────────────────────── */
  root.addEventListener("click", function (e) {
    var t = e.target.closest(".svn-toggle");
    if (!t) return;
    t.disabled = true;
    json("/api/services/" + t.dataset.svntoggle + "/toggle", "PATCH")
      .then(function () { window.location.reload(); })
      .catch(function (err) { t.disabled = false; alert(err.serveur || "L'action a échoué."); });
  });

  /* ── Réordonnancement (flèches) ───────────────────────────────────────── */
  root.addEventListener("click", function (e) {
    var t = e.target.closest("[data-svnmove]");
    if (!t) return;
    var row = t.closest(".svn-row");
    var body = row.parentElement;
    var dir = t.dataset.svnmove;
    var sib = dir === "up" ? row.previousElementSibling : row.nextElementSibling;
    if (!sib || !sib.classList || !sib.classList.contains("svn-row")) return;
    if (dir === "up") body.insertBefore(row, sib);
    else body.insertBefore(sib, row);

    // L'API attend { items: [{id, category}] } — PAS { services: [...] }.
    var items = [];
    document.querySelectorAll("#svnPanelServices .svn-row").forEach(function (r) {
      items.push({ id: r.dataset.svnrow, category: r.dataset.svncat || "" });
    });
    json("/api/services/reorder", "PATCH", { items: items }).then(function () {
      window.location.reload();
    }).catch(function () { window.location.reload(); });
  });

  /* ── Suppression en ligne (services et cours) ─────────────────────────── */
  function idleDelHtml() {
    return '<button type="button" data-svnask style="width:36px;height:36px;border-radius:10px;border:1px solid #e6eae7;background:#fff;cursor:pointer;color:#c2554b;display:flex;align-items:center;justify-content:center">'
      + '<span class="material-symbols-outlined" style="font-size:18px">close</span></button>';
  }
  function confirmDelHtml() {
    return '<button type="button" data-svnabort style="height:36px;padding:0 12px;border-radius:10px;border:1px solid #e6eae7;background:#fff;cursor:pointer;font:600 12px/1 \'Plus Jakarta Sans\',sans-serif;color:#5f6b64">Non</button>'
      + '<button type="button" data-svnconfirmdel style="height:36px;padding:0 12px;border-radius:10px;border:0;background:#c2554b;color:#fff;cursor:pointer;font:700 12px/1 \'Plus Jakarta Sans\',sans-serif;white-space:nowrap">Supprimer</button>';
  }
  root.addEventListener("click", function (e) {
    var zone = e.target.closest(".svn-delzone");
    if (zone) {
      if (e.target.closest("[data-svnask]")) { zone.innerHTML = confirmDelHtml(); return; }
      if (e.target.closest("[data-svnabort]")) { zone.innerHTML = idleDelHtml(); return; }
      if (e.target.closest("[data-svnconfirmdel]")) {
        var id = zone.dataset.svndel;
        json("/api/services/" + id, "DELETE").then(function () { window.location.reload(); })
          .catch(function (err) { alert(err.serveur || "La suppression a échoué."); zone.innerHTML = idleDelHtml(); });
        return;
      }
    }
    var cfoot = e.target.closest(".svn-cfoot");
    if (cfoot) {
      if (e.target.closest("[data-svnask]")) {
        cfoot.innerHTML = '<span style="flex:1;min-width:120px;font:500 12px/1.4 \'Plus Jakarta Sans\',sans-serif;color:#c2554b;align-self:center">Supprimer ce cours ?</span>'
          + '<button type="button" data-svnabort style="height:38px;padding:0 14px;border-radius:10px;border:1px solid #e6eae7;background:#fff;cursor:pointer;font:600 12.5px/1 \'Plus Jakarta Sans\',sans-serif;color:#5f6b64">Non</button>'
          + '<button type="button" data-svnconfirmdel style="height:38px;padding:0 16px;border-radius:10px;border:0;background:#c2554b;color:#fff;cursor:pointer;font:700 12.5px/1 \'Plus Jakarta Sans\',sans-serif">Oui, supprimer</button>';
        return;
      }
      if (e.target.closest("[data-svnabort]")) {
        var courseId = cfoot.closest(".svn-course").dataset.svncourse;
        cfoot.innerHTML = '<button type="button" data-svnask style="height:38px;padding:0 14px;border-radius:10px;border:1px solid #e6eae7;background:#fff;cursor:pointer;font:600 12.5px/1 \'Plus Jakarta Sans\',sans-serif;color:#c2554b">Supprimer</button>'
          + '<button type="button" data-svnedit-course="' + courseId + '" style="height:38px;padding:0 16px;border-radius:10px;border:1px solid #e6eae7;background:#fff;cursor:pointer;font:600 12.5px/1 \'Plus Jakarta Sans\',sans-serif;color:#1a201d">Modifier</button>';
        return;
      }
      if (e.target.closest("[data-svnconfirmdel]")) {
        // Un cours se supprime par SON API : deleteService filtre sur
        // type != group et ne toucherait pas l'enregistrement.
        var cid = cfoot.closest(".svn-course").dataset.svncourse;
        json("/api/courses/" + cid, "DELETE").then(function () { window.location.reload(); })
          .catch(function (err) { alert(err.serveur || "La suppression a échoué."); window.location.reload(); });
        return;
      }
    }
  });

  /* ══ Overlays génériques ═══════════════════════════════════════════════ */
  function openOv(ov) { ov.hidden = false; document.body.style.overflow = "hidden"; }
  function closeOv(ov) { ov.hidden = true; document.body.style.overflow = ""; }
  document.querySelectorAll(".svn-overlay").forEach(function (ov) {
    ov.addEventListener("click", function (e) { if (e.target === ov) closeOv(ov); });
  });
  root.addEventListener("click", function (e) {
    var c = e.target.closest("[data-svnclose]");
    if (c) closeOv(c.closest(".svn-overlay"));
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".svn-overlay").forEach(function (ov) { if (!ov.hidden) closeOv(ov); });
  });
  function hideErr(box) { box.hidden = true; box.textContent = ""; }
  function showErr(box, msg) { box.hidden = false; box.textContent = msg; }
  function toggleSw(btn, on) {
    var sw = btn.querySelector(".svn-sw"), knob = btn.querySelector(".svn-sw__knob");
    sw.style.background = on ? ACCENT : "#d6dade";
    knob.style.transform = "translateX(" + (on ? (sw.offsetWidth > 30 ? "18px" : "16px") : "0px") + ")";
  }

  /* ══ MODALE SERVICE ═════════════════════════════════════════════════════ */
  var ovSvc = $("svnSvcOv");
  var sf = { category: "", color: COLORS[0], active: true, approx: false, fee: false };
  var svcEditId = null;
  var pendingImageFile = null, pendingImageRemoved = false;

  function paintCats() {
    document.querySelectorAll("#svnFCats .svn-chip").forEach(function (b) {
      var on = b.dataset.svncat === sf.category;
      b.style.border = "1px solid " + (on ? ACCENT : "#e0e3e5");
      b.style.background = on ? "#e9f7f0" : "#fff";
      b.style.color = on ? "#0d7a54" : "#4d5560";
    });
  }
  // Une couleur prise par un AUTRE service est refusée par le serveur. On la
  // grise plutôt que de laisser l'admin la choisir et se prendre l'erreur.
  function colorTaken(hex) {
    return USED_COLORS.some(function (u) {
      return u.color && u.color.toLowerCase() === hex.toLowerCase() && u.id !== svcEditId;
    });
  }
  function firstFreeColor() {
    for (var i = 0; i < COLORS.length; i++) { if (!colorTaken(COLORS[i])) return COLORS[i]; }
    return COLORS[0];
  }
  function paintColors() {
    document.querySelectorAll("#svnFColors .svn-color").forEach(function (b) {
      var hex = b.dataset.svncolor;
      var taken = colorTaken(hex);
      var on = hex === sf.color;
      b.disabled = taken;
      b.style.opacity = taken ? "0.25" : "1";
      b.style.cursor = taken ? "not-allowed" : "pointer";
      b.title = taken ? "Déjà utilisée par un autre service" : "";
      b.style.boxShadow = on ? "0 0 0 2px #fff, 0 0 0 4px " + hex : "none";
      var marqueCouleur = b.querySelector(".svn-colormark");
      if (marqueCouleur) marqueCouleur.textContent = on ? "check" : "";
    });

    // Pastille « couleur libre » : elle prend l'apparence de la teinte
    // choisie dès qu'on sort de la palette, pour qu'on voie ce qui est
    // sélectionné sans avoir à rouvrir le sélecteur.
    var champ = $("svnColorPicker");
    if (champ) {
      var horsPalette = COLORS.indexOf(sf.color) === -1;
      var marque = $("svnColorCustomMark");
      // Le champ affiche toujours la couleur courante, pour que le sélecteur
      // s'ouvre sur la bonne teinte. `is-vierge` le repeint en blanc tant
      // qu'on est resté dans la palette, sinon la pastille afficherait une
      // couleur qui n'est pas celle du service.
      champ.value = /^#[0-9a-f]{6}$/i.test(sf.color) ? sf.color : "#12a06e";
      champ.classList.toggle("is-vierge", !horsPalette);
      champ.style.border = horsPalette ? "0" : "1.5px dashed #c3ccc6";
      champ.style.boxShadow = horsPalette ? "0 0 0 2px #fff, 0 0 0 4px " + sf.color : "none";
      if (marque) {
        marque.textContent = horsPalette ? "check" : "add";
        marque.style.color = horsPalette ? "#fff" : "#5f6b64";
      }
    }

    $("svnPvColor").style.background = sf.color;
  }
  function paintPreview() {
    var name = $("svnFName").value.trim();
    var catLabel = sf.category
      ? (CATEGORIES.find(function (c) { return c.name === sf.category; }) || { name: sf.category }).name
      : "Sans catégorie";
    $("svnPvName").textContent = name || "Nom du service";
    $("svnPvMeta").textContent = fmtDur($("svnFDur").value || 30, sf.approx ? $("svnFDurMax").value : "") + " · " + catLabel;
    $("svnPvPrice").textContent = fmtPrice($("svnFPrice").value);
  }
  function resetImageBox() {
    pendingImageFile = null; pendingImageRemoved = false;
    $("svnImgBox").style.backgroundImage = "";
    $("svnImgPh").hidden = false; $("svnImgTxt").hidden = false; $("svnImgRemove").hidden = true;
  }
  function setImagePreview(url) {
    $("svnImgBox").style.backgroundImage = "url('" + url + "')";
    $("svnImgPh").hidden = true; $("svnImgTxt").hidden = true; $("svnImgRemove").hidden = false;
  }

  function openServiceModal(id) {
    hideErr($("svnSvcErr"));
    resetImageBox();
    if (id) {
      var f = svcFiches[id];
      svcEditId = id;
      $("svnSvcTitle").textContent = "Modifier le service";
      $("svnFSave").textContent = "Enregistrer";
      $("svnFName").value = f.name;
      $("svnFDesc").value = f.description;
      $("svnFPrice").value = f.price;
      $("svnFDur").value = f.duration;
      sf.category = f.category; sf.color = f.color || COLORS[0]; sf.active = f.active;
      sf.approx = !!f.durationMax;
      $("svnFDurMax").value = f.durationMax || "";
      $("svnFDurMaxWrap").hidden = !sf.approx;
      toggleSw($("svnFApprox"), sf.approx);
      sf.fee = !!(f.cancellationFee && f.cancellationFee.enabled);
      $("svnFFeeWrap").hidden = !sf.fee;
      $("svnFFeeAmt").value = (f.cancellationFee && f.cancellationFee.value) || "";
      toggleSw($("svnFFee"), sf.fee);
      toggleSw($("svnFActive"), sf.active);
      $("svnFActiveLb").textContent = sf.active ? "Service actif — visible et réservable par les clients." : "Service masqué — invisible sur votre page publique.";
      if (f.image) setImagePreview("/uploads/profiles/" + f.image);
    } else {
      svcEditId = null;
      $("svnSvcTitle").textContent = "Nouveau service";
      $("svnFSave").textContent = "Créer le service";
      $("svnFName").value = ""; $("svnFDesc").value = ""; $("svnFPrice").value = ""; $("svnFDur").value = "30";
      sf.category = ""; sf.color = firstFreeColor(); sf.active = true; sf.approx = false; sf.fee = false;
      $("svnFDurMax").value = ""; $("svnFDurMaxWrap").hidden = true; toggleSw($("svnFApprox"), false);
      $("svnFFeeWrap").hidden = true; $("svnFFeeAmt").value = ""; toggleSw($("svnFFee"), false);
      toggleSw($("svnFActive"), true);
      $("svnFActiveLb").textContent = "Service actif — visible et réservable par les clients.";
    }
    paintCats(); paintColors(); paintPreview();
    openOv(ovSvc);
  }

  $("svnNewSvc").addEventListener("click", function () { openServiceModal(null); });
  root.addEventListener("click", function (e) {
    var t = e.target.closest("[data-svnedit]");
    if (t) openServiceModal(t.dataset.svnedit);
  });

  ["svnFName", "svnFPrice", "svnFDur", "svnFDurMax"].forEach(function (id) {
    $(id).addEventListener("input", paintPreview);
  });
  $("svnFCats").addEventListener("click", function (e) {
    var b = e.target.closest(".svn-chip");
    if (!b) return;
    sf.category = b.dataset.svncat;
    paintCats(); paintPreview();
  });
  $("svnFColors").addEventListener("click", function (e) {
    var b = e.target.closest(".svn-color");
    if (!b) return;
    sf.color = b.dataset.svncolor;
    // Reprendre une couleur de la palette corrige forcément un éventuel
    // « couleur déjà utilisée » : le message ne doit pas survivre à sa cause.
    hideErr($("svnSvcErr"));
    paintColors();
  });

  // ── Couleur libre ────────────────────────────────────────────────────
  // Le sélecteur natif se ferme sur un choix, mais émet « input » en continu
  // pendant que l'utilisateur déplace le curseur : on écoute les deux pour
  // que l'aperçu suive en direct, et on ne prévient qu'au « change » final
  // — sinon l'alerte se déclencherait à chaque nuance survolée.
  var champCouleur = $("svnColorPicker");
  if (champCouleur) {
    champCouleur.addEventListener("input", function () {
      var v = String(this.value || "").toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(v)) return;
      sf.color = v;
      paintColors();
    });
    champCouleur.addEventListener("change", function () {
      var v = String(this.value || "").toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(v)) return;
      // Le serveur refuse deux services de même couleur : on le dit tout de
      // suite plutôt que de laisser découvrir l'erreur à l'enregistrement.
      if (colorTaken(v)) {
        showErr($("svnSvcErr"), "Cette couleur est déjà utilisée par une autre prestation. Choisissez-en une autre.");
        sf.color = firstFreeColor();
      } else {
        hideErr($("svnSvcErr"));
        sf.color = v;
      }
      paintColors();
    });
  }
  $("svnFApprox").addEventListener("click", function () {
    sf.approx = !sf.approx;
    toggleSw($("svnFApprox"), sf.approx);
    $("svnFDurMaxWrap").hidden = !sf.approx;
    paintPreview();
  });
  $("svnFActive").addEventListener("click", function () {
    sf.active = !sf.active;
    toggleSw($("svnFActive"), sf.active);
    $("svnFActiveLb").textContent = sf.active ? "Service actif — visible et réservable par les clients." : "Service masqué — invisible sur votre page publique.";
  });
  $("svnFFee").addEventListener("click", function () {
    sf.fee = !sf.fee;
    toggleSw($("svnFFee"), sf.fee);
    $("svnFFeeWrap").hidden = !sf.fee;
  });
  $("svnImgFile").addEventListener("change", function () {
    var file = this.files && this.files[0];
    if (!file) return;
    pendingImageFile = file; pendingImageRemoved = false;
    setImagePreview(URL.createObjectURL(file));
  });
  $("svnImgRemove").addEventListener("click", function (e) {
    e.preventDefault(); e.stopPropagation();
    $("svnImgFile").value = "";
    pendingImageFile = null; pendingImageRemoved = true;
    resetImageBox();
  });

  $("svnFSave").addEventListener("click", function () {
    var name = $("svnFName").value.trim();
    if (!name) { showErr($("svnSvcErr"), "Le nom du service est requis."); return; }
    hideErr($("svnSvcErr"));
    var corps = {
      name: name,
      description: $("svnFDesc").value.trim(),
      price: $("svnFPrice").value === "" ? "" : Number($("svnFPrice").value),
      duration: Number($("svnFDur").value) || 30,
      durationMax: sf.approx ? ($("svnFDurMax").value || "") : "",
      category: sf.category,
      color: sf.color,
      active: sf.active,
    };
    // Forme réelle du schéma : { enabled, type, value }. Un objet
    // { amount, hours } (celui de la maquette) écraserait les frais existants.
    if (sf.fee) {
      corps.cancellationFee = { enabled: true, type: "amount", value: Number($("svnFFeeAmt").value) || 0 };
    } else if (svcEditId) {
      corps.cancellationFee = { enabled: false, type: "amount", value: null };
    }
    var btn = this; btn.disabled = true;
    var req = svcEditId ? json("/api/services/" + svcEditId, "PATCH", corps) : json("/api/services", "POST", corps);
    req.then(function (d) {
      // L'image part en second temps : multipart, sur sa propre route.
      var id = d.service._id;
      if (pendingImageFile) {
        var fd = new FormData(); fd.append("image", pendingImageFile);
        return jsonForm("/api/services/" + id + "/image", "PATCH", fd);
      }
      if (pendingImageRemoved && svcEditId && svcFiches[svcEditId] && svcFiches[svcEditId].image) {
        return json("/api/services/" + id + "/image", "DELETE");
      }
    }).then(function () { window.location.reload(); })
      .catch(function (err) { btn.disabled = false; showErr($("svnSvcErr"), err.serveur || "L'enregistrement a échoué. Réessayez."); });
  });

  /* ══ MODALE COURS COLLECTIF ═════════════════════════════════════════════ */
  var ovCrs = $("svnCrsOv");
  var cf = { mode: "recurring", weekdays: [], startTime: "", employees: [], empFlag: false, sessions: [], block: true };
  var crsEditId = null;

  function paintMode() {
    var rec = cf.mode === "recurring";
    var r = $("svnModeRec"), f = $("svnModeFix");
    r.style.border = "1px solid " + (rec ? ACCENT : "#e6eae7");
    r.style.background = rec ? "#e9f7f0" : "#f9fbfa";
    r.children[0].style.color = rec ? "#0c5e42" : "#1a201d";
    r.children[1].style.color = rec ? "#3f8468" : "#8c968f";
    f.style.border = "1px solid " + (!rec ? ACCENT : "#e6eae7");
    f.style.background = !rec ? "#e9f7f0" : "#f9fbfa";
    f.children[0].style.color = !rec ? "#0c5e42" : "#1a201d";
    f.children[1].style.color = !rec ? "#3f8468" : "#8c968f";
    $("svnCRecWrap").hidden = !rec;
    $("svnCFixWrap").hidden = rec;
  }
  function paintDays() {
    document.querySelectorAll("#svnCDays .svn-day").forEach(function (b) {
      var on = cf.weekdays.indexOf(Number(b.dataset.svnday)) >= 0;
      b.style.border = "1px solid " + (on ? ACCENT : "#e0e3e5");
      b.style.background = on ? "#082a1c" : "#fff";
      b.style.color = on ? "#fff" : "#4d5560";
    });
  }
  function paintEmpChips() {
    document.querySelectorAll("#svnCEmpWrap .svn-empchip").forEach(function (b) {
      var on = cf.employees.indexOf(b.dataset.svnemp) >= 0;
      b.style.border = "1px solid " + (on ? ACCENT : "#e0e3e5");
      b.style.background = on ? "#e9f7f0" : "#fff";
      b.style.color = on ? "#0d7a54" : "#4d5560";
      var emp = EMPLOYEES.find(function (e) { return e.id === b.dataset.svnemp; });
      b.innerHTML = "";
      b.appendChild(document.createTextNode(emp ? emp.name : ""));
      if (on) {
        var ic = document.createElement("span");
        ic.className = "material-symbols-outlined";
        ic.style.fontSize = "16px";
        ic.textContent = "check";
        b.appendChild(ic);
      }
    });
  }
  function dayLabel(n) { var d = DOW.find(function (x) { return x.d === n; }); return d ? d.l : ""; }
  function courseSummary() {
    var name = $("svnCName").value.trim() || "Votre cours";
    var dur = fmtDur($("svnCDur").value || 60);
    var places = $("svnCPlaces").value || "0";
    var price = fmtPrice($("svnCPrice").value);
    var tail;
    if (cf.mode === "recurring") {
      tail = cf.weekdays.length
        ? " · " + cf.weekdays.slice().sort().map(dayLabel).join(", ") + ($("svnCTime").value ? " à " + $("svnCTime").value : "")
        : " · choisissez au moins un jour";
    } else {
      tail = " · " + cf.sessions.length + (cf.sessions.length > 1 ? " dates" : " date");
    }
    $("svnCSummary").textContent = name + " · " + dur + " · " + places + " places · " + price + tail;
  }

  function renderSessRow(sess, idx) {
    var row = document.createElement("div");
    row.style.cssText = "display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center";
    row.innerHTML =
      '<input type="date" value="' + (sess.date || "") + '" style="height:40px;padding:0 10px;border:1px solid #e0e3e5;border-radius:9px;background:#fff;outline:none;font:500 13px/1 \'Plus Jakarta Sans\',sans-serif;color:#1a201d">'
      + '<input type="time" value="' + (sess.startTime || "") + '" style="width:90px;height:40px;padding:0 8px;border:1px solid #e0e3e5;border-radius:9px;background:#fff;outline:none;font:500 13px/1 \'Plus Jakarta Sans\',sans-serif;color:#1a201d">'
      + '<input type="time" value="' + (sess.endTime || "") + '" style="width:90px;height:40px;padding:0 8px;border:1px solid #e0e3e5;border-radius:9px;background:#fff;outline:none;font:500 13px/1 \'Plus Jakarta Sans\',sans-serif;color:#1a201d">'
      + '<button type="button" style="width:36px;height:36px;border-radius:9px;border:1px solid #e6eae7;background:#fff;cursor:pointer;color:#c2554b;display:flex;align-items:center;justify-content:center">'
      + '<span class="material-symbols-outlined" style="font-size:16px">close</span></button>';
    var inputs = row.querySelectorAll("input");
    inputs[0].addEventListener("change", function () { cf.sessions[idx].date = this.value; });
    inputs[1].addEventListener("change", function () { cf.sessions[idx].startTime = this.value; });
    inputs[2].addEventListener("change", function () { cf.sessions[idx].endTime = this.value; });
    row.querySelector("button").addEventListener("click", function () {
      cf.sessions.splice(idx, 1);
      paintSessions();
      courseSummary();
    });
    return row;
  }
  function paintSessions() {
    var box = $("svnCSess");
    box.innerHTML = "";
    if (cf.sessions.length === 0) {
      box.innerHTML = '<p style="margin:0;font:400 12.5px/1.55 \'Plus Jakarta Sans\',sans-serif;color:#8c968f">Ajoutez chaque date et son horaire.</p>';
      return;
    }
    cf.sessions.forEach(function (s, i) { box.appendChild(renderSessRow(s, i)); });
  }

  function openCourseModal(id) {
    hideErr($("svnCrsErr"));
    if (id) {
      var f = crsFiches[id];
      crsEditId = id;
      $("svnCrsTitle").textContent = "Modifier le cours collectif";
      $("svnCSave").textContent = "Enregistrer";
      $("svnCName").value = f.name; $("svnCDesc").value = f.description;
      $("svnCPrice").value = f.price; $("svnCDur").value = f.duration; $("svnCPlaces").value = f.capacity;
      $("svnCLoc").value = f.location;
      cf.block = f.blocksIndividualBookings !== false;
      toggleSw($("svnCBlock"), cf.block);
      $("svnCBlockLb").textContent = cf.block ? "Activé : personne ne peut réserver un rendez-vous individuel pendant le cours." : "Désactivé : vos clients peuvent continuer à réserver en parallèle.";
      cf.mode = f.mode || "recurring";
      cf.weekdays = (f.weekdays || []).slice();
      cf.startTime = f.startTime || "";
      $("svnCTime").value = cf.startTime;
      cf.sessions = (f.sessions || []).map(function (s) { return { date: s.date, startTime: s.startTime, endTime: s.endTime }; });
      cf.employees = (f.employees || []).slice();
      cf.empFlag = cf.employees.length > 0;
    } else {
      crsEditId = null;
      $("svnCrsTitle").textContent = "Nouveau cours collectif";
      $("svnCSave").textContent = "Créer le cours";
      $("svnCName").value = ""; $("svnCDesc").value = ""; $("svnCPrice").value = "";
      $("svnCDur").value = "60"; $("svnCPlaces").value = "10"; $("svnCLoc").value = "";
      cf.block = true;
      toggleSw($("svnCBlock"), true);
      $("svnCBlockLb").textContent = "Activé : personne ne peut réserver un rendez-vous individuel pendant le cours.";
      cf.mode = "recurring"; cf.weekdays = []; cf.startTime = ""; $("svnCTime").value = "";
      cf.sessions = []; cf.employees = []; cf.empFlag = false;
    }
    toggleSw($("svnCEmpFlag"), cf.empFlag);
    $("svnCEmpWrap").hidden = !cf.empFlag;
    paintMode(); paintDays(); paintEmpChips(); paintSessions(); courseSummary();
    openOv(ovCrs);
  }

  $("svnNewCrs").addEventListener("click", function () { openCourseModal(null); });
  root.addEventListener("click", function (e) {
    var t = e.target.closest("[data-svnedit-course]");
    if (t) openCourseModal(t.getAttribute("data-svnedit-course"));
  });

  ["svnCName", "svnCPrice", "svnCDur", "svnCPlaces", "svnCTime"].forEach(function (id) {
    $(id).addEventListener("input", courseSummary);
  });
  $("svnModeRec").addEventListener("click", function () { cf.mode = "recurring"; paintMode(); courseSummary(); });
  $("svnModeFix").addEventListener("click", function () { cf.mode = "fixed"; paintMode(); courseSummary(); });
  $("svnCDays").addEventListener("click", function (e) {
    var b = e.target.closest(".svn-day");
    if (!b) return;
    // data-svnday porte l'entier JS (lundi = 1, dimanche = 0), pas l'indice
    // d'affichage : le serveur range les jours dans cette convention.
    var d = Number(b.dataset.svnday);
    var i = cf.weekdays.indexOf(d);
    if (i >= 0) cf.weekdays.splice(i, 1); else cf.weekdays.push(d);
    paintDays(); courseSummary();
  });
  $("svnCBlock").addEventListener("click", function () {
    cf.block = !cf.block;
    toggleSw($("svnCBlock"), cf.block);
    $("svnCBlockLb").textContent = cf.block ? "Activé : personne ne peut réserver un rendez-vous individuel pendant le cours." : "Désactivé : vos clients peuvent continuer à réserver en parallèle.";
  });
  $("svnCEmpFlag").addEventListener("click", function () {
    cf.empFlag = !cf.empFlag;
    toggleSw($("svnCEmpFlag"), cf.empFlag);
    $("svnCEmpWrap").hidden = !cf.empFlag;
    if (!cf.empFlag) { cf.employees = []; paintEmpChips(); }
  });
  $("svnCEmpWrap").addEventListener("click", function (e) {
    var b = e.target.closest(".svn-empchip");
    if (!b) return;
    var id = b.dataset.svnemp;
    var i = cf.employees.indexOf(id);
    if (i >= 0) cf.employees.splice(i, 1); else cf.employees.push(id);
    paintEmpChips();
  });
  $("svnCAddSess").addEventListener("click", function () {
    cf.sessions.push({ date: "", startTime: "", endTime: "" });
    paintSessions(); courseSummary();
  });

  $("svnCSave").addEventListener("click", function () {
    var name = $("svnCName").value.trim();
    if (!name) { showErr($("svnCrsErr"), "Le nom du cours est requis."); return; }
    hideErr($("svnCrsErr"));
    // /api/courses et NON /api/services : createService ignore recurring,
    // sessions, employees, location et remet la capacité à 1.
    var corps = {
      name: name,
      description: $("svnCDesc").value.trim(),
      price: $("svnCPrice").value === "" ? "" : Number($("svnCPrice").value),
      duration: Number($("svnCDur").value) || 60,
      capacity: Number($("svnCPlaces").value) || 1,
      location: $("svnCLoc").value.trim(),
      blocksIndividualBookings: cf.block,
      employees: cf.empFlag ? cf.employees : [],
      mode: cf.mode,
    };
    if (cf.mode === "fixed") {
      corps.sessions = cf.sessions;
    } else {
      corps.weekdays = cf.weekdays;
      corps.startTime = $("svnCTime").value;
    }
    var btn = this; btn.disabled = true;
    var req = crsEditId ? json("/api/courses/" + crsEditId, "PATCH", corps) : json("/api/courses", "POST", corps);
    req.then(function () { window.location.reload(); })
      .catch(function (err) { btn.disabled = false; showErr($("svnCrsErr"), err.serveur || "L'enregistrement a échoué. Réessayez."); });
  });

  /* ══ MODALE CATÉGORIE ═══════════════════════════════════════════════════ */
  var ovCat = $("svnCatOv");
  var catIcon = "✂️";
  function paintIcons() {
    document.querySelectorAll("#svnCatIcons .svn-icon").forEach(function (b) {
      var on = b.dataset.svnicon === catIcon;
      b.style.border = (on ? "1.5px solid " + ACCENT : "1.5px solid #eef0ee");
      b.style.background = on ? "#e9f7f0" : "#fff";
    });
  }
  function openCategoryModal() {
    hideErr($("svnCatErr"));
    $("svnCatName").value = "";
    catIcon = document.querySelector("#svnCatIcons .svn-icon").dataset.svnicon;
    paintIcons();
    openOv(ovCat);
  }
  $("svnNewCat").addEventListener("click", openCategoryModal);
  $("svnCatIcons").addEventListener("click", function (e) {
    var b = e.target.closest(".svn-icon");
    if (!b) return;
    catIcon = b.dataset.svnicon;
    paintIcons();
  });
  $("svnCatSave").addEventListener("click", function () {
    var name = $("svnCatName").value.trim();
    if (!name) { showErr($("svnCatErr"), "Le nom de la catégorie est requis."); return; }
    hideErr($("svnCatErr"));
    // L'API remplace TOUTE la liste : on renvoie l'existante + la nouvelle.
    var next = CATEGORIES.concat([{ name: name, icon: catIcon }]);
    var btn = this; btn.disabled = true;
    json("/account/categories", "PATCH", { categories: next })
      .then(function () { window.location.reload(); })
      .catch(function (err) { btn.disabled = false; showErr($("svnCatErr"), err.serveur || "La création a échoué. Réessayez."); });
  });
})();
