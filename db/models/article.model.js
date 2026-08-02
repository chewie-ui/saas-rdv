const mongoose = require("mongoose");

/**
 * Article de blog — contenu éditorial public, écrit depuis le superadmin.
 *
 * But : ouvrir des portes d'entrée SEO que la page d'accueil ne peut pas
 * viser (« comment réduire les no-show », « agenda en ligne pour kiné »…).
 * Rien à voir avec SupportContent, qui est le centre d'aide interne.
 */

// "Réduire les no-show : 5 astuces" → "reduire-les-no-show-5-astuces"
function slugify(texte) {
  return String(texte || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/['’]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

// Temps de lecture affiché sous le titre. ~200 mots/minute, minimum 1.
function tempsDeLecture(html) {
  const texte = String(html || "").replace(/<[^>]*>/g, " ");
  const mots = texte.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(mots / 200));
}

const articleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    // Sert d'URL publique : /blog/<slug>. Unique, mais on laisse la
    // possibilité de le corriger à la main tant que l'article est en
    // brouillon (changer le slug d'un article publié casse ses liens).
    slug: { type: String, required: true, unique: true, index: true, trim: true },

    // Chapeau : résumé affiché dans la liste ET utilisé comme description
    // meta par défaut si le champ SEO est laissé vide.
    excerpt: { type: String, default: "", trim: true },
    coverImage: { type: String, default: "" },
    contentHtml: { type: String, default: "" },

    category: { type: String, default: "", trim: true },
    tags: { type: [String], default: [] },

    status: { type: String, enum: ["draft", "published"], default: "draft", index: true },
    // Date affichée et utilisée pour le tri. Renseignée à la première
    // publication, puis conservée (dépublier ne doit pas l'effacer, sinon
    // republier ferait remonter l'article comme s'il était neuf).
    publishedAt: { type: Date, default: null },

    seo: {
      metaTitle: { type: String, default: "", trim: true },
      metaDescription: { type: String, default: "", trim: true },
    },

    authorName: { type: String, default: "L'équipe BranShee", trim: true },
    readingMinutes: { type: Number, default: 1 },
    views: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Tri de la liste publique et du sitemap.
articleSchema.index({ status: 1, publishedAt: -1 });
// Recherche plein texte dans le superadmin.
articleSchema.index({ title: "text", excerpt: "text" });

// Hook synchrone (sans `next`) : Mongoose l'attend ainsi ici, et il n'y a
// aucune opération asynchrone à faire.
articleSchema.pre("save", function () {
  if (!this.slug) this.slug = slugify(this.title);
  this.readingMinutes = tempsDeLecture(this.contentHtml);
  if (this.status === "published" && !this.publishedAt) this.publishedAt = new Date();
});

articleSchema.statics.slugify = slugify;
articleSchema.statics.tempsDeLecture = tempsDeLecture;

/**
 * Trouve un slug libre à partir d'un titre : « mon-article », puis
 * « mon-article-2 », « mon-article-3 »… `ignorerId` permet de ne pas
 * entrer en collision avec l'article qu'on est en train de modifier.
 */
articleSchema.statics.slugLibre = async function (base, ignorerId) {
  const racine = slugify(base) || "article";
  let candidat = racine;
  for (let i = 2; i < 200; i++) {
    const critere = { slug: candidat };
    if (ignorerId) critere._id = { $ne: ignorerId };
    const existe = await this.exists(critere);
    if (!existe) return candidat;
    candidat = racine + "-" + i;
  }
  return racine + "-" + Date.now();
};

module.exports = mongoose.model("Article", articleSchema);
