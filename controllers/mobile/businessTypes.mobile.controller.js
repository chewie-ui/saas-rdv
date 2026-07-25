// ── API mobile : liste des métiers ────────────────────────────────────────
//   GET /business-types?q=&lang=   → suggestions de métiers
//
// Même source que le site (utils/services.js, 144 métiers en 6 langues) : la
// liste doit rester identique des deux côtés, sinon deux professionnels du même
// métier finiraient avec des libellés différents et la recherche publique
// (/search) ne les regrouperait plus.
const getServices = require("../../utils/services");

const LANGS = ["fr", "en", "nl", "de", "es", "it"];

// Insensible à la casse ET aux accents : « esthe » doit trouver « Esthéticienne ».
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    // Marques diacritiques combinantes, en forme échappée : écrites en clair
    // elles sont invisibles dans l'éditeur et se corrompent au copier-coller.
    .replace(/[̀-ͯ]/g, "");
}

exports.list = async (req, res) => {
  try {
    const lang = LANGS.includes(req.query.lang)
      ? req.query.lang
      : req.mobileUser?.preferredLang && LANGS.includes(req.mobileUser.preferredLang)
        ? req.mobileUser.preferredLang
        : "fr";

    const all = getServices(lang) || [];
    const q = normalize(req.query.q);

    if (!q) {
      // Sans recherche, l'app affiche la liste complète (elle sait la faire
      // défiler) — c'est plus utile qu'un extrait arbitraire.
      return res.json({ lang, count: all.length, businessTypes: all });
    }

    // Les libellés qui COMMENCENT par la saisie d'abord, puis ceux qui la
    // contiennent : taper « ost » doit proposer « Ostéopathe » avant
    // « Chirurgien-dentiste esthétique ».
    const starts = [];
    const contains = [];
    for (const label of all) {
      const n = normalize(label);
      if (n.startsWith(q)) starts.push(label);
      else if (n.includes(q)) contains.push(label);
    }

    const businessTypes = [...starts, ...contains].slice(0, 25);
    res.json({ lang, count: businessTypes.length, businessTypes });
  } catch (err) {
    console.error("[mobile business-types]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
