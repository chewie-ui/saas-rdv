/* Page superadmin « Utilisateurs » : filtres, sélection multiple,
   fiche détaillée, messages, impersonation et supervision. */
(function () {
  "use strict";

  var tableau = document.querySelector(".sa-table");
  var barre = document.getElementById("bulkBar");
  var compteur = document.getElementById("bulkCount");
  var toutCocher = document.getElementById("checkAll");

  function lignes() { return Array.prototype.slice.call(document.querySelectorAll("tbody tr[data-user-id]")); }
  function selection() { return lignes().filter(function (tr) { return tr.querySelector(".js-row-check").checked; }); }

  // ── Filtres : les listes déroulantes soumettent le formulaire ─────────────
  document.querySelectorAll("#formFiltres [data-auto]").forEach(function (sel) {
    sel.addEventListener("change", function () { sel.form.submit(); });
  });
  var btnRefresh = document.getElementById("btnRefresh");
  if (btnRefresh) btnRefresh.addEventListener("click", function () { location.reload(); });

  // ── Sélection multiple ────────────────────────────────────────────────────
  function majSelection() {
    var n = selection().length;
    compteur.textContent = n + " compte" + (n > 1 ? "s" : "") + " sélectionné" + (n > 1 ? "s" : "");
    barre.classList.toggle("is-on", n > 0);
    lignes().forEach(function (tr) {
      tr.classList.toggle("is-selected", tr.querySelector(".js-row-check").checked);
    });
    if (toutCocher) {
      var total = lignes().length;
      toutCocher.checked = n > 0 && n === total;
      toutCocher.indeterminate = n > 0 && n < total;
    }
  }
  if (toutCocher) {
    toutCocher.addEventListener("change", function () {
      lignes().forEach(function (tr) { tr.querySelector(".js-row-check").checked = toutCocher.checked; });
      majSelection();
    });
  }
  document.querySelectorAll(".js-row-check").forEach(function (c) {
    c.addEventListener("change", majSelection);
  });

  // ── Statut actif / désactivé ──────────────────────────────────────────────
  document.querySelectorAll(".js-toggle").forEach(function (input) {
    input.addEventListener("change", function () {
      var tr = input.closest("tr");
      basculer(tr).catch(function () {
        input.checked = !input.checked;
        window.saToast("Impossible de changer le statut.", "err");
      });
    });
  });

  function basculer(tr) {
    return fetch("/superadmin/toggle-account/" + tr.dataset.userId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error("échec");
        var input = tr.querySelector(".js-toggle");
        var label = tr.querySelector(".js-toggle-label");
        input.checked = !d.isDisabled;
        label.textContent = d.isDisabled ? "Désactivé" : "Actif";
        tr.dataset.actif = d.isDisabled ? "0" : "1";
        return d;
      });
  }

  function supprimerCompte(id) {
    return fetch("/superadmin/users/" + id, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || "échec");
        return d;
      });
  }

  // ── Actions groupées ──────────────────────────────────────────────────────
  document.getElementById("bulkOff").addEventListener("click", async function () {
    // On ne bascule que les comptes actuellement actifs : un « toggle »
    // appliqué à une sélection mixte réactiverait les comptes déjà coupés.
    var cibles = selection().filter(function (tr) { return tr.dataset.actif === "1"; });
    if (!cibles.length) return window.saToast("Aucun compte actif dans la sélection.");
    var ok = await window.confirmModal(
      "Désactiver " + cibles.length + " compte(s) ?",
      "Les personnes concernées ne pourront plus se connecter. C'est réversible.",
    );
    if (!ok) return;
    for (var i = 0; i < cibles.length; i++) {
      try { await basculer(cibles[i]); } catch (e) { /* on continue les suivants */ }
    }
    majSelection();
    window.saToast(cibles.length + " compte(s) désactivé(s).");
  });

  document.getElementById("bulkDel").addEventListener("click", async function () {
    var cibles = selection();
    if (!cibles.length) return;
    var ok = await window.confirmModal(
      "Supprimer " + cibles.length + " compte(s) ?",
      "Toutes leurs données (réservations, services, employés…) seront définitivement supprimées. Action irréversible.",
    );
    if (!ok) return;
    var echecs = 0;
    for (var i = 0; i < cibles.length; i++) {
      try { await supprimerCompte(cibles[i].dataset.userId); cibles[i].remove(); }
      catch (e) { echecs++; }
    }
    majSelection();
    window.saToast(echecs ? echecs + " suppression(s) en échec." : "Comptes supprimés.", echecs ? "err" : "");
  });

  document.getElementById("bulkMsg").addEventListener("click", function () {
    var cibles = selection();
    if (!cibles.length) return;
    ouvrirMessage(
      cibles.map(function (tr) { return tr.dataset.userId; }),
      cibles.length + " destinataires",
    );
  });

  // ── Menu ⋮ de chaque ligne ────────────────────────────────────────────────
  if (tableau) {
    tableau.addEventListener("click", async function (e) {
      var item = e.target.closest("[data-act]");
      if (!item) return;
      var tr = item.closest("tr");
      var id = tr.dataset.userId;
      var nom = tr.dataset.userName;
      document.querySelectorAll(".sa-menu.is-open").forEach(function (m) { m.classList.remove("is-open"); });

      switch (item.dataset.act) {
        case "fiche":
          ouvrirFiche(tr);
          break;
        case "message":
          ouvrirMessage([id], nom);
          break;
        case "copie":
          try {
            await navigator.clipboard.writeText(tr.dataset.userMail);
            window.saToast("Email copié.");
          } catch (err) { window.saToast("Copie impossible.", "err"); }
          break;
        case "acces":
          impersonate(id);
          break;
        case "supervision":
          demanderSupervision(id, nom);
          break;
        case "supprimer": {
          var ok = await window.confirmModal(
            'Supprimer « ' + nom + ' » ?',
            "Toutes ses données (réservations, services, employés…) seront définitivement supprimées. Action irréversible.",
          );
          if (!ok) return;
          try { await supprimerCompte(id); tr.remove(); majSelection(); window.saToast("Compte supprimé."); }
          catch (err) { window.saToast(err.message || "Suppression impossible.", "err"); }
          break;
        }
      }
    });

    // Clic sur la ligne (hors contrôles) → fiche détaillée.
    tableau.addEventListener("click", function (e) {
      if (e.target.closest(".sa-menu, .sa-switch, .sa-check, a, button")) return;
      var tr = e.target.closest("tr[data-user-id]");
      if (tr) ouvrirFiche(tr);
    });
  }

  function impersonate(id) {
    var form = document.createElement("form");
    form.method = "POST";
    form.action = "/superadmin/impersonate/" + id;
    document.body.appendChild(form);
    form.submit();
  }

  // ── Supervision (l'utilisateur doit accepter) ─────────────────────────────
  var jetonAttendu = null;
  var socket = null;
  try { socket = io(); } catch (e) { socket = null; }
  if (socket) {
    socket.on("connect", function () { socket.emit("support:joinAdmin"); });
    socket.on("supervision:accepted", function (d) {
      if (d.token !== jetonAttendu) return;
      jetonAttendu = null;
      location.href = "/superadmin/impersonate-supervised/" + d.token;
    });
    socket.on("supervision:declined", function (d) {
      if (d.token !== jetonAttendu) return;
      jetonAttendu = null;
      window.saToast("Supervision refusée par l'utilisateur.", "err");
    });
  }
  function demanderSupervision(id, nom) {
    fetch("/superadmin/supervision-request/" + id, { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || "échec");
        jetonAttendu = d.token;
        window.saToast("Demande envoyée à " + nom + " — en attente de sa réponse…");
      })
      .catch(function () { window.saToast("Demande impossible.", "err"); });
  }

  // ── Fiche détaillée ───────────────────────────────────────────────────────
  var drawer = document.getElementById("drawer");
  var dwBody = document.getElementById("dwBody");
  var ficheId = null;
  var ficheNom = "";

  document.querySelectorAll("[data-close]").forEach(function (el) {
    el.addEventListener("click", function () { drawer.classList.remove("is-open"); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") drawer.classList.remove("is-open");
  });

  function ligneProp(icone, cle, valeur) {
    return '<div class="sa-prop"><div class="sa-prop__k"><span class="material-symbols-outlined">' +
      icone + "</span><span>" + cle + '</span></div><div class="sa-prop__v">' + valeur + "</div></div>";
  }
  function texte(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function dateFr(d) { return d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—"; }

  function ouvrirFiche(tr) {
    ficheId = tr.dataset.userId;
    ficheNom = tr.dataset.userName;
    var avatar = tr.querySelector(".sa-av");
    var dwAvatar = document.getElementById("dwAvatar");
    dwAvatar.textContent = avatar ? avatar.textContent : "?";
    dwAvatar.style.background = avatar ? avatar.style.background : "#3b82f6";
    document.getElementById("dwName").textContent = ficheNom;
    document.getElementById("dwMail").textContent = tr.dataset.userMail;
    dwBody.innerHTML = '<div class="sa-muted">Chargement…</div>';
    drawer.classList.add("is-open");

    fetch("/superadmin/users/" + ficheId + "/details")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || "échec");
        dwBody.innerHTML = htmlFiche(d);
      })
      .catch(function () {
        dwBody.innerHTML = '<div class="sa-muted">Impossible de charger la fiche.</div>';
      });
  }

  function htmlFiche(d) {
    var u = d.user;
    var couleurs = { Free: "", Essentiel: "sa-tag--blue", Pro: "sa-tag--green", Business: "sa-tag--violet" };
    var html = "";

    html += '<div class="sa-kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:4px">' +
      kpi("groups", "Clients", d.stats.clients) +
      kpi("event", "Réservations", d.stats.reservations) +
      kpi("login", "Connexions", d.stats.connexions) +
      "</div>";

    html += '<div class="sa-section"><div class="sa-section__t">Compte</div><div class="sa-props">';
    html += ligneProp("badge", "Statut", u.isDisabled
      ? '<span class="sa-tag sa-tag--red"><span class="sa-tag__dot"></span>Désactivé</span>'
      : '<span class="sa-tag sa-tag--green"><span class="sa-tag__dot"></span>Actif</span>');
    html += ligneProp("workspace_premium", "Plan", '<span class="sa-tag ' + (couleurs[u.planLabel] || "") + '">' + texte(u.planLabel) + "</span>" +
      (u.manualPremium ? ' <span class="sa-muted" style="font-size:12px">octroi manuel</span>' : ""));
    html += ligneProp("credit_card", "Abonnement", texte(u.subscriptionStatus));
    html += ligneProp("call", "Téléphone", u.phone ? texte(u.phone) : '<span class="sa-muted">—</span>');
    html += ligneProp("shield", "Sécurité",
      (u.google ? '<span class="sa-tag sa-tag--blue">Google</span> ' : "") +
      (u.twoFactor ? '<span class="sa-tag sa-tag--green">2FA</span>' : '<span class="sa-muted">2FA désactivée</span>'));
    html += ligneProp("event_available", "Inscrit le", dateFr(u.createdAt));
    html += ligneProp("schedule", "Dernière connexion", u.lastLoginAt ? dateFr(u.lastLoginAt) : '<span class="sa-muted">jamais</span>');
    html += ligneProp("fingerprint", "Identifiant", '<span class="sa-mono">' + texte(u.id) + "</span>");
    html += "</div></div>";

    html += '<div class="sa-section"><div class="sa-section__t">Établissements (' + d.establishments.length + ")</div>";
    if (d.establishments.length) {
      html += '<div class="sa-props">';
      d.establishments.forEach(function (e) {
        html += ligneProp("storefront", texte(e.name || "sans nom"),
          '<a href="/' + texte(e.slug) + '" target="_blank" style="color:#93c5fd">/' + texte(e.slug) + "</a>" +
          (e.isPaused ? ' <span class="sa-tag sa-tag--amber">En pause</span>' : ""));
      });
      html += "</div>";
    } else {
      html += '<div class="sa-muted">Aucun établissement.</div>';
    }
    html += "</div>";

    html += '<div class="sa-section"><div class="sa-section__t">Dernières actions</div>';
    if (d.activite && d.activite.length) {
      html += '<div class="sa-props">';
      d.activite.forEach(function (a) {
        html += ligneProp("history", new Date(a.createdAt).toLocaleDateString("fr-FR"), texte(a.description));
      });
      html += "</div>";
    } else {
      html += '<div class="sa-muted">Aucune activité enregistrée.</div>';
    }
    html += "</div>";
    return html;
  }

  function kpi(icone, libelle, valeur) {
    return '<div class="sa-kpi"><div class="sa-kpi__label"><span class="material-symbols-outlined">' + icone +
      "</span><span>" + libelle + '</span></div><div class="sa-kpi__value">' + Number(valeur).toLocaleString("fr-FR") + "</div></div>";
  }

  document.getElementById("dwMsg").addEventListener("click", function () { if (ficheId) ouvrirMessage([ficheId], ficheNom); });
  document.getElementById("dwImp").addEventListener("click", function () { if (ficheId) impersonate(ficheId); });
  document.getElementById("dwDel").addEventListener("click", async function () {
    if (!ficheId) return;
    var ok = await window.confirmModal('Supprimer « ' + ficheNom + ' » ?', "Action irréversible.");
    if (!ok) return;
    try {
      await supprimerCompte(ficheId);
      var tr = document.querySelector('tr[data-user-id="' + ficheId + '"]');
      if (tr) tr.remove();
      drawer.classList.remove("is-open");
      majSelection();
      window.saToast("Compte supprimé.");
    } catch (e) { window.saToast(e.message || "Suppression impossible.", "err"); }
  });

  // ── Message (un, plusieurs, ou tous) ──────────────────────────────────────
  var modal = document.getElementById("modalMsg");
  var destinataires = null; // null = diffusion à tous
  var tonalite = "info";

  function majTonalite() {
    document.querySelectorAll("#msgTypes [data-type]").forEach(function (b) {
      b.classList.toggle("sa-btn--primary", b.dataset.type === tonalite);
    });
  }
  document.querySelectorAll("#msgTypes [data-type]").forEach(function (b) {
    b.addEventListener("click", function () { tonalite = b.dataset.type; majTonalite(); });
  });

  function ouvrirMessage(ids, libelle) {
    destinataires = ids;
    document.getElementById("msgTo").textContent = libelle;
    ["msgTitle", "msgBody", "msgCtaLabel", "msgCtaUrl"].forEach(function (id) { document.getElementById(id).value = ""; });
    tonalite = "info";
    majTonalite();
    modal.classList.add("is-open");
    setTimeout(function () { document.getElementById("msgTitle").focus(); }, 40);
  }
  document.querySelectorAll("[data-close-msg]").forEach(function (el) {
    el.addEventListener("click", function () { modal.classList.remove("is-open"); });
  });
  var btnBroadcast = document.getElementById("btnBroadcast");
  if (btnBroadcast) btnBroadcast.addEventListener("click", function () { ouvrirMessage(null, "Tous les pros"); });

  document.getElementById("msgSend").addEventListener("click", async function () {
    var bouton = this;
    var titre = document.getElementById("msgTitle").value.trim();
    var corps = document.getElementById("msgBody").value.trim();
    if (!titre || !corps) return window.saToast("Titre et message requis.", "err");

    var base = {
      title: titre,
      body: corps,
      type: tonalite,
      ctaLabel: document.getElementById("msgCtaLabel").value.trim(),
      ctaUrl: document.getElementById("msgCtaUrl").value.trim(),
    };
    bouton.disabled = true;

    function envoyer(charge) {
      return fetch("/superadmin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(charge),
      }).then(function (r) { return r.json(); });
    }

    try {
      if (destinataires === null) {
        var d = await envoyer(Object.assign({ broadcast: true, recipientId: null }, base));
        if (!d.success) throw new Error(d.error || "échec");
        window.saToast("Message envoyé à tous les pros.");
      } else {
        var echecs = 0;
        for (var i = 0; i < destinataires.length; i++) {
          var r = await envoyer(Object.assign({ broadcast: false, recipientId: destinataires[i] }, base));
          if (!r.success) echecs++;
        }
        window.saToast(echecs ? echecs + " envoi(s) en échec." : "Message envoyé.", echecs ? "err" : "");
      }
      modal.classList.remove("is-open");
    } catch (e) {
      window.saToast(e.message || "Envoi impossible.", "err");
    } finally {
      bouton.disabled = false;
    }
  });

  majSelection();
})();
