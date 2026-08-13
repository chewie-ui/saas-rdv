/**
 * Adresse → coordonnées, via Nominatim (OpenStreetMap).
 *
 * Les pros saisissent leur adresse dans un champ avec autocomplétion : quand
 * ils choisissent une suggestion, lat/lon sont remplis. Quand ils tapent leur
 * adresse à la main sans cliquer — ce que fait la majorité — l'adresse est
 * enregistrée SANS coordonnées. Résultat : le tri « autour de moi » et la
 * distance affichée ne fonctionnent que pour ceux qui ont cliqué au bon
 * endroit.
 *
 * Ce module rattrape ces adresses côté SERVEUR. Volontairement côté serveur :
 * un navigateur ne peut pas fixer son `User-Agent`, or la politique d'usage de
 * Nominatim l'exige et bloque les clients qui ne s'identifient pas.
 *
 * Gratuit, sans clé, mais avec des règles à respecter :
 *   • une requête par seconde maximum ;
 *   • un User-Agent identifiant l'application et un contact ;
 *   • pas de rafales massives — d'où l'attente intégrée ci-dessous.
 */

const CONTACT = process.env.SUPPORT_EMAIL || process.env.ADMIN_EMAIL || "info@branshee.com";
const UA = `BranShee/1.0 (+https://www.branshee.com; ${CONTACT})`;
const BASE = "https://nominatim.openstreetmap.org/search";

// Nominatim impose 1 req/s. On sérialise les appels plutôt que de compter sur
// l'appelant : un oubli côté script ferait bannir l'adresse IP du serveur.
let dernierAppel = 0;
async function attendreLeTour() {
  const ecoule = Date.now() - dernierAppel;
  if (ecoule < 1100) await new Promise((r) => setTimeout(r, 1100 - ecoule));
  dernierAppel = Date.now();
}

/** Compose la chaîne à géocoder depuis un objet `location`. */
function adresseDe(location) {
  if (!location) return "";
  return [location.address, location.zip, location.city, location.country]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean)
    .join(", ");
}

/**
 * Renvoie { lat, lon, precision } ou null si l'adresse est introuvable.
 * Ne lève jamais : un échec de géocodage ne doit pas interrompre un
 * enregistrement d'adresse ni un script de rattrapage.
 */
async function geocoder(adresse, { pays } = {}) {
  const q = String(adresse || "").trim();
  if (q.length < 4) return null;

  await attendreLeTour();

  const params = new URLSearchParams({ q, format: "jsonv2", limit: "1", addressdetails: "0" });
  // Restreindre au pays quand on le connaît lève beaucoup d'ambiguïtés
  // (« Rue de la Gare » existe dans des dizaines de communes).
  if (pays) params.set("countrycodes", String(pays).toLowerCase());

  try {
    const rep = await fetch(`${BASE}?${params}`, {
      headers: { "User-Agent": UA, "Accept-Language": "fr" },
    });
    if (!rep.ok) return null;
    const data = await rep.json();
    if (!Array.isArray(data) || !data.length) return null;
    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    // `place_rank` dit à quel point le résultat est précis : une valeur basse
    // correspond à un pays ou une région. Géolocaliser un salon au centre de
    // la Belgique serait pire que de ne rien afficher.
    const rang = Number(data[0].place_rank);
    if (Number.isFinite(rang) && rang < 12) return null;
    return { lat, lon, precision: Number.isFinite(rang) ? rang : null };
  } catch (_) {
    return null;
  }
}

/**
 * Géocode un objet `location`, avec un repli sur la commune.
 *
 * Nominatim est strict sur l'orthographe : « Rue Delloye Mathieu » ne trouve
 * rien là où « Delloye Matthieu » tombe juste. Exiger une saisie parfaite
 * reviendrait à ne géolocaliser personne. Quand l'adresse complète échoue, on
 * retente avec le code postal et la ville seuls : on obtient le centre de la
 * commune — à Huy, 150 m de l'adresse réelle. Pour un tri par distance et une
 * pastille sur une carte, c'est amplement suffisant, et infiniment mieux que
 * de ne pas apparaître du tout.
 *
 * `approximatif` dit lequel des deux a répondu, pour que l'appelant puisse
 * choisir de ne pas afficher « à 300 m » sur une position communale.
 */
async function geocoderLocation(location) {
  if (!location) return null;
  // Le champ `country` contient parfois un nom complet (« Belgique ») là où
  // Nominatim attend un code ISO : on ne le transmet que s'il en a la forme.
  const brut = location.country ? String(location.country).trim() : "";
  const pays = brut.length === 2 ? brut : null;

  const complete = adresseDe(location);
  if (complete) {
    const r = await geocoder(complete, { pays });
    if (r) return { ...r, approximatif: false };
  }

  // Repli 1 : les champs code postal et ville, quand ils sont renseignés.
  // Repli 2 : les mêmes, extraits du texte de l'adresse. Beaucoup de pros
  // saisissent tout dans un seul champ (« Rue X 6, 4500 Huy ») en laissant
  // `city` et `zip` vides — sans cette extraction, ces fiches-là ne sont
  // jamais géolocalisées, alors que ce sont justement les plus nombreuses.
  const candidats = [
    [location.zip, location.city].filter(Boolean).join(" ").trim(),
    communeDepuisTexte(complete),
  ];

  for (const commune of candidats) {
    if (!commune || commune === complete) continue;
    const r = await geocoder(commune, { pays });
    if (r) return { ...r, approximatif: true };
  }

  return null;
}

/**
 * « Rue Delloye Mathieu 6, 4500 Huy » → « 4500 Huy ».
 * Code postal à 4 ou 5 chiffres (Belgique, France) suivi d'un nom de commune,
 * en fin de chaîne ou avant une virgule.
 */
function communeDepuisTexte(texte) {
  const m = String(texte || "").match(/\b(\d{4,5})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\- ]{1,40}?)\s*(?:,|$)/);
  return m ? `${m[1]} ${m[2].trim()}` : "";
}

module.exports = { geocoder, geocoderLocation, adresseDe, UA };
