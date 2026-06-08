/**
 * Mini-sanitiseur HTML "allow-list" pour les zones de texte enrichi générées
 * par nos petits éditeurs WYSIWYG maison (ex : section "À propos").
 *
 * On NE supporte volontairement qu'un tout petit sous-ensemble de balises —
 * largement suffisant pour "mettre en gras / italique / agrandir un mot" —
 * et on retire systématiquement tout ce qui pourrait servir à injecter du
 * code (script, style, gestionnaires d'évènements on*, liens javascript:, …).
 *
 * Ce n'est pas un parseur HTML complet (Node n'a pas de DOMParser natif et on
 * ne veut pas ajouter de dépendance lourde pour un besoin aussi ciblé) — mais
 * en limitant strictement les balises et attributs autorisés, on élimine les
 * vecteurs XSS classiques tout en gardant un rendu propre.
 */

const ALLOWED_TAGS = ["b", "strong", "i", "em", "u", "br", "p", "span", "div", "ul", "ol", "li"];

// Quelques tailles de police "raisonnables" — toute valeur hors de cette
// fourchette est ramenée à la borne la plus proche.
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 32;

function sanitizeFontSizeStyle(styleAttr) {
  if (!styleAttr) return "";
  const m = /font-size\s*:\s*(\d{1,3})\s*px/i.exec(styleAttr);
  if (!m) return "";
  let size = parseInt(m[1], 10);
  if (Number.isNaN(size)) return "";
  size = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
  return `font-size:${size}px`;
}

/**
 * Nettoie un fragment HTML produit par l'éditeur "À propos".
 * @param {string} html
 * @returns {string} fragment HTML sûr (balises hors liste blanche supprimées)
 */
function sanitizeRichText(html) {
  if (!html || typeof html !== "string") return "";

  let out = html;

  // 1. On retire intégralement les blocs dangereux (balise + contenu)
  out = out.replace(/<(script|style|iframe|object|embed|link|meta|form|svg)[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  out = out.replace(/<(script|style|iframe|object|embed|link|meta|form|svg)[^>]*\/?>/gi, "");

  // 2. On capture TOUTE séquence ressemblant à une balise (<…>) — y compris
  //    les balises malformées — et on ne laisse passer QUE celles qui
  //    correspondent strictement à un nom de balise autorisé. Tout le reste
  //    (balises inconnues, malformées, attributs suspects…) est supprimé.
  //    → on évite ainsi qu'une séquence non reconnue par le motif "propre"
  //    ressorte intacte (ce qui serait le cas avec un simple replace ciblé).
  out = out.replace(/<\/?[a-zA-Z!][^>]*>/g, (full) => {
    const closeMatch = /^<\/\s*([a-zA-Z][a-zA-Z0-9]*)\s*>$/.exec(full);
    if (closeMatch) {
      const tag = closeMatch[1].toLowerCase();
      return ALLOWED_TAGS.indexOf(tag) !== -1 ? `</${tag}>` : "";
    }

    const openMatch = /^<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*)?)\/?>$/.exec(full);
    if (openMatch) {
      const tag = openMatch[1].toLowerCase();
      if (ALLOWED_TAGS.indexOf(tag) === -1) return "";

      if (tag === "span" || tag === "div" || tag === "p") {
        const styleMatch = /style\s*=\s*"([^"]*)"/i.exec(openMatch[2] || "");
        const safeStyle = styleMatch ? sanitizeFontSizeStyle(styleMatch[1]) : "";
        return safeStyle ? `<${tag} style="${safeStyle}">` : `<${tag}>`;
      }

      return `<${tag}>`;
    }

    // Toute séquence "<...>" qui ne correspond pas proprement à une balise
    // ouvrante/fermante reconnue est purement et simplement supprimée.
    return "";
  });

  // 3. Retire les entités/échappements résiduels potentiellement gênants
  out = out.replace(/javascript\s*:/gi, "");

  return out.trim();
}

module.exports = { sanitizeRichText };
