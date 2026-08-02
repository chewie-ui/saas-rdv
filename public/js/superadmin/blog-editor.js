/* Éditeur d'article (superadmin → Blog).

   Volontairement sans dépendance : le corps de l'article est un
   contenteditable piloté par document.execCommand. C'est déprécié, mais
   toujours implémenté partout et c'est la seule option qui ne demande pas
   d'embarquer une bibliothèque de 100 Ko. Le HTML produit est de toute façon
   repassé au filtre côté serveur (utils/sanitizeArticleHtml.js), donc les
   variations entre navigateurs sont normalisées à l'enregistrement. */
(function () {
  "use strict";

  var racine = document.querySelector(".bl-editor");
  if (!racine) return;

  var elTitre = document.getElementById("edTitle");
  var elChapeau = document.getElementById("edExcerpt");
  var elCorps = document.getElementById("edContent");
  var elSlug = document.getElementById("edSlug");
  var elCategorie = document.getElementById("edCategory");
  var elAuteur = document.getElementById("edAuthor");
  var elMetaTitre = document.getElementById("edMetaTitle");
  var elMetaDesc = document.getElementById("edMetaDesc");
  var elStats = document.getElementById("edStats");
  var elSauve = document.getElementById("edSaved");
  var elEtat = document.getElementById("edState");

  var id = racine.dataset.id || "";
  var statut = racine.dataset.status || "draft";
  var slugTouche = !!racine.dataset.slug; // slug déjà fixé → ne plus le déduire du titre
  var sale = false; // des modifications non enregistrées ?
  var enCours = false;

  /* ── Slug ──────────────────────────────────────────────────────────────── */
  function slugifier(texte) {
    return String(texte || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/['’]/g, "-")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90);
  }

  /* ── Aperçu Google + compteurs ─────────────────────────────────────────── */
  function texteBrut(html) {
    var d = document.createElement("div");
    d.innerHTML = html;
    return (d.textContent || "").replace(/\s+/g, " ").trim();
  }

  function majApercu() {
    var slug = elSlug.value || slugifier(elTitre.value) || "adresse-de-la-page";
    document.getElementById("serpSlug").textContent = slug;

    var titre = (elMetaTitre.value || elTitre.value || "Titre de l'article") + " — BranShee";
    var desc = elMetaDesc.value || elChapeau.value || texteBrut(elCorps.innerHTML).slice(0, 160);
    document.getElementById("serpTitle").textContent = titre;
    document.getElementById("serpDesc").textContent = desc || "Aucune description : Google en inventera une.";

    // Google coupe autour de 60 caractères pour le titre, 155 pour la
    // description. On prévient au lieu d'interdire.
    compteur("edMetaTitleCount", titre.length, 60);
    compteur("edMetaDescCount", (desc || "").length, 155);

    var mots = texteBrut(elCorps.innerHTML).split(/\s+/).filter(Boolean).length;
    var minutes = Math.max(1, Math.round(mots / 200));
    elStats.textContent = mots.toLocaleString("fr-FR") + " mots · " + minutes + " min de lecture";

    // Le placeholder CSS ne se déclenche que sur :empty ; un <br> résiduel
    // suffirait à le faire disparaître alors que la zone est vide à l'œil.
    elCorps.dataset.vide = texteBrut(elCorps.innerHTML) === "" && !elCorps.querySelector("img") ? "1" : "0";
  }

  function compteur(idElem, longueur, limite) {
    var el = document.getElementById(idElem);
    if (!el) return;
    el.textContent = longueur + " / " + limite;
    el.classList.toggle("is-long", longueur > limite);
  }

  /* ── Barre d'outils ────────────────────────────────────────────────────── */
  function executer(cmd, valeur) {
    elCorps.focus();
    document.execCommand(cmd, false, valeur || null);
    marquerSale();
  }

  document.querySelectorAll(".bl-tool[data-cmd]").forEach(function (btn) {
    // mousedown + preventDefault : sans ça, cliquer le bouton retire le
    // focus de la zone d'écriture et la sélection est perdue avant la commande.
    btn.addEventListener("mousedown", function (e) { e.preventDefault(); });
    btn.addEventListener("click", function () {
      var cmd = btn.dataset.cmd;
      var val = btn.dataset.val;
      if (cmd === "formatBlock") executer(cmd, "<" + val + ">");
      else executer(cmd);
      majEtatsOutils();
    });
  });

  function majEtatsOutils() {
    document.querySelectorAll(".bl-tool[data-cmd]").forEach(function (btn) {
      var cmd = btn.dataset.cmd;
      var actif = false;
      try {
        if (cmd === "formatBlock") {
          var bloc = document.queryCommandValue("formatBlock").toLowerCase();
          actif = bloc === btn.dataset.val || (btn.dataset.val === "p" && (bloc === "div" || bloc === ""));
        } else if (cmd !== "insertHorizontalRule") {
          actif = document.queryCommandState(cmd);
        }
      } catch (e) { /* certains navigateurs refusent la requête hors focus */ }
      btn.classList.toggle("is-active", !!actif);
    });
  }
  elCorps.addEventListener("keyup", majEtatsOutils);
  elCorps.addEventListener("mouseup", majEtatsOutils);

  // Nettoyer la mise en forme d'une sélection (utile après un copier-coller).
  var btnClean = document.querySelector('.bl-tool[data-act="clean"]');
  if (btnClean) {
    btnClean.addEventListener("mousedown", function (e) { e.preventDefault(); });
    btnClean.addEventListener("click", function () { executer("removeFormat"); });
  }

  // Coller en texte brut : c'est le geste qui pollue le plus un article
  // (styles Word, polices, couleurs). Le nettoyage serveur s'en occuperait,
  // mais autant que l'aperçu soit fidèle tout de suite.
  elCorps.addEventListener("paste", function (e) {
    var presse = e.clipboardData;
    if (!presse) return;
    e.preventDefault();
    var texte = presse.getData("text/plain") || "";
    document.execCommand("insertText", false, texte);
    marquerSale();
  });

  /* ── Liens ─────────────────────────────────────────────────────────────── */
  var modalLien = document.getElementById("modalLien");
  var selectionSauvee = null;

  function sauverSelection() {
    var sel = window.getSelection();
    if (sel && sel.rangeCount) selectionSauvee = sel.getRangeAt(0).cloneRange();
  }
  function restaurerSelection() {
    if (!selectionSauvee) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(selectionSauvee);
  }

  var btnLien = document.querySelector('.bl-tool[data-act="link"]');
  if (btnLien) {
    btnLien.addEventListener("mousedown", function (e) { e.preventDefault(); });
    btnLien.addEventListener("click", function () {
      sauverSelection();
      var sel = window.getSelection();
      document.getElementById("lienTexte").value = sel ? String(sel).trim() : "";
      document.getElementById("lienUrl").value = "";
      modalLien.classList.add("is-open");
      document.getElementById("lienUrl").focus();
    });
  }
  document.querySelectorAll("[data-close-lien]").forEach(function (el) {
    el.addEventListener("click", function () { modalLien.classList.remove("is-open"); });
  });
  document.getElementById("lienOk").addEventListener("click", function () {
    var url = document.getElementById("lienUrl").value.trim();
    var texte = document.getElementById("lienTexte").value.trim();
    if (!url) return window.saToast("Indiquez une adresse.", "err");
    // Une adresse sans protocole ni / de départ ne mènerait nulle part.
    if (!/^(https?:|mailto:|tel:|\/|#)/i.test(url)) url = "https://" + url;

    elCorps.focus();
    restaurerSelection();
    var sel = window.getSelection();
    if (sel && String(sel).trim()) {
      document.execCommand("createLink", false, url);
    } else {
      var a = document.createElement("a");
      a.href = url;
      a.textContent = texte || url;
      insererNoeud(a);
    }
    modalLien.classList.remove("is-open");
    marquerSale();
  });

  function insererNoeud(noeud) {
    var sel = window.getSelection();
    if (sel && sel.rangeCount) {
      var range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(noeud);
      range.setStartAfter(noeud);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      elCorps.appendChild(noeud);
    }
  }

  /* ── Images ────────────────────────────────────────────────────────────── */
  function envoyerImage(fichier) {
    var form = new FormData();
    form.append("image", fichier);
    return fetch("/superadmin/blog/image", { method: "POST", body: form })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success || !d.url) throw new Error(d.error || d.message || "Envoi impossible.");
        return d.url;
      });
  }

  var champImageCorps = document.getElementById("edBodyFile");
  var btnImage = document.querySelector('.bl-tool[data-act="image"]');
  if (btnImage) {
    btnImage.addEventListener("mousedown", function (e) { e.preventDefault(); });
    btnImage.addEventListener("click", function () { sauverSelection(); champImageCorps.click(); });
  }
  champImageCorps.addEventListener("change", function () {
    var f = champImageCorps.files && champImageCorps.files[0];
    if (!f) return;
    window.saToast("Envoi de l'image…");
    envoyerImage(f)
      .then(function (url) {
        elCorps.focus();
        restaurerSelection();
        var img = document.createElement("img");
        img.src = url;
        img.alt = "";
        insererNoeud(img);
        marquerSale();
        window.saToast("Image insérée.");
      })
      .catch(function (e) { window.saToast(e.message, "err"); })
      .then(function () { champImageCorps.value = ""; });
  });

  // Couverture
  var boiteCouv = document.getElementById("edCoverBox");
  var imgCouv = document.getElementById("edCoverImg");
  var champCouv = document.getElementById("edCoverFile");
  var btnCouvClear = document.getElementById("edCoverClear");

  function majCouverture(url) {
    imgCouv.src = url || "";
    boiteCouv.classList.toggle("has-image", !!url);
    btnCouvClear.hidden = !url;
    marquerSale();
  }
  majCouverture(imgCouv.getAttribute("src") || "");

  function choisirCouverture() { champCouv.click(); }
  boiteCouv.addEventListener("click", choisirCouverture);
  document.getElementById("edCoverPick").addEventListener("click", choisirCouverture);
  btnCouvClear.addEventListener("click", function () { majCouverture(""); });
  champCouv.addEventListener("change", function () {
    var f = champCouv.files && champCouv.files[0];
    if (!f) return;
    window.saToast("Envoi de l'image…");
    envoyerImage(f)
      .then(function (url) { majCouverture(url); window.saToast("Couverture mise à jour."); })
      .catch(function (e) { window.saToast(e.message, "err"); })
      .then(function () { champCouv.value = ""; });
  });

  /* ── Enregistrement ────────────────────────────────────────────────────── */
  function corpsRequete(statutVoulu) {
    var donnees = {
      title: elTitre.value,
      excerpt: elChapeau.value,
      contentHtml: elCorps.innerHTML,
      category: elCategorie.value,
      authorName: elAuteur.value,
      coverImage: imgCouv.getAttribute("src") || "",
      metaTitle: elMetaTitre.value,
      metaDescription: elMetaDesc.value,
    };
    if (elSlug.value.trim()) donnees.slug = elSlug.value.trim();
    if (statutVoulu) donnees.status = statutVoulu;
    return donnees;
  }

  function enregistrer(statutVoulu, silencieux) {
    if (enCours) return Promise.resolve(false);
    if (!elTitre.value.trim() && !texteBrut(elCorps.innerHTML)) {
      if (!silencieux) window.saToast("Écrivez au moins un titre avant d'enregistrer.", "err");
      return Promise.resolve(false);
    }
    enCours = true;
    elSauve.className = "bl-saved";
    elSauve.textContent = "Enregistrement…";

    var url = id ? "/superadmin/blog/" + id : "/superadmin/blog";
    return fetch(url, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpsRequete(statutVoulu)),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || "Enregistrement impossible.");
        // Première sauvegarde : on passe en mode « modification » sans
        // recharger, pour ne pas casser le fil d'écriture.
        if (!id && d.id) {
          id = d.id;
          racine.dataset.id = id;
          history.replaceState(null, "", "/superadmin/blog/" + id);
        }
        if (d.slug) { elSlug.value = d.slug; slugTouche = true; }
        if (d.status) majStatut(d.status);
        sale = false;
        elSauve.className = "bl-saved is-ok";
        elSauve.textContent = "Enregistré à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        majApercu();
        return true;
      })
      .catch(function (e) {
        elSauve.className = "bl-saved is-err";
        elSauve.textContent = "Échec de l'enregistrement";
        if (!silencieux) window.saToast(e.message, "err");
        return false;
      })
      .then(function (ok) { enCours = false; return ok; });
  }

  function majStatut(nouveau) {
    statut = nouveau;
    racine.dataset.status = nouveau;
    var publie = nouveau === "published";
    elEtat.textContent = publie ? "En ligne" : "Brouillon";
    document.getElementById("btnPublishLabel").textContent = publie ? "Dépublier" : "Publier";
    var ic = document.querySelector("#btnPublish .material-symbols-outlined");
    if (ic) ic.textContent = publie ? "visibility_off" : "publish";
  }

  document.getElementById("btnSave").addEventListener("click", function () {
    enregistrer(null, false).then(function (ok) { if (ok) window.saToast("Article enregistré."); });
  });

  document.getElementById("btnPublish").addEventListener("click", function () {
    var vaPublier = statut !== "published";
    if (!vaPublier) {
      enregistrer("draft", false).then(function (ok) {
        if (ok) window.saToast("Article dépublié — il n'est plus visible du public.");
      });
      return;
    }
    // Publier, c'est rendre la page visible de Google : on vérifie l'essentiel.
    var manques = [];
    if (!elTitre.value.trim()) manques.push("un titre");
    if (!texteBrut(elCorps.innerHTML)) manques.push("du contenu");
    if (manques.length) return window.saToast("Il manque " + manques.join(" et ") + ".", "err");

    var sansChapeau = !elChapeau.value.trim() && !elMetaDesc.value.trim();
    var sansCouv = !imgCouv.getAttribute("src");
    var avertissements = [];
    if (sansChapeau) avertissements.push("aucun chapeau ni description (Google en inventera une)");
    if (sansCouv) avertissements.push("aucune image de couverture (le partage sera terne)");

    var suite = avertissements.length
      ? window.confirmModal(
          "Publier quand même ?",
          "L'article sera visible immédiatement, mais il a " + avertissements.join(" et ") + ".",
          { confirmLabel: "Publier" }
        )
      : Promise.resolve(true);

    suite.then(function (ok) {
      if (!ok) return;
      enregistrer("published", false).then(function (fait) {
        if (fait) window.saToast("Article en ligne : /blog/" + elSlug.value);
      });
    });
  });

  /* ── Suivi des modifications ───────────────────────────────────────────── */
  function marquerSale() {
    sale = true;
    elSauve.className = "bl-saved";
    elSauve.textContent = "Modifications non enregistrées";
    majApercu();
  }

  [elTitre, elChapeau, elCategorie, elAuteur, elMetaTitre, elMetaDesc].forEach(function (el) {
    el.addEventListener("input", marquerSale);
  });
  elCorps.addEventListener("input", marquerSale);

  elTitre.addEventListener("input", function () {
    // Tant que le slug n'a pas été fixé, il suit le titre — c'est le cas le
    // plus courant et ça évite une adresse oubliée en « article-sans-titre ».
    if (!slugTouche) {
      elSlug.value = slugifier(elTitre.value);
      majApercu();
    }
  });
  elSlug.addEventListener("input", function () {
    slugTouche = true;
    elSlug.value = slugifier(elSlug.value);
    majApercu();
  });

  // Enregistrement automatique en brouillon : on n'écrit pas 40 minutes pour
  // tout perdre sur un onglet fermé. Un article DÉJÀ publié n'est jamais
  // republié tout seul — la sauvegarde garde son statut en ligne.
  setInterval(function () {
    if (sale && !enCours && (elTitre.value.trim() || texteBrut(elCorps.innerHTML))) {
      enregistrer(null, true);
    }
  }, 30000);

  window.addEventListener("beforeunload", function (e) {
    if (!sale) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // Ctrl/Cmd + S
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      enregistrer(null, false);
    }
  });

  majApercu();
  majEtatsOutils();
})();
