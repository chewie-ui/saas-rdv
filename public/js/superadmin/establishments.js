/* Page superadmin « Établissements » : filtres, plan et durée d'octroi,
   fiche détaillée, modification, pause, impersonation et supervision. */
(function () {
  "use strict";

  var tableau = document.querySelector(".sa-table");

  // ── Filtres ───────────────────────────────────────────────────────────────
  document.querySelectorAll("#formFiltres [data-auto]").forEach(function (sel) {
    sel.addEventListener("change", function () { sel.form.submit(); });
  });

  function texte(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function dateFr(d) { return d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—"; }

  // ── Plan et durée d'octroi ────────────────────────────────────────────────
  function dateHeureFr(d) {
    return d
      ? new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";
  }
  // Un octroi peut durer quelques heures : « 12 min », « 3 h », « 49 j ».
  function tempsRestant(ms) {
    if (!(ms > 0)) return "expiré";
    var minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return minutes + " min";
    var heures = Math.ceil(ms / 3600000);
    if (heures < 48) return heures + " h";
    return Math.ceil(ms / 86400000) + " j";
  }

  // Le badge régénéré doit rester un BOUTON, sinon la durée cesse d'être
  // réglable d'un clic dès qu'on l'a modifiée une première fois.
  function badgeReste(expiry, plan, estStripe) {
    if (plan === "free") return '<span class="sa-muted">—</span>';
    if (!expiry) {
      // Abonnement Stripe sans octroi manuel : l'échéance appartient à Stripe.
      // Afficher « Illimité » ici faisait passer un essai de 30 jours pour un
      // accès à vie offert par erreur.
      if (estStripe) {
        return '<button type="button" class="sa-tag sa-tag--btn sa-tag--green" data-act="duree" title="Abonnement Stripe (essai ou payant) — aucun octroi manuel. Cliquez pour en ajouter un.">Abonné</button>';
      }
      return '<button type="button" class="sa-tag sa-tag--btn" data-act="duree" title="Modifier la durée d\'octroi">Illimité</button>';
    }
    var ms = new Date(expiry) - new Date();
    var jours = Math.max(0, Math.ceil(ms / 86400000));
    return (
      '<button type="button" class="sa-tag sa-tag--btn ' + (jours <= 3 ? "sa-tag--red" : "sa-tag--amber") +
      '" data-act="duree" title="Jusqu\'au ' + texte(dateHeureFr(expiry)) + ' — cliquez pour modifier">' +
      tempsRestant(ms) + "</button>"
    );
  }

  function enregistrerPlan(id, plan, duree, jours, unite, dateIso) {
    var corps = { plan: plan };
    if (duree && duree !== "keep") {
      corps.duration = duree;
      if (duree === "custom") {
        corps.customValue = jours;
        corps.customUnit = unite || "d";
        corps.customDays = jours; // compat ancien format (unité = jours)
      }
      if (duree === "date") corps.expiryAt = dateIso;
    }
    return fetch("/superadmin/establishments/" + id + "/plan", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
    }).then(function (r) { return r.json(); });
  }

  document.querySelectorAll(".js-plan").forEach(function (sel) {
    sel.addEventListener("change", function () {
      var tr = sel.closest("tr");
      var etaitGratuit = sel.dataset.plan === "basic" || sel.dataset.plan === "free";
      sel.disabled = true;
      enregistrerPlan(tr.dataset.companyId, sel.value, "keep")
        .then(function (d) {
          sel.disabled = false;
          if (!d.success) throw new Error(d.error || "échec");
          sel.dataset.plan = sel.value;
          tr.dataset.plan = sel.value === "free" ? "basic" : sel.value;
          tr.dataset.expiry = d.expiry || "";
          tr.querySelector(".js-reste").innerHTML = badgeReste(d.expiry, sel.value, tr.dataset.stripe === "1");
          window.saToast("Plan mis à jour.");
          // Passage du gratuit à un plan payant : « Business » seul ne dit pas
          // POUR COMBIEN DE TEMPS. On enchaîne donc sur le choix de la durée,
          // au lieu d'accorder un accès illimité par défaut sans le demander.
          if (etaitGratuit && sel.value !== "free") ouvrirDuree(tr);
        })
        .catch(function (e) {
          sel.disabled = false;
          sel.value = sel.dataset.plan === "basic" ? "free" : sel.dataset.plan;
          window.saToast(e.message || "Changement de plan impossible.", "err");
        });
    });
  });

  // ── Durée d'octroi (modale) ───────────────────────────────────────────────
  var modalDuree = document.getElementById("modalDuree");
  var durChoix = document.getElementById("durChoix");
  var durPerso = document.getElementById("durPersoBloc");
  var durJours = document.getElementById("durJours");
  var durUnite = document.getElementById("durUnite");
  var durDateBloc = document.getElementById("durDateBloc");
  var durDate = document.getElementById("durDate");
  var durApercu = document.getElementById("durApercu");
  var ligneDuree = null;

  // Valeur d'un <input type="datetime-local"> → Date (heure locale).
  function dateDuChamp() {
    var v = durDate.value;
    if (!v) return null;
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  // Date → "YYYY-MM-DDTHH:mm" pour préremplir le champ (sans décalage UTC).
  function pourChamp(d) {
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  // Rejoue le calcul du serveur pour annoncer l'échéance avant l'envoi.
  function echeancePrevue() {
    var choix = durChoix.value;
    if (choix === "infinite") return null;
    if (choix === "date") return dateDuChamp();
    var valeur;
    var unite;
    if (choix === "custom") {
      valeur = Number(durJours.value);
      unite = durUnite.value;
    } else {
      var m = /^(\d+)(h|d|mo)$/.exec(choix);
      if (!m) return null;
      valeur = Number(m[1]);
      unite = m[2];
    }
    if (!(valeur > 0)) return null;
    var d = new Date();
    if (unite === "h") d.setHours(d.getHours() + valeur);
    else if (unite === "mo") d.setMonth(d.getMonth() + valeur);
    else d.setDate(d.getDate() + valeur);
    return d;
  }
  function majApercu() {
    var choix = durChoix.value;
    durPerso.style.display = choix === "custom" ? "" : "none";
    durDateBloc.style.display = choix === "date" ? "" : "none";
    if (choix === "infinite") {
      durApercu.innerHTML = "Le plan reste actif tant que vous ne le retirez pas.";
      return;
    }
    var d = echeancePrevue();
    if (!d) { durApercu.innerHTML = '<span style="color:var(--sa-red,#f87171)">Renseignez une échéance valide.</span>'; return; }
    if (d <= new Date()) { durApercu.innerHTML = '<span style="color:var(--sa-red,#f87171)">Cette date est déjà passée.</span>'; return; }
    durApercu.innerHTML = "Retour au plan Free le <b style=\"color:var(--sa-txt)\">" + texte(dateHeureFr(d)) + "</b>.";
  }

  durChoix.addEventListener("change", majApercu);
  durJours.addEventListener("input", majApercu);
  durUnite.addEventListener("change", majApercu);
  durDate.addEventListener("input", majApercu);
  document.querySelectorAll("[data-close-duree]").forEach(function (el) {
    el.addEventListener("click", function () { modalDuree.classList.remove("is-open"); });
  });

  function ouvrirDuree(tr) {
    if (tr.dataset.plan === "basic") {
      return window.saToast("Passez d'abord l'établissement sur un plan payant.", "err");
    }
    ligneDuree = tr;
    document.getElementById("durNom").textContent = tr.dataset.name || "—";
    // Octroi déjà daté → on ouvre sur cette date, modifiable. Sinon illimité,
    // avec une date par défaut à +30 jours dans le champ.
    var actuel = tr.dataset.expiry ? new Date(tr.dataset.expiry) : null;
    if (actuel && !isNaN(actuel.getTime())) {
      durChoix.value = "date";
      durDate.value = pourChamp(actuel);
    } else {
      durChoix.value = "infinite";
      var defaut = new Date();
      defaut.setDate(defaut.getDate() + 30);
      durDate.value = pourChamp(defaut);
    }
    majApercu();
    modalDuree.classList.add("is-open");
  }

  document.getElementById("durSave").addEventListener("click", function () {
    if (!ligneDuree) return;
    var bouton = this;
    var plan = ligneDuree.querySelector(".js-plan").value;
    // On bloque avant l'aller-retour réseau si l'échéance n'a pas de sens.
    if (durChoix.value !== "infinite") {
      var prevue = echeancePrevue();
      if (!prevue || prevue <= new Date()) {
        return window.saToast("Choisissez une échéance dans le futur.", "err");
      }
    }
    var dateIso = durChoix.value === "date" && dateDuChamp() ? dateDuChamp().toISOString() : "";
    bouton.disabled = true;
    enregistrerPlan(ligneDuree.dataset.companyId, plan, durChoix.value, Number(durJours.value), durUnite.value, dateIso)
      .then(function (d) {
        bouton.disabled = false;
        if (!d.success) throw new Error(d.error || "échec");
        ligneDuree.dataset.expiry = d.expiry || "";
        ligneDuree.querySelector(".js-reste").innerHTML = badgeReste(d.expiry, plan, ligneDuree.dataset.stripe === "1");
        modalDuree.classList.remove("is-open");
        window.saToast("Durée d'octroi mise à jour.");
      })
      .catch(function (e) {
        bouton.disabled = false;
        window.saToast(e.message || "Mise à jour impossible.", "err");
      });
  });

  // ── Actions de ligne ──────────────────────────────────────────────────────
  function supprimerEtab(id) {
    return fetch("/superadmin/establishments/" + id, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d.success) throw new Error(d.error || "échec"); return d; });
  }

  function basculerPause(tr) {
    return fetch("/superadmin/establishments/" + tr.dataset.companyId + "/pause", { method: "PATCH" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || "échec");
        tr.dataset.paused = d.isPaused ? "1" : "0";
        var tag = tr.querySelector(".js-statut");
        if (tag) {
          tag.className = "sa-tag js-statut " + (d.isPaused ? "sa-tag--amber" : "sa-tag--green");
          tag.innerHTML = '<span class="sa-tag__dot"></span><span>' + (d.isPaused ? "En pause" : "Actif") + "</span>";
        }
        var item = tr.querySelector('[data-act="pause"] span:last-child');
        if (item) item.textContent = d.isPaused ? "Réactiver" : "Mettre en pause";
        return d;
      });
  }

  if (tableau) {
    tableau.addEventListener("click", async function (e) {
      var item = e.target.closest("[data-act]");
      if (!item) return;
      var tr = item.closest("tr");
      document.querySelectorAll(".sa-menu.is-open").forEach(function (m) { m.classList.remove("is-open"); });

      switch (item.dataset.act) {
        case "fiche": ouvrirFiche(tr); break;
        case "modifier": ouvrirEdition(tr); break;
        case "duree": ouvrirDuree(tr); break;
        case "pause":
          try { const d = await basculerPause(tr); window.saToast(d.isPaused ? "Établissement mis en pause." : "Établissement réactivé."); }
          catch (err) { window.saToast("Changement impossible.", "err"); }
          break;
        case "acces": impersonate(tr.dataset.ownerId); break;
        case "supervision": demanderSupervision(tr.dataset.ownerId, tr.dataset.name); break;
        case "supprimer": {
          var ok = await window.confirmModal(
            'Supprimer « ' + tr.dataset.name + ' » ?',
            "Toutes ses données (réservations, services, employés, avis…) seront définitivement supprimées. Le compte propriétaire, lui, est conservé.",
            { confirmLabel: "Supprimer", danger: true },
          );
          if (!ok) return;
          try { await supprimerEtab(tr.dataset.companyId); tr.remove(); window.saToast("Établissement supprimé."); }
          catch (err) { window.saToast(err.message || "Suppression impossible.", "err"); }
          break;
        }
      }
    });

    tableau.addEventListener("click", function (e) {
      if (e.target.closest(".sa-menu, select, a, button, input")) return;
      var tr = e.target.closest("tr[data-company-id]");
      if (tr) ouvrirFiche(tr);
    });
  }

  function impersonate(id) {
    if (!id) return;
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
    socket.on("supervision:closed-by-user", function () { location.href = "/superadmin/exit-impersonation"; });
  }
  function demanderSupervision(id, nom) {
    if (!id) return;
    fetch("/superadmin/supervision-request/" + id, { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || "échec");
        jetonAttendu = d.token;
        window.saToast("Demande envoyée pour " + nom + " — en attente de la réponse…");
      })
      .catch(function () { window.saToast("Demande impossible.", "err"); });
  }

  // ── Fiche détaillée ───────────────────────────────────────────────────────
  var drawer = document.getElementById("drawer");
  var dwBody = document.getElementById("dwBody");
  var ligneCourante = null;

  document.querySelectorAll("[data-close]").forEach(function (el) {
    el.addEventListener("click", function () { drawer.classList.remove("is-open"); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") drawer.classList.remove("is-open");
  });

  function prop(icone, cle, valeur) {
    return '<div class="sa-prop"><div class="sa-prop__k"><span class="material-symbols-outlined">' +
      icone + "</span><span>" + cle + '</span></div><div class="sa-prop__v">' + valeur + "</div></div>";
  }
  function kpi(icone, libelle, valeur) {
    return '<div class="sa-kpi"><div class="sa-kpi__label"><span class="material-symbols-outlined">' + icone +
      "</span><span>" + libelle + '</span></div><div class="sa-kpi__value">' + Number(valeur).toLocaleString("fr-FR") + "</div></div>";
  }

  function ouvrirFiche(tr) {
    ligneCourante = tr;
    var av = tr.querySelector(".sa-av");
    var dwAvatar = document.getElementById("dwAvatar");
    if (av && av.tagName === "IMG") {
      dwAvatar.outerHTML = '<img id="dwAvatar" class="sa-av" src="' + texte(av.src) + '" alt="" style="object-fit:cover">';
    } else {
      dwAvatar.outerHTML = '<span id="dwAvatar" class="sa-av" style="background:' + (av ? av.style.background : "#3b82f6") +
        '">' + texte(av ? av.textContent : "?") + "</span>";
    }
    document.getElementById("dwName").textContent = tr.dataset.name || "—";
    document.getElementById("dwSlug").textContent = "/" + (tr.dataset.slug || "");
    document.getElementById("dwVoir").href = "/" + (tr.dataset.slug || "");
    dwBody.innerHTML = '<div class="sa-muted">Chargement…</div>';
    drawer.classList.add("is-open");

    fetch("/superadmin/establishments/" + tr.dataset.companyId + "/details")
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
    var c = d.company;
    var o = d.owner;
    var couleurs = { Free: "", Essentiel: "sa-tag--blue", Pro: "sa-tag--green", Business: "sa-tag--violet" };
    var html = '<div class="sa-kpis" style="grid-template-columns:repeat(3,1fr)">' +
      kpi("event", "Réservations", d.stats.reservations) +
      kpi("schedule", "À venir", d.stats.aVenir) +
      kpi("groups", "Clients", d.stats.clients) +
      kpi("content_cut", "Services", d.stats.services) +
      kpi("badge", "Employés", d.stats.employes) +
      kpi("star", "Avis", d.stats.avis) +
      "</div>";

    html += '<div class="sa-section"><div class="sa-section__t">Établissement</div><div class="sa-props">';
    html += prop("badge", "Statut", c.isDeleted
      ? '<span class="sa-tag sa-tag--red">Supprimé par le pro</span>'
      : c.isPaused
        ? '<span class="sa-tag sa-tag--amber"><span class="sa-tag__dot"></span>En pause</span>'
        : '<span class="sa-tag sa-tag--green"><span class="sa-tag__dot"></span>Actif</span>');
    html += prop("work", "Métier", c.businessType ? texte(c.businessType) : '<span class="sa-muted">non renseigné</span>');
    html += prop("link", "Lien public", '<a href="/' + texte(c.slug) + '" target="_blank" style="color:#93c5fd">/' + texte(c.slug) + "</a>");
    html += prop("event_available", "Créé le", dateFr(c.createdAt));
    if (c.description) html += prop("notes", "Description", texte(c.description.slice(0, 240)));
    html += "</div></div>";

    html += '<div class="sa-section"><div class="sa-section__t">Propriétaire</div><div class="sa-props">';
    if (o) {
      html += prop("person", "Nom", texte(o.fullName || "—") +
        (o.isDisabled ? ' <span class="sa-tag sa-tag--red">Compte désactivé</span>' : ""));
      html += prop("mail", "Email", texte(o.email));
      html += prop("call", "Téléphone", o.phone ? texte(o.phone) : '<span class="sa-muted">—</span>');
      html += prop("workspace_premium", "Plan", '<span class="sa-tag ' + (couleurs[o.planLabel] || "") + '">' + texte(o.planLabel) + "</span>" +
        (o.manualPremium ? ' <span class="sa-muted" style="font-size:12px">octroi manuel</span>' : ""));
      html += prop("timer", "Fin d'octroi", o.manualPremiumExpiry ? dateHeureFr(o.manualPremiumExpiry) : '<span class="sa-muted">illimité</span>');
    } else {
      html += '<div class="sa-muted">Aucun propriétaire rattaché.</div>';
    }
    html += "</div></div>";
    return html;
  }

  document.getElementById("dwEdit").addEventListener("click", function () {
    if (ligneCourante) ouvrirEdition(ligneCourante);
  });
  document.getElementById("dwDel").addEventListener("click", async function () {
    if (!ligneCourante) return;
    var ok = await window.confirmModal(
      'Supprimer « ' + ligneCourante.dataset.name + ' » ?',
      "Toutes ses données seront définitivement supprimées. Le compte propriétaire est conservé.",
      { confirmLabel: "Supprimer", danger: true },
    );
    if (!ok) return;
    try {
      await supprimerEtab(ligneCourante.dataset.companyId);
      ligneCourante.remove();
      drawer.classList.remove("is-open");
      window.saToast("Établissement supprimé.");
    } catch (e) { window.saToast(e.message || "Suppression impossible.", "err"); }
  });

  // ── Modification (nom, métier, photo) ─────────────────────────────────────
  var modal = document.getElementById("modalEdit");
  var edNom = document.getElementById("edName");
  var edType = document.getElementById("edType");
  var edPhoto = document.getElementById("edPhoto");
  var edFile = document.getElementById("edFile");

  document.getElementById("edPick").addEventListener("click", function () { edFile.click(); });
  edFile.addEventListener("change", function () {
    var f = edFile.files[0];
    if (!f) return;
    var lecteur = new FileReader();
    lecteur.onload = function (e) { edPhoto.src = e.target.result; };
    lecteur.readAsDataURL(f);
  });
  document.querySelectorAll("[data-close-edit]").forEach(function (el) {
    el.addEventListener("click", function () { modal.classList.remove("is-open"); });
  });

  function ouvrirEdition(tr) {
    ligneCourante = tr;
    edNom.value = tr.dataset.name || "";
    edType.value = tr.dataset.type || "";
    edPhoto.src = tr.dataset.photo || "/images/no-user.webp";
    edFile.value = "";
    modal.classList.add("is-open");
    setTimeout(function () { edNom.focus(); }, 40);
  }

  document.getElementById("edSave").addEventListener("click", function () {
    if (!ligneCourante) return;
    var bouton = this;
    var donnees = new FormData();
    donnees.append("name", edNom.value.trim());
    donnees.append("businessType", edType.value.trim());
    if (edFile.files[0]) donnees.append("photo", edFile.files[0]);
    bouton.disabled = true;

    fetch("/superadmin/establishments/" + ligneCourante.dataset.companyId + "/info", { method: "PATCH", body: donnees })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        bouton.disabled = false;
        if (!d.success) throw new Error(d.error || "échec");
        var tr = ligneCourante;
        if (d.update.name !== undefined) {
          tr.dataset.name = d.update.name || "";
          tr.querySelector(".js-name").textContent = d.update.name || "—";
        }
        if (d.update.businessType !== undefined) {
          tr.dataset.type = d.update.businessType || "";
          tr.querySelector(".js-type").textContent = d.update.businessType || "Métier non renseigné";
        }
        if (d.update.photo) {
          tr.dataset.photo = d.update.photo;
          var img = tr.querySelector(".js-photo");
          if (img) img.src = d.update.photo;
        }
        modal.classList.remove("is-open");
        window.saToast("Établissement mis à jour.");
      })
      .catch(function (e) {
        bouton.disabled = false;
        window.saToast(e.message || "Enregistrement impossible.", "err");
      });
  });
})();
