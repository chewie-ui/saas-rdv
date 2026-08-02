const cheerio = require("cheerio");

/**
 * Nettoie le HTML d'un article avant enregistrement.
 *
 * Seul le superadmin écrit ces articles, donc il n'y a pas d'attaquant à
 * proprement parler — mais le contenu est rendu tel quel sur une page
 * publique. Coller du texte depuis Word ou une page web amène des <script>,
 * des styles inline et des balises inutiles ; une liste blanche garantit que
 * la page publique reste propre, légère et sûre quoi qu'on colle.
 */

const BALISES = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s",
  "h2", "h3", "h4",
  "ul", "ol", "li",
  "blockquote", "figure", "figcaption",
  "a", "img", "hr",
  "code", "pre",
  "table", "thead", "tbody", "tr", "th", "td",
]);

// Attributs autorisés, par balise.
const ATTRS = {
  a: ["href", "title", "target", "rel"],
  img: ["src", "alt", "width", "height", "loading"],
};

// Un href ne doit jamais pouvoir exécuter du code (javascript:, data:…).
function hrefSur(valeur) {
  const v = String(valeur || "").trim();
  if (!v) return "";
  if (/^(https?:|mailto:|tel:|#|\/)/i.test(v)) return v;
  return "";
}
// Les images viennent soit de nos uploads, soit d'une URL https.
function srcSur(valeur) {
  const v = String(valeur || "").trim();
  if (!v) return "";
  if (/^(https?:)?\/\//i.test(v) || v.startsWith("/")) return v;
  return "";
}

// Balises de bloc : sert à décider si un <div> peut devenir un paragraphe.
const BLOCS = new Set([
  "p", "h2", "h3", "h4", "ul", "ol", "blockquote",
  "figure", "table", "pre", "hr", "div",
]);

function sanitizeArticleHtml(html) {
  if (!html) return "";
  const $ = cheerio.load(String(html), null, false);

  // On retire d'abord ce qui ne doit jamais survivre, contenu compris.
  $("script, style, iframe, object, embed, form, input, button, noscript").remove();

  // Dans un contenteditable, appuyer sur Entrée crée un <div> par ligne.
  // Le supprimer purement et simplement collerait tous les paragraphes les uns
  // aux autres : on le convertit en <p> quand il ne contient que de l'inline.
  $("div").each(function () {
    const el = $(this);
    const contientUnBloc = el.children().toArray().some((c) => BLOCS.has((c.tagName || "").toLowerCase()));
    if (!contientUnBloc) this.tagName = "p";
  });

  $("*").each(function () {
    const el = $(this);
    const tag = (this.tagName || "").toLowerCase();

    if (!BALISES.has(tag)) {
      // Balise inconnue (div, span, font, o:p de Word…) : on la remplace par
      // son contenu au lieu de le supprimer — le texte est ce qui compte.
      el.replaceWith(el.contents());
      return;
    }

    const autorises = ATTRS[tag] || [];
    for (const nom of Object.keys(this.attribs || {})) {
      if (!autorises.includes(nom)) el.removeAttr(nom);
    }

    if (tag === "a") {
      const href = hrefSur(el.attr("href"));
      if (!href) { el.replaceWith(el.contents()); return; }
      el.attr("href", href);
      // Lien externe → nouvelle fenêtre, et rel de sécurité.
      if (/^https?:/i.test(href) && !href.includes("branshee.com")) {
        el.attr("target", "_blank");
        el.attr("rel", "noopener noreferrer");
      } else {
        el.removeAttr("target");
        el.removeAttr("rel");
      }
    }

    if (tag === "img") {
      const src = srcSur(el.attr("src"));
      if (!src) { el.remove(); return; }
      el.attr("src", src);
      el.attr("loading", "lazy");
      if (!el.attr("alt")) el.attr("alt", "");
    }
  });

  // La toute première ligne saisie dans un contenteditable reste un nœud texte
  // nu à la racine (« Premier paragraphe.<div>Deuxième…</div> »), tout comme le
  // contenu d'une balise dépliée. On emballe ces suites d'inline dans un <p>,
  // sinon la page publique les collerait au bloc suivant.
  //
  // On RECONSTRUIT la chaîne au lieu de déplacer les nœuds : cheerio ignore
  // silencieusement un .before() posé sur un nœud texte, ce qui les perdait.
  const morceaux = [];
  let tampon = "";
  const viderTampon = () => {
    // Un tampon qui ne contient que des <br> ou des espaces n'a rien à dire.
    if (tampon.replace(/<br\s*\/?>/gi, "").replace(/&nbsp;/g, " ").trim()) {
      morceaux.push("<p>" + tampon.trim() + "</p>");
    }
    tampon = "";
  };
  $.root()
    .contents()
    .each(function () {
      const estBloc = this.type === "tag" && BLOCS.has((this.tagName || "").toLowerCase());
      if (estBloc) {
        viderTampon();
        morceaux.push($.html(this));
      } else {
        tampon += $.html(this);
      }
    });
  viderTampon();

  return morceaux.join("").trim();
}

/** Extrait un chapeau lisible depuis le corps de l'article. */
function extraitDepuisHtml(html, longueur = 160) {
  const texte = String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (texte.length <= longueur) return texte;
  return texte.slice(0, longueur).replace(/\s+\S*$/, "") + "…";
}

module.exports = { sanitizeArticleHtml, extraitDepuisHtml };
