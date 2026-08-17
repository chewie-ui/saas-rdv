/* ══════════════════════════════════════════════════════════════════════════
   AVAILABILITY-NEW — comportements de la page (copie de la maquette)
   ─────────────────────────────────────────────────────────────────────────
   Deux régimes distincts, et c'est volontaire :

   • L'HORAIRE et les RÉGLAGES (pas, battement, délai) sont mis en attente
     localement et ne partent qu'au clic sur « Enregistrer ». C'est ce que la
     maquette dessine (elle a un couple Annuler/Enregistrer), et c'est plus
     sûr : pas d'écriture partielle si l'admin se ravise en cours de route.

   • Les CONGÉS partent tout de suite : ils ont leur propre parcours avec
     confirmation explicite (calendrier → pour qui, ou modale de suppression).
     Les mettre en attente derrière le même bouton rendrait ces confirmations
     mensongères.

   Routes réellement appelées :
     POST   /toggle-day                     { weekdayIndex, companyId, dayOff, employeeId }
     POST   /edit-availability              { weekdayIndex, companyId, workingHours[], employeeId }
     PATCH  /company/schedule-mode          { scheduleMode }
     PATCH  /company/slot-mode              { slotInterval }        — Pro
     PATCH  /company/buffer                 { bufferBefore, bufferAfter } — Pro
     PATCH  /company/booking-lead-time      { minutes }
     PATCH  /company/add-days-off           { dateKey, employeeIds }
     DELETE /company/days-off/:dayId
     PATCH  /company/schedule-day-off       { dateId, slots[] }
   ═════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var root = document.getElementById("avnRoot");
  if (!root) return;

  var ACCENT = "#12a06e";
  var $ = function (id) { return document.getElementById(id); };

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

  var CFG = JSON.parse(($("avnConfig") || {}).textContent || "{}");
  var JOURS = JSON.parse(($("avnSchedule") || {}).textContent || "[]");
  var CONGES = JSON.parse(($("avnConges") || {}).textContent || "[]");
  var EMPLOYEES = JSON.parse(($("avnEmployees") || {}).textContent || "[]");

  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

  // État local : ce que l'admin a modifié mais pas encore enregistré.
  var etat = {
    jours: JOURS.map(function (j) {
      return { idx: j.idx, nom: j.nom, ferme: j.ferme, plages: j.plages.map(function (p) { return { start: p.start, end: p.end }; }) };
    }),
    slotInterval: CFG.slotInterval,
    slotMode: CFG.slotMode,
    slotTime: CFG.slotTime,
    bufferBefore: CFG.bufferBefore,
    bufferAfter: CFG.bufferAfter,
    leadOn: CFG.leadOn,
    leadMinutes: CFG.leadMinutes,
    horizonDays: CFG.horizonDays,
    autoConfirm: CFG.autoConfirm,
    waitlist: CFG.waitlist,
    overbooking: CFG.overbooking,
    phoneRequired: CFG.phoneRequired,
    sgOn: CFG.sgOn,
    sgWindow: CFG.sgWindow,
    sgDays: (CFG.sgDays || []).slice(),
    sale: false,
  };
  var initial = JSON.parse(JSON.stringify(etat));

  // Empreinte de tout ce qui est mis en attente derrière « Enregistrer ».
  function empreinte(e) {
    return JSON.stringify({
      j: e.jours, si: e.slotInterval, sm: e.slotMode, st: e.slotTime,
      bb: e.bufferBefore, ba: e.bufferAfter,
      lo: e.leadOn, lm: e.leadMinutes, h: e.horizonDays,
      ac: e.autoConfirm, w: e.waitlist, ob: e.overbooking, ph: e.phoneRequired,
      sg: e.sgOn, sw: e.sgWindow, sd: e.sgDays.slice().sort(),
    });
  }

  function marquerSale() {
    etat.sale = empreinte(etat) !== empreinte(initial);
    $("avnDirty").hidden = !etat.sale;
  }

  function min(t) { var p = String(t).split(":"); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0); }
  function hhmm(m) {
    m = ((m % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  }

  /* ── Onglets ──────────────────────────────────────────────────────────── */
  var onglets = root.querySelectorAll("[data-avntab]");
  onglets.forEach(function (b) {
    b.addEventListener("click", function () {
      var cible = b.dataset.avntab;
      onglets.forEach(function (o) {
        var on = o === b;
        o.style.color = on ? ACCENT : "#8c968f";
        o.querySelector(".avn-tabbar").style.background = on ? ACCENT : "transparent";
      });
      root.querySelectorAll("[data-avnpanel]").forEach(function (p) {
        p.hidden = p.dataset.avnpanel !== cible;
      });
      try { sessionStorage.setItem("avnTab", cible); } catch (e) {}
    });
  });
  try {
    var memo = sessionStorage.getItem("avnTab");
    if (memo) {
      var b0 = root.querySelector('[data-avntab="' + memo + '"]');
      if (b0) b0.click();
    }
  } catch (e) {}

  /* ── Statistiques + aperçu (recalculés à chaque changement) ───────────── */
  function recalculer() {
    var ouverts = etat.jours.filter(function (j) { return !j.ferme; });
    var totalMin = ouverts.reduce(function (t, j) {
      return t + j.plages.reduce(function (u, p) { return u + Math.max(0, min(p.end) - min(p.start)); }, 0);
    }, 0);
    $("avnStatDays").textContent = ouverts.length;
    $("avnStatHours").textContent = Math.round(totalMin / 60) + " h";
    $("avnStatSlots").textContent = etat.slotInterval > 0 ? Math.floor(totalMin / etat.slotInterval) : 0;
    $("avnStatConges").textContent = CONGES.length;

    // Aperçu des créneaux du premier jour ouvert
    var jour = ouverts[0];
    var nom = jour ? jour.nom : "—";
    var hint = jour
      ? "Créneaux de " + etat.slotInterval + " min" + (etat.bufferAfter ? ", avec " + etat.bufferAfter + " min de battement" : ", sans battement")
      : "Ouvrez au moins un jour pour générer des créneaux.";
    var slots = [];
    if (jour) {
      jour.plages.forEach(function (p) {
        var cur = min(p.start), fin = min(p.end);
        while (cur + etat.slotInterval <= fin && slots.length < 28) {
          slots.push(hhmm(cur));
          cur += etat.slotInterval + etat.bufferAfter;
        }
      });
    }
    var html = slots.map(function (s) {
      return '<span style="padding:9px 4px;border-radius:9px;background:#e9f7f0;text-align:center;font:600 12px/1 \'Plus Jakarta Sans\',sans-serif;color:#0d7a54">' + s + "</span>";
    }).join("");
    ["avnPreviewDay", "avnPreviewDay2"].forEach(function (id) { if ($(id)) $(id).textContent = nom; });
    ["avnPreviewHint", "avnPreviewHint2"].forEach(function (id) { if ($(id)) $(id).textContent = hint; });
    ["avnPreviewSlots", "avnPreviewSlots2"].forEach(function (id) { if ($(id)) $(id).innerHTML = html; });

    // Récapitulatif en français de ce que les règles produisent côté client.
    var echo = $("avnRulesEcho");
    if (echo) {
      var phrases = [];
      if (etat.leadOn && etat.leadMinutes > 0) {
        var d = etat.leadMinutes % 1440 === 0 ? (etat.leadMinutes / 1440) + (etat.leadMinutes === 1440 ? " jour" : " jours")
          : etat.leadMinutes % 60 === 0 ? (etat.leadMinutes / 60) + " h"
            : etat.leadMinutes + " min";
        phrases.push("Il ne peut pas réserver moins de " + d + " à l'avance.");
      } else {
        phrases.push("Il peut réserver un créneau qui commence dans quelques minutes.");
      }
      phrases.push(etat.horizonDays > 0
        ? "Il ne voit pas les créneaux au-delà de " + etat.horizonDays + " jours."
        : "Il peut réserver aussi loin qu'il veut dans le futur.");
      phrases.push(etat.autoConfirm
        ? "Sa réservation est confirmée immédiatement."
        : "Sa demande reste en attente de votre validation.");
      if (etat.overbooking) phrases.push("Plusieurs rendez-vous peuvent tomber sur le même créneau.");
      if (!etat.phoneRequired) phrases.push("Il peut réserver sans laisser de numéro de téléphone.");
      echo.textContent = phrases.join(" ");
    }
    marquerSale();
  }

  /* ── Rendu d'un jour ──────────────────────────────────────────────────── */
  function ligneJour(idx) { return root.querySelector('.avn-day[data-avnday="' + idx + '"]'); }

  function redessinerJour(idx) {
    var j = etat.jours.find(function (x) { return x.idx === idx; });
    var ligne = ligneJour(idx);
    if (!j || !ligne) return;

    var sw = ligne.querySelector(".avn-sw");
    var knob = ligne.querySelector(".avn-sw__knob");
    sw.style.background = j.ferme ? "#d6dade" : ACCENT;
    knob.style.transform = "translateX(" + (j.ferme ? "0px" : "18px") + ")";
    ligne.querySelector(".avn-dayname").style.color = j.ferme ? "#98a29b" : "#1a201d";
    ligne.querySelector(".avn-closed").hidden = !j.ferme;

    var zone = ligne.querySelector(".avn-ranges");
    zone.hidden = j.ferme;
    zone.innerHTML = "";
    j.plages.forEach(function (p, pi) {
      var d = document.createElement("div");
      d.className = "avn-range";
      d.style.cssText = "display:flex;align-items:center;gap:8px";
      d.innerHTML =
        '<button type="button" class="avn-time" data-avnfield="start" style="height:40px;padding:0 14px;border-radius:11px;border:1px solid #e6eae7;background:#f9fbfa;cursor:pointer;display:flex;align-items:center;font:600 13px/1 ui-monospace,\'Plus Jakarta Sans\',monospace;color:#1a201d">' + p.start + "</button>"
        + '<span style="color:#c0c8c2">—</span>'
        + '<button type="button" class="avn-time" data-avnfield="end" style="height:40px;padding:0 14px;border-radius:11px;border:1px solid #e6eae7;background:#f9fbfa;cursor:pointer;display:flex;align-items:center;font:600 13px/1 ui-monospace,\'Plus Jakarta Sans\',monospace;color:#1a201d">' + p.end + "</button>"
        + (pi > 0 ? '<button type="button" class="avn-rangedel" style="width:26px;height:26px;border:0;border-radius:8px;background:none;cursor:pointer;color:#b4bdb7;font:400 13px/1 \'Plus Jakarta Sans\',sans-serif">✕</button>' : "");
      zone.appendChild(d);
    });
    if (CFG.features && CFG.features.ranges) {
      var add = document.createElement("button");
      add.type = "button";
      add.className = "avn-addrange";
      add.style.cssText = "height:40px;padding:0 13px;border-radius:11px;border:1px solid #e6eae7;background:#fff;cursor:pointer;font:600 12.5px/1 'Plus Jakarta Sans',sans-serif;color:#0d7a54;white-space:nowrap";
      add.textContent = "+ Créneau";
      zone.appendChild(add);
    }
  }

  /* ── Interactions sur les jours ───────────────────────────────────────── */
  root.addEventListener("click", function (e) {
    var ligne = e.target.closest(".avn-day");
    if (!ligne) return;
    var idx = Number(ligne.dataset.avnday);
    var j = etat.jours.find(function (x) { return x.idx === idx; });
    if (!j) return;

    if (e.target.closest(".avn-daytoggle")) {
      j.ferme = !j.ferme;
      // Rouvrir un jour sans plage : on repart sur la journée type.
      if (!j.ferme && j.plages.length === 0) j.plages = [{ start: "09:00", end: "18:00" }];
      redessinerJour(idx);
      recalculer();
      return;
    }
    if (e.target.closest(".avn-addrange")) {
      var derniere = j.plages[j.plages.length - 1];
      var debut = derniere ? Math.min(min(derniere.end) + 60, 22 * 60) : 9 * 60;
      j.plages.push({ start: hhmm(debut), end: hhmm(Math.min(debut + 120, 23 * 60 + 59)) });
      redessinerJour(idx);
      recalculer();
      return;
    }
    var del = e.target.closest(".avn-rangedel");
    if (del) {
      var rang = [].indexOf.call(ligne.querySelectorAll(".avn-range"), del.closest(".avn-range"));
      if (rang >= 0) { j.plages.splice(rang, 1); redessinerJour(idx); recalculer(); }
      return;
    }
    var btnTemps = e.target.closest(".avn-time");
    if (btnTemps) {
      var range = btnTemps.closest(".avn-range");
      var pos = [].indexOf.call(ligne.querySelectorAll(".avn-range"), range);
      ouvrirHeure(btnTemps.dataset.avnfield, btnTemps.textContent.trim(), function (v) {
        var p = j.plages[pos];
        if (btnTemps.dataset.avnfield === "start") {
          p.start = v;
          if (min(p.end) <= min(v)) p.end = hhmm(Math.min(min(v) + 60, 1439));
        } else {
          p.end = v;
          if (min(v) <= min(p.start)) p.start = hhmm(Math.max(min(v) - 60, 0));
        }
        redessinerJour(idx);
        recalculer();
      });
    }
  });

  /* ── Mode commun / individuel ─────────────────────────────────────────── */
  function changerMode(mode) {
    if (etat.sale && !confirm("Vous avez des modifications non enregistrées. Changer de mode va les perdre. Continuer ?")) return;
    json("/company/schedule-mode", "PATCH", { scheduleMode: mode })
      .then(function () { window.location.href = "/availability"; })
      .catch(function (err) { alert(err.serveur || "Le changement de mode a échoué."); });
  }
  $("avnModeShared").addEventListener("click", function () { if (CFG.scheduleMode !== "shared") changerMode("shared"); });
  $("avnModePer").addEventListener("click", function () { if (CFG.scheduleMode !== "perEmployee") changerMode("perEmployee"); });

  root.addEventListener("click", function (e) {
    var chip = e.target.closest(".avn-emp");
    if (!chip) return;
    if (etat.sale && !confirm("Vous avez des modifications non enregistrées. Changer d'employé va les perdre. Continuer ?")) return;
    window.location.href = "/availability?employeeId=" + encodeURIComponent(chip.dataset.avnemp);
  });

  /* ══ Réglages (onglets Règles et Créneaux) ═══════════════════════════════
     Tout est mis en attente localement : rien ne part avant « Enregistrer ».
     Chaque bloc ne fait donc que peindre l'état et l'écrire dans `etat`. */

  // Peint une rangée de puces « une seule active ».
  function peindreSeg(conteneur, selecteur, valeurActive, lireValeur) {
    if (!conteneur) return;
    conteneur.querySelectorAll(selecteur).forEach(function (b) {
      var on = lireValeur(b) === valeurActive;
      b.style.border = "1px solid " + (on ? ACCENT : "#e0e3e5");
      b.style.background = on ? "#e9f7f0" : "#fff";
      b.style.color = on ? "#0d7a54" : "#4d5560";
    });
  }
  // Peint une rangée de puces « plusieurs actives ».
  function peindreMulti(conteneur, selecteur, valeurs, lireValeur) {
    if (!conteneur) return;
    conteneur.querySelectorAll(selecteur).forEach(function (b) {
      var on = valeurs.indexOf(lireValeur(b)) >= 0;
      b.style.border = "1px solid " + (on ? ACCENT : "#e0e3e5");
      b.style.background = on ? "#e9f7f0" : "#fff";
      b.style.color = on ? "#0d7a54" : "#4d5560";
    });
  }
  // Peint un interrupteur.
  function peindreFlip(btn, on) {
    if (!btn) return;
    btn.dataset.avnon = on ? "true" : "false";
    var sw = btn.querySelector(".avn-sw"), knob = btn.querySelector(".avn-sw__knob");
    sw.style.background = on ? ACCENT : "#d6dade";
    knob.style.transform = "translateX(" + (on ? "18px" : "0px") + ")";
  }

  /* ── Délai minimum : puces + saisie libre, les deux synchronisées ─────── */
  var UNITES = { minutes: 1, hours: 60, days: 1440 };
  function ecrireLeadDansSaisie() {
    var m = etat.leadMinutes, unite = "minutes", valeur = m;
    if (m > 0 && m % 1440 === 0) { unite = "days"; valeur = m / 1440; }
    else if (m > 0 && m % 60 === 0) { unite = "hours"; valeur = m / 60; }
    if ($("avnLeadValue")) $("avnLeadValue").value = valeur;
    if ($("avnLeadUnit")) $("avnLeadUnit").value = unite;
  }
  function majLead() {
    peindreSeg($("avnLeadPresets"), ".avn-lead", etat.leadMinutes, function (x) { return Number(x.dataset.avnminutes); });
    recalculer();
  }
  if ($("avnLeadOn")) {
    $("avnLeadOn").addEventListener("click", function () {
      etat.leadOn = !etat.leadOn;
      peindreFlip($("avnLeadOn"), etat.leadOn);
      $("avnLeadRow").hidden = !etat.leadOn;
      recalculer();
    });
  }
  if ($("avnLeadPresets")) {
    $("avnLeadPresets").addEventListener("click", function (e) {
      var b = e.target.closest(".avn-lead");
      if (!b) return;
      etat.leadMinutes = Number(b.dataset.avnminutes);
      ecrireLeadDansSaisie();
      majLead();
    });
  }
  function lireSaisieLead() {
    var v = Math.max(0, Number($("avnLeadValue").value) || 0);
    etat.leadMinutes = Math.min(90 * 24 * 60, v * (UNITES[$("avnLeadUnit").value] || 1));
    majLead();
  }
  if ($("avnLeadValue")) $("avnLeadValue").addEventListener("input", lireSaisieLead);
  if ($("avnLeadUnit")) $("avnLeadUnit").addEventListener("change", lireSaisieLead);

  /* ── Horizon de réservation ───────────────────────────────────────────── */
  if ($("avnHorizons")) {
    $("avnHorizons").addEventListener("click", function (e) {
      var b = e.target.closest(".avn-horizon");
      if (!b) return;
      etat.horizonDays = Number(b.dataset.avndays);
      $("avnHorizonValue").value = etat.horizonDays;
      peindreSeg($("avnHorizons"), ".avn-horizon", etat.horizonDays, function (x) { return Number(x.dataset.avndays); });
      recalculer();
    });
  }
  if ($("avnHorizonValue")) {
    $("avnHorizonValue").addEventListener("input", function () {
      etat.horizonDays = Math.max(0, Math.min(730, Number(this.value) || 0));
      peindreSeg($("avnHorizons"), ".avn-horizon", etat.horizonDays, function (x) { return Number(x.dataset.avndays); });
      recalculer();
    });
  }

  /* ── Regroupement des rendez-vous ─────────────────────────────────────── */
  if ($("avnSgOn")) {
    $("avnSgOn").addEventListener("click", function () {
      etat.sgOn = !etat.sgOn;
      peindreFlip($("avnSgOn"), etat.sgOn);
      $("avnSgRow").hidden = !etat.sgOn;
      recalculer();
    });
  }
  if ($("avnSgWindow")) {
    $("avnSgWindow").addEventListener("click", function (e) {
      var b = e.target.closest(".avn-sgwin");
      if (!b) return;
      etat.sgWindow = Number(b.dataset.avnhours);
      peindreSeg($("avnSgWindow"), ".avn-sgwin", etat.sgWindow, function (x) { return Number(x.dataset.avnhours); });
      recalculer();
    });
  }
  if ($("avnSgDays")) {
    $("avnSgDays").addEventListener("click", function (e) {
      var b = e.target.closest(".avn-sgday");
      if (!b) return;
      var d = Number(b.dataset.avnday);
      var i = etat.sgDays.indexOf(d);
      if (i >= 0) etat.sgDays.splice(i, 1); else etat.sgDays.push(d);
      peindreMulti($("avnSgDays"), ".avn-sgday", etat.sgDays, function (x) { return Number(x.dataset.avnday); });
      recalculer();
    });
  }

  /* ── Interrupteurs simples ────────────────────────────────────────────── */
  if ($("avnAutoConfirm")) {
    $("avnAutoConfirm").addEventListener("click", function () {
      etat.autoConfirm = !etat.autoConfirm;
      peindreFlip($("avnAutoConfirm"), etat.autoConfirm);
      // L'avertissement n'apparaît que si on DÉSACTIVE : sans écran de
      // validation, les demandes en attente ne seraient visibles nulle part.
      $("avnAutoWarn").hidden = etat.autoConfirm;
      recalculer();
    });
  }
  if ($("avnWaitlist")) {
    $("avnWaitlist").addEventListener("click", function () {
      etat.waitlist = !etat.waitlist;
      peindreFlip($("avnWaitlist"), etat.waitlist);
      $("avnWaitWarn").hidden = !etat.waitlist;
      recalculer();
    });
  }
  if ($("avnOverbooking")) {
    $("avnOverbooking").addEventListener("click", function () {
      etat.overbooking = !etat.overbooking;
      peindreFlip($("avnOverbooking"), etat.overbooking);
      recalculer();
    });
  }
  if ($("avnPhoneRequired")) {
    $("avnPhoneRequired").addEventListener("click", function () {
      etat.phoneRequired = !etat.phoneRequired;
      peindreFlip($("avnPhoneRequired"), etat.phoneRequired);
      recalculer();
    });
  }

  /* ── Durée globale des créneaux ───────────────────────────────────────── */
  if ($("avnSlotTimes")) {
    $("avnSlotTimes").addEventListener("click", function (e) {
      var b = e.target.closest(".avn-slottime");
      if (!b || !CFG.features.slotDuration) return;
      etat.slotTime = Number(b.dataset.avnslottime);
      peindreSeg($("avnSlotTimes"), ".avn-slottime", etat.slotTime, function (x) { return Number(x.dataset.avnslottime); });
      recalculer();
    });
  }

  /* ── Temps tampon : deux curseurs indépendants, 0 → 120 ───────────────── */
  if ($("avnBufBefore")) {
    $("avnBufBefore").addEventListener("input", function () {
      etat.bufferBefore = Number(this.value) || 0;
      $("avnBufBeforeVal").textContent = etat.bufferBefore + " min";
      recalculer();
    });
  }
  if ($("avnBufAfter")) {
    $("avnBufAfter").addEventListener("input", function () {
      etat.bufferAfter = Number(this.value) || 0;
      $("avnBufAfterVal").textContent = etat.bufferAfter + " min";
      recalculer();
    });
  }

  /* ── Mode de génération des créneaux ──────────────────────────────────── */
  function peindreSlotMode() {
    [["avnSlotModeFixed", "fixed"], ["avnSlotModeInterval", "interval"]].forEach(function (paire) {
      var b = $(paire[0]);
      if (!b) return;
      var on = etat.slotMode === paire[1];
      b.style.border = "1px solid " + (on ? ACCENT : "#e6eae7");
      b.style.background = on ? "#e9f7f0" : "#f9fbfa";
      b.children[0].style.color = on ? "#0c5e42" : "#1a201d";
      b.children[1].style.color = on ? "#3f8468" : "#8c968f";
    });
    if ($("avnIntervalRow")) $("avnIntervalRow").hidden = etat.slotMode !== "interval";
  }
  if ($("avnSlotModeFixed")) {
    $("avnSlotModeFixed").addEventListener("click", function () { etat.slotMode = "fixed"; peindreSlotMode(); recalculer(); });
  }
  if ($("avnSlotModeInterval")) {
    $("avnSlotModeInterval").addEventListener("click", function () { etat.slotMode = "interval"; peindreSlotMode(); recalculer(); });
  }
  if ($("avnSlotInterval")) {
    $("avnSlotInterval").addEventListener("input", function () {
      etat.slotInterval = Math.max(5, Math.min(120, Number(this.value) || 30));
      recalculer();
    });
  }

  /* ══ Sélecteur d'heure ══════════════════════════════════════════════════ */
  var ovTime = $("avnTimeOv");
  var surChoixHeure = null;
  function ouvrirHeure(champ, valeur, cb) {
    surChoixHeure = cb;
    $("avnTimeTitle").textContent = champ === "start" ? "Heure de début" : "Heure de fin";
    $("avnTimeQuery").value = "";
    listerHeures("");
    ouvrirOv(ovTime);
    setTimeout(function () { $("avnTimeQuery").focus(); }, 30);
  }
  function listerHeures(q) {
    q = (q || "").replace(/[^0-9:]/g, "");
    var out = [];
    for (var h = 0; h < 24 && out.length < 60; h++) {
      for (var m = 0; m < 60; m += 5) {
        var v = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
        if (!q || v.indexOf(q) === 0 || v.replace(":", "").indexOf(q.replace(":", "")) === 0) {
          out.push(v);
          if (out.length >= 60) break;
        }
      }
    }
    var box = $("avnTimeList");
    if (out.length === 0) {
      box.innerHTML = '<div style="padding:20px;text-align:center;font:500 12.5px/1.5 \'Plus Jakarta Sans\',sans-serif;color:#b4bdb7">Aucune heure ne correspond.</div>';
      return;
    }
    box.innerHTML = out.map(function (v) {
      return '<button type="button" class="avn-timeopt" data-avnv="' + v + '" style="width:100%;text-align:left;padding:11px 14px;border:0;border-radius:10px;cursor:pointer;background:transparent;font:600 13.5px/1 ui-monospace,monospace;color:#1a201d">' + v + "</button>";
    }).join("");
  }
  $("avnTimeQuery").addEventListener("input", function () { listerHeures(this.value); });
  $("avnTimeList").addEventListener("click", function (e) {
    var b = e.target.closest(".avn-timeopt");
    if (!b) return;
    var cb = surChoixHeure;
    surChoixHeure = null;
    fermerOv(ovTime);
    if (cb) cb(b.dataset.avnv);
  });

  /* ══ Overlays ═══════════════════════════════════════════════════════════ */
  function ouvrirOv(ov) { ov.hidden = false; document.body.style.overflow = "hidden"; }
  function fermerOv(ov) { ov.hidden = true; document.body.style.overflow = ""; }
  root.querySelectorAll(".avn-overlay").forEach(function (ov) {
    ov.addEventListener("click", function (e) { if (e.target === ov) fermerOv(ov); });
  });
  root.addEventListener("click", function (e) {
    var c = e.target.closest("[data-avnclose]");
    if (c) fermerOv(c.closest(".avn-overlay"));
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    root.querySelectorAll(".avn-overlay").forEach(function (ov) { if (!ov.hidden) fermerOv(ov); });
  });

  /* ══ Congés : calendrier → pour qui ═════════════════════════════════════ */
  var ovCal = $("avnCalOv"), ovWho = $("avnWhoOv"), ovDel = $("avnDelOv");
  var maintenant = new Date();
  var calAnnee = maintenant.getFullYear(), calMois = maintenant.getMonth();
  var selection = [];
  var qui = "all", quiEmps = [];

  function iso(y, m, d) { return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0"); }

  function dessinerCalendrier() {
    $("avnCalLabel").textContent = MOIS[calMois].charAt(0).toUpperCase() + MOIS[calMois].slice(1) + " " + calAnnee;
    var premier = new Date(calAnnee, calMois, 1);
    var decalage = premier.getDay();
    var nbJours = new Date(calAnnee, calMois + 1, 0).getDate();
    var precedent = new Date(calAnnee, calMois, 0).getDate();
    var auj = new Date();
    var cases = [];
    for (var i = 0; i < 42; i++) {
      var n = i - decalage + 1;
      var dansMois = n >= 1 && n <= nbJours;
      var label = dansMois ? n : (n < 1 ? precedent + n : n - nbJours);
      var cle = dansMois ? iso(calAnnee, calMois, n) : "";
      var choisi = dansMois && selection.indexOf(cle) >= 0;
      var pris = dansMois && CONGES.some(function (c) { return c.iso === cle; });
      var estAuj = dansMois && auj.getFullYear() === calAnnee && auj.getMonth() === calMois && auj.getDate() === n;
      var fg = !dansMois ? "#c8d0cb" : (estAuj ? "#fff" : (choisi ? "#0d7a54" : "#1a201d"));
      var bg = estAuj ? "#141a17" : (choisi ? "#e9f7f0" : "transparent");
      var bd = choisi ? ACCENT : "transparent";
      var marque = pris && !choisi ? "•" : (choisi ? "✓" : "");
      cases.push(
        '<button type="button" class="avn-cell" ' + (dansMois ? 'data-avncell="' + cle + '"' : "disabled") + ' style="position:relative;aspect-ratio:1;border-radius:11px;cursor:' + (dansMois ? "pointer" : "default") + ';border:1.5px solid ' + bd + ";background:" + bg + ";color:" + fg + ";font:600 13px/1 'Plus Jakarta Sans',sans-serif;display:flex;align-items:center;justify-content:center\">"
        + label
        + (marque ? '<span style="position:absolute;top:3px;right:5px;font:700 9px/1 \'Plus Jakarta Sans\',sans-serif;color:#12a06e">' + marque + "</span>" : "")
        + "</button>"
      );
    }
    $("avnCalGrid").innerHTML = cases.join("");
    var n = selection.length;
    $("avnCalBar").hidden = n === 0;
    $("avnCalCount").textContent = "✓ Valider " + n + (n > 1 ? " jours" : " jour") + " de congé";
  }

  root.querySelectorAll(".avn-opencal").forEach(function (b) {
    b.addEventListener("click", function () {
      selection = [];
      calAnnee = new Date().getFullYear(); calMois = new Date().getMonth();
      dessinerCalendrier();
      ouvrirOv(ovCal);
    });
  });
  $("avnCalPrev").addEventListener("click", function () {
    if (calMois === 0) { calMois = 11; calAnnee--; } else calMois--;
    dessinerCalendrier();
  });
  $("avnCalNext").addEventListener("click", function () {
    if (calMois === 11) { calMois = 0; calAnnee++; } else calMois++;
    dessinerCalendrier();
  });
  $("avnCalGrid").addEventListener("click", function (e) {
    var c = e.target.closest(".avn-cell");
    if (!c || !c.dataset.avncell) return;
    var cle = c.dataset.avncell;
    var i = selection.indexOf(cle);
    if (i >= 0) selection.splice(i, 1); else selection.push(cle);
    dessinerCalendrier();
  });
  $("avnCalClear").addEventListener("click", function () { selection = []; dessinerCalendrier(); });
  $("avnCalNextStep").addEventListener("click", function () {
    if (selection.length === 0) return;
    qui = "all"; quiEmps = [];
    peindreQui();
    $("avnWhoTitle").textContent = selection.length > 1
      ? "Pour qui sont ces " + selection.length + " jours de congé ?"
      : "Pour qui est ce jour de congé ?";
    fermerOv(ovCal);
    ouvrirOv(ovWho);
  });

  function peindreQui() {
    root.querySelectorAll(".avn-whoopt").forEach(function (b) {
      var on = b.dataset.avnwho === qui;
      b.style.border = "1.5px solid " + (on ? ACCENT : "#e6eae7");
      b.style.background = on ? "#e9f7f0" : "#fff";
      b.style.color = on ? "#0c5e42" : "#1a201d";
      b.querySelector("span").style.borderColor = on ? ACCENT : "#cfd6d1";
      b.querySelector(".avn-dot").style.background = on ? ACCENT : "transparent";
    });
    $("avnWhoList").hidden = qui !== "some";
    root.querySelectorAll(".avn-whoemp").forEach(function (b) {
      var on = quiEmps.indexOf(b.dataset.avnemp) >= 0;
      b.style.background = on ? "#f4faf7" : "#f7faf8";
      var ch = b.querySelector(".avn-check");
      ch.style.border = "1.5px solid " + (on ? ACCENT : "#d6dade");
      ch.style.background = on ? ACCENT : "#fff";
      ch.textContent = on ? "✓" : "";
    });
  }
  root.querySelectorAll(".avn-whoopt").forEach(function (b) {
    b.addEventListener("click", function () { qui = b.dataset.avnwho; peindreQui(); });
  });
  $("avnWhoList").addEventListener("click", function (e) {
    var b = e.target.closest(".avn-whoemp");
    if (!b) return;
    var id = b.dataset.avnemp;
    var i = quiEmps.indexOf(id);
    if (i >= 0) quiEmps.splice(i, 1); else quiEmps.push(id);
    peindreQui();
  });
  $("avnWhoBack").addEventListener("click", function () {
    fermerOv(ovWho);
    dessinerCalendrier();
    ouvrirOv(ovCal);
  });
  $("avnWhoConfirm").addEventListener("click", function () {
    var ids = qui === "some" ? quiEmps : [];
    if (qui === "some" && ids.length === 0) { alert("Choisissez au moins un employé, ou revenez à « Tous les employés »."); return; }
    var btn = this; btn.disabled = true;
    // Les jours déjà posés sont ignorés — le backend créerait un doublon.
    var aPoser = selection.filter(function (k) { return !CONGES.some(function (c) { return c.iso === k; }); });
    Promise.all(aPoser.map(function (k) {
      return json("/company/add-days-off", "PATCH", { dateKey: k, employeeIds: ids });
    })).then(function () { window.location.reload(); })
      .catch(function (err) { btn.disabled = false; alert(err.serveur || "L'ajout du congé a échoué."); });
  });

  /* ── Congé : suppression ──────────────────────────────────────────────── */
  var congeASupprimer = null;
  root.addEventListener("click", function (e) {
    var b = e.target.closest(".avn-congedel");
    if (!b) return;
    congeASupprimer = b.closest(".avn-conge").dataset.avnconge;
    $("avnDelLabel").textContent = b.dataset.avnlabel || "";
    $("avnDelWho").textContent = b.dataset.avnwho || "tous les employés";
    ouvrirOv(ovDel);
  });
  $("avnDelConfirm").addEventListener("click", function () {
    if (!congeASupprimer) return;
    var btn = this; btn.disabled = true;
    json("/company/days-off/" + congeASupprimer, "DELETE")
      .then(function () { window.location.reload(); })
      .catch(function (err) { btn.disabled = false; alert(err.serveur || "La suppression a échoué."); });
  });

  /* ── Congé : créneaux (partiel au lieu de journée entière) ────────────── */
  function creneauxDuConge(carte) {
    var out = [];
    carte.querySelectorAll(".avn-congeslot").forEach(function (l) {
      var t = l.querySelectorAll(".avn-time");
      out.push({ start: t[0].textContent.trim(), end: t[1].textContent.trim() });
    });
    return out;
  }
  function enregistrerCreneauxConge(carte) {
    var id = carte.dataset.avnconge;
    return json("/company/schedule-day-off", "PATCH", { dateId: id, slots: creneauxDuConge(carte) })
      .then(function () { window.location.reload(); })
      .catch(function (err) { alert(err.serveur || "L'enregistrement du créneau a échoué."); });
  }
  root.addEventListener("click", function (e) {
    var carte = e.target.closest(".avn-conge");
    if (!carte) return;

    if (e.target.closest(".avn-congeaddslot")) {
      var box = carte.querySelector(".avn-congeslots");
      var l = document.createElement("div");
      l.className = "avn-congeslot";
      l.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap";
      l.innerHTML =
        '<button type="button" class="avn-time" data-avnfield="start" style="height:34px;padding:0 11px;border-radius:9px;border:1px solid #e6eae7;background:#f9fbfa;cursor:pointer;font:600 12px/1 ui-monospace,monospace;color:#1a201d">09:00</button>'
        + '<span style="color:#c0c8c2">—</span>'
        + '<button type="button" class="avn-time" data-avnfield="end" style="height:34px;padding:0 11px;border-radius:9px;border:1px solid #e6eae7;background:#f9fbfa;cursor:pointer;font:600 12px/1 ui-monospace,monospace;color:#1a201d">13:00</button>'
        + '<button type="button" class="avn-congeslotdel" style="width:26px;height:26px;border:0;border-radius:8px;background:none;cursor:pointer;color:#b4bdb7;font:400 13px/1 \'Plus Jakarta Sans\',sans-serif">✕</button>';
      box.appendChild(l);
      carte.querySelector(".avn-congefull").hidden = true;
      enregistrerCreneauxConge(carte);
      return;
    }
    if (e.target.closest(".avn-congeslotdel")) {
      e.target.closest(".avn-congeslot").remove();
      enregistrerCreneauxConge(carte);
      return;
    }
    var bt = e.target.closest(".avn-time");
    if (bt) {
      ouvrirHeure(bt.dataset.avnfield, bt.textContent.trim(), function (v) {
        bt.textContent = v;
        enregistrerCreneauxConge(carte);
      });
    }
  });

  /* ══ Enregistrer / Annuler ══════════════════════════════════════════════ */
  $("avnCancel").addEventListener("click", function () { window.location.reload(); });

  $("avnSave").addEventListener("click", function () {
    if (!CFG.canEdit) { alert("Vous n'avez pas le droit de modifier cet horaire."); return; }
    var btn = this;
    btn.disabled = true;
    btn.textContent = "Enregistrement…";

    var empId = CFG.scheduleMode === "perEmployee" ? CFG.selectedEmployeeId : "shared";
    var taches = [];

    etat.jours.forEach(function (j) {
      var avant = initial.jours.find(function (x) { return x.idx === j.idx; });
      if (avant.ferme !== j.ferme) {
        taches.push(function () {
          return json("/toggle-day", "POST", { weekdayIndex: j.idx, companyId: CFG.companyId, dayOff: j.ferme, employeeId: empId });
        });
      }
      // Un jour fermé n'a pas d'horaires à écrire, et editAvailabilty refuse
      // une liste vide — on ne l'appelle que sur un jour ouvert.
      if (!j.ferme && JSON.stringify(avant.plages) !== JSON.stringify(j.plages) && j.plages.length) {
        taches.push(function () {
          return json("/edit-availability", "POST", {
            weekdayIndex: j.idx, companyId: CFG.companyId,
            workingHours: j.plages.map(function (p) { return { start: p.start, end: p.end }; }),
            employeeId: empId,
          });
        });
      }
    });

    // Pas + mode de génération : même endpoint, donc un seul appel.
    if (etat.slotInterval !== initial.slotInterval || etat.slotMode !== initial.slotMode) {
      taches.push(function () {
        return json("/company/slot-mode", "PATCH", { slotMode: etat.slotMode, slotInterval: etat.slotInterval });
      });
    }
    // Durée globale des créneaux — endpoint distinct, hérité.
    if (etat.slotTime !== initial.slotTime) {
      taches.push(function () { return json("/edit-interval", "PATCH", { slot: etat.slotTime }); });
    }
    // Les deux sens du tampon partent ensemble : l'endpoint écrit les deux
    // champs, n'en envoyer qu'un remettrait l'autre à zéro.
    if (etat.bufferBefore !== initial.bufferBefore || etat.bufferAfter !== initial.bufferAfter) {
      taches.push(function () {
        return json("/company/buffer", "PATCH", { bufferBefore: etat.bufferBefore, bufferAfter: etat.bufferAfter });
      });
    }
    // Délai minimum : on envoie `enabled` explicitement. Sans ça, l'endpoint
    // le déduit de la valeur et l'interrupteur « activé à 0 min » serait
    // silencieusement remis à désactivé.
    if (etat.leadMinutes !== initial.leadMinutes || etat.leadOn !== initial.leadOn) {
      taches.push(function () {
        return json("/company/booking-lead-time", "PATCH", {
          enabled: etat.leadOn,
          minutes: etat.leadOn ? etat.leadMinutes : 0,
        });
      });
    }
    // Regroupement des rendez-vous.
    if (etat.sgOn !== initial.sgOn || etat.sgWindow !== initial.sgWindow
        || JSON.stringify(etat.sgDays.slice().sort()) !== JSON.stringify(initial.sgDays.slice().sort())) {
      taches.push(function () {
        return json("/company/smart-grouping", "PATCH", {
          enabled: etat.sgOn, windowHours: etat.sgWindow, weekdays: etat.sgDays,
        });
      });
    }
    // Les quatre règles de réservation — un seul endpoint.
    if (etat.horizonDays !== initial.horizonDays || etat.autoConfirm !== initial.autoConfirm
        || etat.waitlist !== initial.waitlist || etat.overbooking !== initial.overbooking) {
      taches.push(function () {
        return json("/company/booking-rules", "PATCH", {
          bookingHorizonDays: etat.horizonDays,
          autoConfirm: etat.autoConfirm,
          waitlistEnabled: etat.waitlist,
          allowOverbooking: etat.overbooking,
        });
      });
    }
    // Téléphone obligatoire — porté par le COMPTE, pas l'établissement.
    if (etat.phoneRequired !== initial.phoneRequired) {
      taches.push(function () { return json("/account/phone-required", "PATCH", { phoneRequired: etat.phoneRequired }); });
    }

    if (taches.length === 0) { btn.disabled = false; btn.textContent = "Enregistrer"; return; }

    // En série : les écritures visent le même document, un envoi parallèle
    // ferait s'écraser les mises à jour positionnelles (schedule.$).
    taches.reduce(function (chaine, t) { return chaine.then(t); }, Promise.resolve())
      .then(function () { window.location.reload(); })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Enregistrer";
        alert(err.serveur || "L'enregistrement a échoué. Rien n'a peut-être été sauvegardé — vérifiez la page.");
      });
  });

  // Avertit avant de quitter avec des modifications en attente.
  window.addEventListener("beforeunload", function (e) {
    if (!etat.sale) return;
    e.preventDefault();
    e.returnValue = "";
  });

  recalculer();
})();
