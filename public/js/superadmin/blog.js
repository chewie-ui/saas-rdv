/* Page superadmin « Blog » : publier / dépublier, dupliquer, supprimer. */
(function () {
  "use strict";

  document.querySelectorAll("#formFiltres [data-auto]").forEach(function (sel) {
    sel.addEventListener("change", function () { sel.form.submit(); });
  });

  function api(url, options) {
    return fetch(url, options).then(function (r) { return r.json(); });
  }

  function basculerStatut(tr) {
    var vaPublier = tr.dataset.status !== "published";
    api("/superadmin/blog/" + tr.dataset.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: vaPublier ? "published" : "draft" }),
    })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || "échec");
        window.saToast(vaPublier ? "Article publié." : "Article dépublié.");
        location.reload();
      })
      .catch(function (e) { window.saToast(e.message || "Action impossible.", "err"); });
  }

  function dupliquer(tr) {
    api("/superadmin/blog/" + tr.dataset.id + "/dupliquer", { method: "POST" })
      .then(function (d) {
        if (!d.success) throw new Error(d.error || "échec");
        // On ouvre directement la copie : dupliquer sert toujours à repartir
        // d'un article existant pour en écrire un nouveau.
        location.href = "/superadmin/blog/" + d.id;
      })
      .catch(function (e) { window.saToast(e.message || "Duplication impossible.", "err"); });
  }

  function supprimer(tr) {
    var titre = tr.dataset.title || "cet article";
    var enLigne = tr.dataset.status === "published";
    window
      .confirmModal(
        "Supprimer « " + titre + " » ?",
        "L'article sera définitivement supprimé." +
          (enLigne ? " Il est actuellement en ligne : son adresse renverra une page introuvable." : ""),
        { confirmLabel: "Supprimer", danger: true }
      )
      .then(function (ok) {
        if (!ok) return;
        api("/superadmin/blog/" + tr.dataset.id, { method: "DELETE" })
          .then(function (d) {
            if (!d.success) throw new Error(d.error || "échec");
            tr.remove();
            window.saToast("Article supprimé.");
          })
          .catch(function (e) { window.saToast(e.message || "Suppression impossible.", "err"); });
      });
  }

  document.querySelectorAll(".sa-table tbody tr").forEach(function (tr) {
    tr.querySelectorAll("[data-act]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var act = btn.dataset.act;
        if (act === "statut") basculerStatut(tr);
        else if (act === "dupliquer") dupliquer(tr);
        else if (act === "supprimer") supprimer(tr);
      });
    });
  });
})();
