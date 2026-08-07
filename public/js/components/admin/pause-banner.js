/**
 * Bandeau « établissement en pause » — bouton Réactiver.
 *
 * La réactivation existait déjà dans Paramètres, mais un pro dont la fiche
 * avait été mise en pause n'avait aucune raison d'aller la chercher : il
 * constatait juste qu'il n'avait plus de réservation. Le bandeau l'annonce sur
 * toutes les pages de l'admin, et le geste se fait d'ici.
 */
(function () {
  const btn = document.getElementById("pausebnResume");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const libelle = btn.textContent;
    btn.textContent = "Réactivation…";
    try {
      const res = await fetch("/account/company-resume", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (data.success) {
        // Rechargement plutôt que masquage du bandeau : d'autres éléments de
        // la page dépendent de l'état en pause (page publique, réservations).
        window.location.reload();
        return;
      }
      btn.textContent = libelle;
      btn.disabled = false;
      if (typeof window.confirmModal === "function") {
        window.confirmModal("Réactivation impossible", data.error || "Réessayez dans un instant.", { alertOnly: true });
      } else {
        window.alert(data.error || "Réactivation impossible.");
      }
    } catch (e) {
      btn.textContent = libelle;
      btn.disabled = false;
      window.alert("Erreur réseau. Réessayez.");
    }
  });
})();
