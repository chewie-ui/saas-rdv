// Service worker BranShee — volontairement MINIMAL.
//
// Il n'existe que pour rendre le site installable : Chrome n'affiche la
// proposition d'installation que si un service worker avec un gestionnaire
// `fetch` est enregistré.
//
// Il ne met RIEN en cache, et c'est un choix délibéré. Un service worker qui
// sert des pages ou des CSS depuis un cache continue de le faire longtemps
// après un déploiement : l'utilisateur reste bloqué sur une version périmée du
// site, sans aucun moyen simple de s'en sortir. Le hors-ligne n'est pas
// l'objectif ici — l'installation l'est.
//
// Si un jour on veut vraiment du hors-ligne, il faudra versionner les fichiers
// statiques (hash dans le nom) AVANT de les mettre en cache.

const VERSION = "branshee-v1";

self.addEventListener("install", () => {
  // Prend la main immédiatement : pas de version en attente derrière un onglet
  // resté ouvert, donc pas de décalage entre ce qui est déployé et ce qui tourne.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Filet de sécurité : purge tout cache qu'une version future aurait
      // laissé derrière elle.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  // Aucun `respondWith` : la requête suit le chemin réseau normal du
  // navigateur. Le gestionnaire est présent uniquement pour l'installabilité.
  if (event.request.method !== "GET") return;
});
