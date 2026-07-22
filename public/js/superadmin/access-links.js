/* Page superadmin « Liens d'accès » : génération, activation, copie de l'URL,
   détail des activations, suppression. */
(function () {
  "use strict";

  // L'URL est construite côté client : en local on veut le lien local, en
  // production le lien branshee.com — sans dupliquer la valeur côté serveur.
  var BASE = location.origin;
  document.querySelectorAll(".js-url").forEach(function (el) {
    el.textContent = BASE + "/access/" + el.dataset.code;
  });

  var modal = document.getElementById("modalNouveau");
  document.getElementById("btnNouveau").addEventListener("click", function () {
    modal.classList.add("is-open");
    setTimeout(function () { document.getElementById("newLabel").focus(); }, 40);
  });
  document.querySelectorAll("[data-fermer]").forEach(function (el) {
    el.addEventListener("click", function () { modal.classList.remove("is-open"); });
  });

  document.getElementById("btnCreer").addEventListener("click", function () {
    var bouton = this;
    bouton.disabled = true;
    fetch("/superadmin/access-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: document.getElementById("newLabel").value.trim(),
        plan: document.getElementById("newPlan").value,
        durationDays: document.getElementById("newDuration").value,
        maxUses: document.getElementById("newMaxUses").value,
        expiresAt: document.getElementById("newExpiresAt").value,
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        bouton.disabled = false;
        if (!d.success) throw new Error(d.error || "échec");
        window.saToast("Lien généré.");
        setTimeout(function () { location.reload(); }, 700);
      })
      .catch(function (e) {
        bouton.disabled = false;
        window.saToast(e.message || "Génération impossible.", "err");
      });
  });

  document.querySelectorAll(".js-actif").forEach(function (cb) {
    cb.addEventListener("change", function () {
      fetch("/superadmin/access-links/" + cb.dataset.id + "/toggle", { method: "PATCH" })
        .then(function (r) { return r.json(); })
        .then(function () { window.saToast(cb.checked ? "Lien activé." : "Lien désactivé."); })
        .catch(function () {
          cb.checked = !cb.checked;
          window.saToast("Changement impossible.", "err");
        });
    });
  });

  document.querySelectorAll(".js-copier").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      try {
        await navigator.clipboard.writeText(BASE + "/access/" + btn.dataset.code);
        window.saToast("Lien copié.");
      } catch (e) { window.saToast("Copie impossible.", "err"); }
    });
  });

  document.querySelectorAll(".js-detail").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var ligne = document.getElementById("detail-" + btn.dataset.id);
      var ouvert = ligne.style.display !== "none";
      ligne.style.display = ouvert ? "none" : "";
      btn.querySelector(".material-symbols-outlined").textContent = ouvert ? "expand_more" : "expand_less";
    });
  });

  document.querySelectorAll(".js-suppr").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var ok = await window.confirmModal(
        "Supprimer ce lien d'accès ?",
        "Le lien cessera de fonctionner. Les accès déjà accordés restent valables jusqu'à leur terme.",
        { confirmLabel: "Supprimer", danger: true },
      );
      if (!ok) return;
      fetch("/superadmin/access-links/" + btn.dataset.id, { method: "DELETE" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.success) throw new Error(d.error || "échec");
          var tr = btn.closest("tr");
          var detail = document.getElementById("detail-" + btn.dataset.id);
          if (detail) detail.remove();
          tr.remove();
          window.saToast("Lien supprimé.");
        })
        .catch(function () { window.saToast("Suppression impossible.", "err"); });
    });
  });
})();
