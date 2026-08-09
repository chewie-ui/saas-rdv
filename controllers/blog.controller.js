const Article = require("../db/models/article.model");
const { sanitizeArticleHtml, extraitDepuisHtml } = require("../utils/sanitizeArticleHtml");

const PAR_PAGE_ADMIN = 20;
const PAR_PAGE_PUBLIC = 9;

/* ══════════════════════════════════════════════════════════════════════════
   SUPERADMIN
   ══════════════════════════════════════════════════════════════════════════ */

exports.adminListPage = async (req, res) => {
  try {
    const filtres = {
      search: (req.query.search || "").trim(),
      statut: req.query.statut || "tous", // tous | draft | published
    };

    const critere = {};
    if (filtres.statut === "draft" || filtres.statut === "published") critere.status = filtres.statut;
    if (filtres.search) {
      const rx = new RegExp(filtres.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      critere.$or = [{ title: rx }, { slug: rx }, { category: rx }];
    }

    const [articles, brouillons, publies, vuesTotal] = await Promise.all([
      Article.find(critere).sort({ updatedAt: -1 }).limit(PAR_PAGE_ADMIN * 5).lean(),
      Article.countDocuments({ status: "draft" }),
      Article.countDocuments({ status: "published" }),
      Article.aggregate([{ $group: { _id: null, total: { $sum: "$views" } } }]),
    ]);

    const pages = Math.max(1, Math.ceil(articles.length / PAR_PAGE_ADMIN));
    const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);

    res.render("superadmin/blog", {
      saPage: "blog",
      pageName: "Blog",
      articles: articles.slice((page - 1) * PAR_PAGE_ADMIN, page * PAR_PAGE_ADMIN),
      resultats: articles.length,
      page,
      pages,
      filtres,
      kpis: {
        total: brouillons + publies,
        brouillons,
        publies,
        vues: (vuesTotal[0] && vuesTotal[0].total) || 0,
      },
    });
  } catch (err) {
    console.error("blog adminListPage error:", err);
    res.status(500).send("Erreur serveur.");
  }
};

exports.adminEditorPage = async (req, res) => {
  try {
    let article = null;
    if (req.params.id && req.params.id !== "nouveau") {
      article = await Article.findById(req.params.id).lean();
      if (!article) return res.redirect("/superadmin/blog");
    }
    // Catégories déjà utilisées → proposées en autocomplétion, pour éviter
    // « Astuces » et « astuces » qui feraient deux rubriques distinctes.
    const categories = (await Article.distinct("category")).filter(Boolean).sort();

    res.render("superadmin/blog-editor", {
      saPage: "blog",
      pageName: article ? "Modifier l'article" : "Nouvel article",
      article,
      categories,
    });
  } catch (err) {
    console.error("blog adminEditorPage error:", err);
    res.status(500).send("Erreur serveur.");
  }
};

// Champs communs à la création et à la mise à jour.
async function appliquerChamps(article, corps, estNouveau) {
  if (corps.title !== undefined) article.title = String(corps.title).trim().slice(0, 200);
  if (corps.excerpt !== undefined) article.excerpt = String(corps.excerpt).trim().slice(0, 400);
  if (corps.category !== undefined) article.category = String(corps.category).trim().slice(0, 60);
  if (corps.coverImage !== undefined) article.coverImage = String(corps.coverImage).trim();
  if (corps.authorName !== undefined) article.authorName = String(corps.authorName).trim().slice(0, 80);
  if (corps.contentHtml !== undefined) article.contentHtml = sanitizeArticleHtml(corps.contentHtml);

  if (corps.metaTitle !== undefined) article.seo.metaTitle = String(corps.metaTitle).trim().slice(0, 120);
  if (corps.metaDescription !== undefined) {
    article.seo.metaDescription = String(corps.metaDescription).trim().slice(0, 320);
  }

  if (!article.title) article.title = "Article sans titre";
  // Un chapeau vide est comblé automatiquement : il sert de description meta,
  // donc le laisser vide coûterait cher en référencement.
  if (!article.excerpt && article.contentHtml) article.excerpt = extraitDepuisHtml(article.contentHtml, 180);

  // Le slug d'un article DÉJÀ publié ne bouge plus tout seul : le changer
  // casserait les liens partagés et l'indexation. On ne le régénère donc
  // que pour un brouillon, ou si le superadmin le saisit explicitement.
  const slugDemande = corps.slug !== undefined ? Article.slugify(corps.slug) : "";
  if (slugDemande) {
    article.slug = await Article.slugLibre(slugDemande, article._id);
  } else if (estNouveau || (article.status === "draft" && corps.title !== undefined)) {
    article.slug = await Article.slugLibre(article.title, article._id);
  }

  if (corps.status === "draft" || corps.status === "published") article.status = corps.status;
  return article;
}

