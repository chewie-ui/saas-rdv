/* Chat support superadmin : liste des conversations, fil de discussion,
   réponses en direct (socket.io) et fermeture d'une conversation. */
(function () {
  "use strict";

  var liste = document.getElementById("chatList");
  var panneau = document.getElementById("chatPanel");
  var utilisateurCourant = null;

  var PALETTE = ["#6ee7b7", "#93c5fd", "#fcd34d", "#fca5a5", "#c4b5fd", "#f9a8d4", "#a5f3fc", "#bef264"];
  function couleur(s) {
    var n = 0;
    for (var i = 0; i < String(s).length; i++) n += String(s).charCodeAt(i);
    return PALETTE[n % PALETTE.length];
  }
  function initiale(s) { return String(s || "?").trim().charAt(0).toUpperCase() || "?"; }
  function texte(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function heure(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + " " +
      d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }

  function htmlMessage(m) {
    return '<div class="sa-msg sa-msg--' + (m.sender === "admin" ? "admin" : "user") + '">' +
      texte(m.text) + '<span class="sa-msg__time">' + heure(m.createdAt) + "</span></div>";
  }

  // ── Fil de discussion ─────────────────────────────────────────────────────
  function brancherFormulaire(userId, boite, champ, bouton) {
    function envoyer() {
      var contenu = champ.value.trim();
      if (!contenu) return;
      bouton.disabled = true;
      fetch("/superadmin/support-chat/" + userId + "/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: contenu }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          bouton.disabled = false;
          if (!d.success) throw new Error(d.error || "échec");
          champ.value = "";
          boite.insertAdjacentHTML("beforeend", htmlMessage({ sender: "admin", text: contenu, createdAt: new Date().toISOString() }));
          boite.scrollTop = boite.scrollHeight;
        })
        .catch(function () {
          bouton.disabled = false;
          window.saToast("Envoi impossible.", "err");
        });
    }
    bouton.addEventListener("click", envoyer);
    champ.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoyer(); }
    });
  }

  async function ouvrir(userId) {
    utilisateurCourant = userId;
    liste.querySelectorAll(".sa-chat__item").forEach(function (el) {
      var actif = el.dataset.userId === userId;
      el.classList.toggle("is-active", actif);
      if (actif) {
        var pastille = el.querySelector(".sa-chat__unread");
        if (pastille) pastille.remove();
      }
    });

    try {
      var res = await fetch("/superadmin/support-chat/" + userId);
      var data = await res.json();
      if (!data.success) throw new Error();
      var titre = data.chat.businessName || data.chat.email || "Utilisateur";

      panneau.innerHTML =
        '<div class="sa-chat__head">' +
          '<span class="sa-av" style="background:' + couleur(data.chat.email || titre) + '">' + texte(initiale(titre)) + "</span>" +
          '<div style="min-width:0"><div class="sa-chat__title">' + texte(titre) + "</div>" +
          (data.chat.email ? '<div class="sa-head__sub">' + texte(data.chat.email) + "</div>" : "") + "</div>" +
          '<div style="margin-left:auto;display:flex;gap:8px">' +
            '<button class="sa-btn" id="chatAcces"><span class="material-symbols-outlined">lock_open</span><span>Accéder</span></button>' +
            '<button class="sa-btn sa-btn--danger" id="chatClose"><span class="material-symbols-outlined">close</span><span>Fermer</span></button>' +
          "</div>" +
        "</div>" +
        '<div class="sa-chat__msgs" id="chatMessages">' + data.chat.messages.map(htmlMessage).join("") + "</div>" +
        '<div class="sa-chat__form">' +
          '<textarea class="sa-textarea" id="chatInput" rows="1" placeholder="Votre réponse… (Entrée pour envoyer)"></textarea>' +
          '<button class="sa-btn sa-btn--primary" id="chatSend"><span class="material-symbols-outlined">send</span><span>Envoyer</span></button>' +
        "</div>";

      var boite = document.getElementById("chatMessages");
      boite.scrollTop = boite.scrollHeight;
      brancherFormulaire(userId, boite, document.getElementById("chatInput"), document.getElementById("chatSend"));
      document.getElementById("chatClose").addEventListener("click", function () { fermer(userId); });
      document.getElementById("chatAcces").addEventListener("click", function () {
        var form = document.createElement("form");
        form.method = "POST";
        form.action = "/superadmin/impersonate/" + userId;
        document.body.appendChild(form);
        form.submit();
      });
    } catch (e) {
      window.saToast("Conversation introuvable.", "err");
    }
  }

  // Fermer = supprimer la conversation (pas d'archivage, cf. note backend).
  async function fermer(userId) {
    var ok = await window.confirmModal(
      "Fermer cette conversation ?",
      "Elle sera définitivement supprimée, avec tout son historique.",
      { confirmLabel: "Fermer", danger: true },
    );
    if (!ok) return;
    try {
      var res = await fetch("/superadmin/support-chat/" + userId, { method: "DELETE" });
      var data = await res.json();
      if (!data.success) throw new Error();
      var item = liste.querySelector('.sa-chat__item[data-user-id="' + userId + '"]');
      if (item) item.remove();
      if (!liste.querySelector(".sa-chat__item")) {
        liste.innerHTML = '<div class="sa-chat__empty">Aucune conversation pour le moment.</div>';
      }
      if (utilisateurCourant === userId) {
        utilisateurCourant = null;
        panneau.innerHTML = '<div class="sa-chat__vide"><div class="sa-empty">' +
          '<div class="sa-empty__ic"><span class="material-symbols-outlined">forum</span></div>' +
          '<div class="sa-empty__t">Aucune conversation ouverte</div>' +
          '<div class="sa-empty__d">Choisissez un utilisateur dans la liste de gauche.</div></div></div>';
      }
      window.saToast("Conversation fermée.");
    } catch (e) {
      window.saToast("Fermeture impossible.", "err");
    }
  }

  liste.addEventListener("click", function (e) {
    var item = e.target.closest(".sa-chat__item");
    if (item) ouvrir(item.dataset.userId);
  });

  // ── Temps réel ────────────────────────────────────────────────────────────
  // On met la liste à jour sans recharger la page : un rechargement ferait
  // perdre la conversation ouverte dès qu'un autre utilisateur écrit.
  function majListe(charge) {
    var vide = liste.querySelector(".sa-chat__empty");
    if (vide) vide.remove();

    var item = liste.querySelector('.sa-chat__item[data-user-id="' + charge.userId + '"]');
    var ouvert = charge.userId === utilisateurCourant;
    var titre = charge.businessName || charge.email || "Utilisateur";
    var apercu = (charge.sender === "admin" ? "Vous : " : "") + charge.text;
    var nonLus = item ? parseInt((item.querySelector(".sa-chat__unread") || {}).textContent, 10) || 0 : 0;
    if (!ouvert && charge.sender === "user") nonLus += 1;

    if (!item) {
      item = document.createElement("div");
      item.className = "sa-chat__item";
      item.dataset.userId = charge.userId;
      item.innerHTML = '<span class="sa-av"></span><div class="sa-chat__item-txt">' +
        '<div class="sa-chat__item-top"><span class="sa-chat__item-name"></span></div>' +
        '<div class="sa-chat__item-prev"></div></div>';
    }
    item.dataset.name = titre;
    item.dataset.email = charge.email || "";
    item.classList.toggle("is-active", ouvert);
    var av = item.querySelector(".sa-av");
    av.style.background = couleur(charge.email || titre);
    av.textContent = initiale(titre);
    item.querySelector(".sa-chat__item-name").textContent = titre;
    item.querySelector(".sa-chat__item-prev").textContent = apercu;

    var haut = item.querySelector(".sa-chat__item-top");
    var ancien = haut.querySelector(".sa-chat__unread, .sa-chat__item-time");
    if (ancien) ancien.remove();
    var marque = document.createElement("span");
    if (nonLus > 0) { marque.className = "sa-chat__unread"; marque.textContent = nonLus; }
    else { marque.className = "sa-chat__item-time"; marque.textContent = heure(charge.createdAt).split(" ")[0]; }
    haut.appendChild(marque);

    liste.insertBefore(item, liste.firstChild);
  }

  try {
    var socket = io();
    socket.on("connect", function () { socket.emit("support:joinAdmin"); });
    socket.on("support:newMessage", function (charge) {
      if (!charge || !charge.userId) return;
      majListe(charge);
      if (charge.userId === utilisateurCourant) {
        var boite = document.getElementById("chatMessages");
        if (boite) {
          boite.insertAdjacentHTML("beforeend", htmlMessage(charge));
          boite.scrollTop = boite.scrollHeight;
        }
      }
    });
  } catch (e) { /* socket indisponible : la page reste utilisable */ }

  // ── Recherche dans la liste ───────────────────────────────────────────────
  var recherche = document.getElementById("chatSearch");
  recherche.addEventListener("input", function () {
    var q = recherche.value.trim().toLowerCase();
    var visible = false;
    liste.querySelectorAll(".sa-chat__item").forEach(function (item) {
      var ok = !q ||
        (item.dataset.name || "").toLowerCase().indexOf(q) !== -1 ||
        (item.dataset.email || "").toLowerCase().indexOf(q) !== -1;
      item.style.display = ok ? "" : "none";
      if (ok) visible = true;
    });
    var aucun = liste.querySelector(".sa-chat__aucun");
    if (!visible && liste.querySelector(".sa-chat__item")) {
      if (!aucun) {
        aucun = document.createElement("div");
        aucun.className = "sa-chat__empty sa-chat__aucun";
        aucun.textContent = "Aucun utilisateur trouvé.";
        liste.appendChild(aucun);
      }
    } else if (aucun) {
      aucun.remove();
    }
  });
})();
