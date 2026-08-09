/**
 * Signale une URL nouvelle ou modifiée aux moteurs, via IndexNow.
 *
 * À quoi ça sert, honnêtement : IndexNow est utilisé par Bing, Yandex, Seznam
 * et quelques autres. **Google ne s'en sert pas.** Pour Google, ce qui marche
 * reste le sitemap, les liens internes, et « Demander l'indexation » dans la
 * Search Console.
 *
 * On le branche quand même parce que c'est gratuit, instantané, et que Bing
 * alimente aussi les réponses de plusieurs assistants. Ce qui ne se voit pas
 * dans Google se voit ailleurs.
 *
 * L'appel est volontairement silencieux et non bloquant : publier un article
 * ne doit jamais échouer parce qu'un moteur tiers est indisponible.
 */

const HOTE = "www.branshee.com";
const BASE = "https://" + HOTE;

/**
 * Clé de vérification. IndexNow exige qu'elle soit lisible à
 * https://<hôte>/<clé>.txt — la route est servie dans routes/index.js.
 *
 * Elle est en clair ici, et c'est normal : le protocole la publie lui-même à
 * une adresse publique. Ce n'est pas un secret, c'est un identifiant. La
 * dériver d'un vrai secret (SESSION_SECRET) reviendrait à exposer une valeur
 * calculée à partir de lui, sans aucun bénéfice.
 *
 * Elle doit en revanche rester STABLE : la changer invalide le fichier déjà
 * connu des moteurs et fait rejeter toutes les notifications.
 */
const CLE_PUBLIQUE = "b7f3a91c4e2d84605fa1c9d3e8b26074";

function cle() {
  return process.env.INDEXNOW_KEY || CLE_PUBLIQUE;
}

/**
 * Notifie les moteurs. `urls` : chemins absolus du site ("/blog/mon-article")
 * ou URL complètes. Ne renvoie jamais d'erreur.
 */
async function signaler(urls) {
  const k = cle();
  // En développement, signaler des URL de production n'a aucun sens et
  // polluerait la file d'attente des moteurs avec des pages qu'on n'a pas
  // encore déployées.
  if (process.env.NODE_ENV !== "production") {
    return { envoye: false, motif: "hors production, notification ignorée" };
  }

  const liste = (Array.isArray(urls) ? urls : [urls])
    .filter(Boolean)
    .map((u) => (String(u).startsWith("http") ? String(u) : BASE + String(u)))
    // IndexNow rejette le lot entier si une seule URL sort du domaine déclaré.
    .filter((u) => u.startsWith(BASE));

  if (!liste.length) return { envoye: false, motif: "aucune URL valide" };

  try {
    const rep = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: HOTE,
        key: k,
        keyLocation: `${BASE}/${k}.txt`,
        urlList: liste,
      }),
    });
    // 200 et 202 valent acceptation ; 422 signale une clé non vérifiable.
    return { envoye: rep.ok, statut: rep.status, nb: liste.length };
  } catch (err) {
    return { envoye: false, motif: err.message };
  }
}

module.exports = { signaler, cle, HOTE, BASE };