exports.create = async (req, res) => {
  try {
    const article = new Article({ seo: {} });
    await appliquerChamps(article, req.body || {}, true);
    await article.save();
    res.json({ success: true, id: String(article._id), slug: article.slug });
  } catch (err) {
    console.error("blog create error:", err);
    res.status(500).json({ error: "Enregistrement impossible." });
  }
};

exports.update = async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) return res.status(404).json({ error: "Article introuvable." });
    if (!article.seo) article.seo = {};
    await appliquerChamps(article, req.body || {}, false);
    await article.save();
    res.json({
      success: true,
      id: String(article._id),
      slug: article.slug,
      status: article.status,
      publishedAt: article.publishedAt,
      readingMinutes: article.readingMinutes,
    });
  } catch (err) {
    console.error("blog update error:", err);
    res.status(500).json({ error: "Enregistrement impossible." });
  }
};

exports.remove = async (req, res) => {
  try {
    const supprime = await Article.findByIdAndDelete(req.params.id);
    if (!supprime) return res.status(404).json({ error: "Article introuvable." });
    res.json({ success: true });
  } catch (err) {
    console.error("blog remove error:", err);
    res.status(500).json({ error: "Suppression impossible." });
  }
};

exports.duplicate = async (req, res) => {
  try {
    const src = await Article.findById(req.params.id).lean();
    if (!src) return res.status(404).json({ error: "Article introuvable." });
    const copie = new Article({
      title: src.title + " (copie)",
      slug: await Article.slugLibre(src.title + " copie"),
      excerpt: src.excerpt,
      coverImage: src.coverImage,
      contentHtml: src.contentHtml,
      category: src.category,
      tags: src.tags,
      authorName: src.authorName,
      seo: { metaTitle: "", metaDescription: src.seo ? src.seo.metaDescription : "" },
      status: "draft", // une copie ne part jamais en ligne toute seule
    });
    await copie.save();
    res.json({ success: true, id: String(copie._id) });
  } catch (err) {
    console.error("blog duplicate error:", err);
    res.status(500).json({ error: "Duplication impossible." });
  }
};

// Upload d'une image (couverture ou illustration dans le corps de l'article).
// multer + processSingleImage ont déjà validé et converti le fichier en JPEG.
exports.uploadImage = (req, res) => {
  if (!req.file || !req.file.filename) {
    return res.status(400).json({ error: "Aucune image reçue." });
  }
  res.json({ success: true, url: `/uploads/profiles/${req.file.filename}` });
};

/* ══════════════════════════════════════════════════════════════════════════
   PUBLIC
   ══════════════════════════════════════════════════════════════════════════ */

const BASE = "https://www.branshee.com";

exports.blogIndex = async (req, res) => {
  try {
    const categorie = (req.query.categorie || "").trim();
    const critere = { status: "published" };
    if (categorie) critere.category = categorie;

    const [articles, categories, total] = await Promise.all([
      Article.find(critere)
        .sort({ publishedAt: -1 })
        .select("title slug excerpt coverImage category publishedAt readingMinutes")
        .lean(),
      Article.distinct("category", { status: "published" }),
      Article.countDocuments({ status: "published" }),
    ]);

    const pages = Math.max(1, Math.ceil(articles.length / PAR_PAGE_PUBLIC));
    const page = Math.min(Math.max(1, parseInt(req.query.page, 10) || 1), pages);

    res.render("public/blog", {
      pageName: "Blog",
      title: "Blog BranShee — conseils pour gérer vos rendez-vous",
      metaDescription:
        "Conseils pratiques pour les indépendants : réduire les rendez-vous manqués, remplir son agenda, se faire connaître en ligne et gagner du temps au quotidien.",
      canonical: BASE + "/blog" + (categorie ? "?categorie=" + encodeURIComponent(categorie) : ""),
      articles: articles.slice((page - 1) * PAR_PAGE_PUBLIC, page * PAR_PAGE_PUBLIC),
      categories: categories.filter(Boolean).sort(),
      categorieActive: categorie,
      page,
      pages,
      total,
    });
  } catch (err) {
    console.error("blogIndex error:", err);
    res.status(500).render("client/404");
  }
};

