/* Page superadmin « Messages » : composition avec aperçu en direct,
   envoi ciblé ou en diffusion, suppression d'un envoi. */
(function () {
  "use strict";

  var EXPEDITEUR = {
    info: "Message de BranShee",
    tip: "Conseil BranShee",
    success: "BranShee",
    warning: "Important",
    security: "Sécurité de votre compte",
  };
  var ICONES = { info: "info", tip: "lightbulb", success: "check_circle", warning: "warning", security: "lock" };

  var mode = "broadcast";
  var tonalite = "info";

  var champDestinataire = document.getElementById("champDestinataire");
  var email = document.getElementById("recipientEmail");
  var titre = document.getElementById("msgTitle");
  var corps = document.getElementById("msgBody");
  var ctaTexte = document.getElementById("ctaLabel");
  var ctaLien = document.getElementById("ctaUrl");
  var bouton = document.getElementById("sendBtn");

  var apercu = document.getElementById("apercu");
  var pvIcone = document.getElementById("pvIcone");
  var pvFrom = document.getElementById("pvFrom");
  var pvTitre = document.getElementById("pvTitre");
  var pvTexte = document.getElementById("pvTexte");
  var pvCta = document.getElementById("pvCta");

  function majApercu() {
    apercu.className = "sa-preview sa-preview--" + tonalite;
    pvIcone.querySelector(".material-symbols-outlined").textContent = ICONES[tonalite];
    pvFrom.textContent = EXPEDITEUR[tonalite] || "Message";
    pvTitre.textContent = titre.value.trim() || "Titre du message";
    pvTexte.textContent = corps.value.trim() || "Le contenu de votre message apparaîtra ici.";
    if (ctaTexte.value.trim()) { pvCta.style.display = ""; pvCta.textContent = ctaTexte.value.trim() + " →"; }
    else { pvCta.style.display = "none"; }
  }

  document.querySelectorAll("[data-mode]").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("[data-mode]").forEach(function (x) { x.classList.remove("is-on"); });
      b.classList.add("is-on");
      mode = b.dataset.mode;
      champDestinataire.style.display = mode === "targeted" ? "" : "none";
    });
  });

  document.querySelectorAll("#tonalites [data-type]").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll("#tonalites [data-type]").forEach(function (x) { x.classList.remove("sa-btn--primary"); });
      b.classList.add("sa-btn--primary");
      tonalite = b.dataset.type;
      majApercu();
    });
  });

  [titre, corps, ctaTexte].forEach(function (el) { el.addEventListener("input", majApercu); });
  majApercu();

  bouton.addEventListener("click", function () {
    if (!titre.value.trim() || !corps.value.trim()) return window.saToast("Titre et message requis.", "err");
    if (mode === "targeted" && !email.value.trim()) return window.saToast("Email du destinataire requis.", "err");

    bouton.disabled = true;
    fetch("/superadmin/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        broadcast: mode === "broadcast",
        recipientEmail: email.value.trim(),
        title: titre.value.trim(),
        body: corps.value.trim(),
        type: tonalite,
        ctaLabel: ctaTexte.value.trim(),
        ctaUrl: ctaLien.value.trim(),
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        bouton.disabled = false;
        if (!d.success) throw new Error(d.error || "échec");
        titre.value = ""; corps.value = ""; ctaTexte.value = ""; ctaLien.value = "";
        majApercu();
        window.saToast("Message envoyé.");
        // L'historique est rendu côté serveur : on recharge pour l'afficher.
        setTimeout(function () { location.reload(); }, 900);
      })
      .catch(function (e) {
        bouton.disabled = false;
        window.saToast(e.message || "Envoi impossible.", "err");
      });
  });

  document.querySelectorAll(".js-del").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var ok = await window.confirmModal(
        "Supprimer ce message ?",
        "Il disparaîtra aussi des tableaux de bord où il n'a pas encore été lu.",
        { confirmLabel: "Supprimer", danger: true },
      );
      if (!ok) return;
      fetch("/superadmin/messages/" + btn.dataset.id, { method: "DELETE" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.success) throw new Error(d.error || "échec");
          var ligne = document.querySelector('.sa-histo[data-id="' + btn.dataset.id + '"]');
          if (ligne) ligne.remove();
          window.saToast("Message supprimé.");
        })
        .catch(function () { window.saToast("Suppression impossible.", "err"); });
    });
  });
})();
