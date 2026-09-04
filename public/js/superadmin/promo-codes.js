/* Page superadmin « Codes promo » : création, activation, offre par défaut,
   copie du lien d'invitation, suppression. */
(function () {
  "use strict";

  // ── Création ──────────────────────────────────────────────────────────────
  var modal = document.getElementById("modalNouveau");
  var type = document.getElementById("newType");
  var champJours = document.getElementById("champJours");
  var champValeur = document.getElementById("champValeur");

  function majChamps() {
    var essai = type.value === "trial";
    champJours.style.display = essai ? "" : "none";
    champValeur.style.display = essai ? "none" : "";
  }
  type.addEventListener("change", majChamps);
  majChamps();

  document.getElementById("btnNouveau").addEventListener("click", function () {
    modal.classList.add("is-open");
    setTimeout(function () { document.getElementById("newCode").focus(); }, 40);
  });
  document.querySelectorAll("[data-fermer]").forEach(function (el) {
    el.addEventListener("click", function () { modal.classList.remove("is-open"); });
  });

  document.getElementById("btnCreer").addEventListener("click", function () {
    var bouton = this;
    var code = document.getElementById("newCode").value.trim().toUpperCase();
    var discountType = type.value;
    var valeur = document.getElementById("newValue").value;
    if (!code) return window.saToast("Le code est requis.", "err");
    if (discountType !== "trial" && !valeur) return window.saToast("La valeur de la réduction est requise.", "err");

    bouton.disabled = true;
    fetch("/superadmin/promo-codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: code,
        discountType: discountType,
        discountValue: discountType === "trial" ? 0 : valeur,
        trialDays: parseInt(document.getElementById("newTrialDays").value, 10) || 30,
        maxUses: document.getElementById("newMaxUses").value,
        expiresAt: document.getElementById("newExpiresAt").value,
        applicablePlan: document.getElementById("newApplicablePlan").value,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        bouton.disabled = false;
        if (!d.success) throw new Error(d.error || "échec");
        window.saToast("Code créé.");
        setTimeout(function () { location.reload(); }, 700);
      })
      .catch(function (e) {
        bouton.disabled = false;
        window.saToast(e.message || "Création impossible.", "err");
      });
  });

  // ── Actions sur un code ───────────────────────────────────────────────────
  document.querySelectorAll(".js-actif").forEach(function (cb) {
    cb.addEventListener("change", function () {
      fetch("/superadmin/promo-codes/" + cb.dataset.id + "/toggle", { method: "PATCH" })
        .then(function (r) { return r.json(); })
        .then(function () { window.saToast(cb.checked ? "Code activé." : "Code désactivé."); })
        .catch(function () {
          cb.checked = !cb.checked;
          window.saToast("Changement impossible.", "err");
        });
    });
  });

  document.querySelectorAll(".js-copier").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var lien = "https://www.branshee.com/register?promo=" + encodeURIComponent(btn.dataset.code) + "&plan=pro";
      try {
        await navigator.clipboard.writeText(lien);
        window.saToast("Lien d'invitation copié.");
      } catch (e) { window.saToast("Copie impossible.", "err"); }
    });
  });

  // Une seule offre par défaut à la fois : on éteint les autres étoiles.
  document.querySelectorAll(".js-offre").forEach(function (btn) {
    btn.addEventListener("click", function () {
      fetch("/superadmin/promo-codes/" + btn.dataset.id + "/toggle-offer", { method: "PATCH" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.success) throw new Error(d.error || "échec");
          if (d.isDefaultOffer) {
            document.querySelectorAll(".js-offre").forEach(function (autre) { autre.classList.remove("is-on"); });
            btn.classList.add("is-on");
            btn.title = "Retirer de l'offre par défaut";
            window.saToast("Offre par défaut mise à jour.");
          } else {
            btn.classList.remove("is-on");
            btn.title = "Définir comme offre par défaut";
            window.saToast("Offre par défaut retirée.");
          }
        })
        .catch(function () { window.saToast("Changement impossible.", "err"); });
    });
  });

  document.querySelectorAll(".js-suppr").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var ok = await window.confirmModal(
        'Supprimer le code « ' + btn.dataset.code + ' » ?',
        "Les inscriptions déjà réalisées avec ce code ne sont pas affectées.",
        { confirmLabel: "Supprimer", danger: true },
      );
      if (!ok) return;
      fetch("/superadmin/promo-codes/" + btn.dataset.id, { method: "DELETE" })
        .then(function (r) { return r.json(); })
        .then(function () {
          btn.closest("tr").remove();
          window.saToast("Code supprimé.");
        })
        .catch(function () { window.saToast("Suppression impossible.", "err"); });
    });
  });
})();

// ── Campagne de lancement ───────────────────────────────────────────────────
// Formulaire distinct des codes promo : il pilote l'offre automatique annoncée
// sur les pages publiques (bandeau + compte à rebours).
(function () {
  var form = document.getElementById("formCampagne");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = form.querySelector('button[type="submit"]');
    var data = Object.fromEntries(new FormData(form).entries());

    if (btn) btn.disabled = true;
    fetch("/superadmin/promo-campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (btn) btn.disabled = false;
        if (!d.success) throw new Error(d.error || "échec");
        window.saToast("Campagne enregistrée.");
        // Le libellé d'état sous le formulaire est calculé côté serveur : on
        // recharge plutôt que de le réécrire ici en double.
        setTimeout(function () { window.location.reload(); }, 600);
      })
      .catch(function (err) {
        if (btn) btn.disabled = false;
        window.saToast(err.message || "Enregistrement impossible.", "err");
      });
  });
})();