/**
 * Coupe l'article en deux pour glisser un appel à l'action au milieu.
 *
 * Le seul CTA se trouvait tout en bas : sur un article de dix minutes, la
 * majorité des lecteurs ne l'atteint jamais. On en insère donc un second au
 * niveau du `<h2>` le plus proche du milieu du texte — jamais en plein
 * paragraphe, ce qui casserait la lecture.
 *
 * Article court (moins de trois sections) : on ne coupe rien, deux encarts
 * sur trois écrans de texte relèveraient du harcèlement.
 */
function couperPourCta(html) {
  const contenu = String(html || "");
  const titres = [...contenu.matchAll(/<h2[\s>]/gi)].map((m) => m.index);
  if (titres.length < 3 || contenu.length < 2500) return { avant: contenu, apres: "" };

  const milieu = contenu.length / 2;
  // Premier <h2> passé le milieu, sinon le dernier disponible.
  const coupe = titres.find((i) => i >= milieu) ?? titres[titres.length - 1];
  // Ne pas couper juste avant la conclusion : le CTA de bas de page suffit.
  if (coupe === titres[titres.length - 1] && titres.length > 3) {
    return { avant: contenu, apres: "" };
  }
  return { avant: contenu.slice(0, coupe), apres: contenu.slice(coupe) };
}

exports.couperPourCta = couperPourCta;

exports.blogArticle = async (req, res, next) => {
  try {
    const article = await Article.findOne({ slug: req.params.slug, status: "published" }).lean();
    // Pas d'article publié à ce slug → on laisse la main aux routes suivantes
    // (404 propre), plutôt que de rendre une page vide.
    if (!article) return next();

    // Compteur de lectures : hors chemin critique, un échec ne doit pas
    // empêcher l'affichage de la page.
    Article.updateOne({ _id: article._id }, { $inc: { views: 1 } }).catch(() => {});

    // « À lire aussi » : la même rubrique d'abord, puis on complète avec les
    // articles les plus récents. Sans ce complément, la section resterait vide
    // tant qu'une rubrique n'a pas plusieurs articles — c'est-à-dire longtemps.
    const CHAMPS = "title slug excerpt coverImage category publishedAt readingMinutes";
    const dejaVus = [article._id];
    let relies = [];
    if (article.category) {
      relies = await Article.find({
        status: "published",
        _id: { $nin: dejaVus },
        category: article.category,
      })
        .sort({ publishedAt: -1 })
        .limit(3)
        .select(CHAMPS)
        .lean();
      relies.forEach((r) => dejaVus.push(r._id));
    }
    if (relies.length < 3) {
      const complement = await Article.find({ status: "published", _id: { $nin: dejaVus } })
        .sort({ publishedAt: -1 })
        .limit(3 - relies.length)
        .select(CHAMPS)
        .lean();
      relies = relies.concat(complement);
    }

    const seo = article.seo || {};
    const morceaux = couperPourCta(article.contentHtml);
    res.render("public/blog-article", {
      pageName: "Blog",
      article,
      corpsAvant: morceaux.avant,
      corpsApres: morceaux.apres,
      relies,
      title: (seo.metaTitle || article.title) + " — BranShee",
      metaDescription: seo.metaDescription || article.excerpt || "",
      ogImage: article.coverImage ? BASE + article.coverImage : undefined,
      ogType: "article",
      canonical: BASE + "/blog/" + article.slug,
    });
  } catch (err) {
    console.error("blogArticle error:", err);
    next(err);
  }
};

/** Articles publiés, pour le sitemap. */
exports.articlesPourSitemap = function () {
  return Article.find({ status: "published" })
    .select("slug updatedAt publishedAt")
    .sort({ publishedAt: -1 })
    .lean();
};
