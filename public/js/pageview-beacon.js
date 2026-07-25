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
          // La query string porte les `utm_*` et le `gclid` : sans elle, un
          // clic Google Ads est indiscernable d'une visite directe.
          query: window.location.search || "",
          referrer: document.referrer || "",
        }),
      }).catch(function () {});
    } catch (_) {
      // Le tracking ne doit jamais casser la page.
    }
  }, 800);
})();
