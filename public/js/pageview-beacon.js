(function () {
  // Petit délai : un vrai visiteur reste au moins un instant sur la page,
  // contrairement à un script qui télécharge le HTML et repart immédiatement
  // sans jamais exécuter ce fichier JS.
  setTimeout(function () {
    try {
      fetch("/api/track-view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          path: window.location.pathname,
          referrer: document.referrer || "",
        }),
      }).catch(function () {});
    } catch (_) {
      // Le tracking ne doit jamais casser la page.
    }
  }, 800);
})();
