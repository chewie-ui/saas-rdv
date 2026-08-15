const router = require("express").Router();
const { identityFor } = require("../utils/establishmentIdentity");
const _routeEnv = require(`../environment/${process.env.NODE_ENV || "development"}`);

const { getCompanyIfExist } = require("../controllers/auth.controller");
const User = require("../db/models/user.model");
const Companies = require("../db/models/company/company.model");
const Review = require("../db/models/review.model");
// Sert à savoir si un établissement a déjà reçu un rendez-vous : c'est l'une
// des preuves qu'une fiche est réelle, dans le filtre de /search.
const Booking = require("../db/models/book.model");
// Prix d'appel des cartes de résultats (« dès 22 € ») dans /search.
const Service = require("../db/models/company/service.model");
const pug = require("pug");
const path = require("path");
const { sendEmail } = require("../utils/mailer");
const getServices = require("../utils/services");
const { requireFeatureActive } = require("../middlewares/featureFlag");

router.use(require("./ical"));
router.use(require("./auth"));
router.use(require("./client-auth"));
router.use(require("./company"));
router.use(require("./admin"));
router.use(require("./booking"));
router.use("/api", require("./api"));
router.use("/reviews", require("./reviews"));
router.use("/account", require("./user/account"));
router.use(require("./superadmin"));
router.use(require("./services"));
router.use(require("./employees"));

// Échappe les caractères spéciaux regex — la catégorie/nom/ville viennent de
// l'utilisateur (champ de recherche ou clic sidebar), jamais d'une liste figée
// côté serveur, donc toujours traiter ça comme une regex non fiable.
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Sérialisation publique d'un membre de getBookableTeam() (page de
// réservation + sélecteur d'employé par service). ──────────────────────────
function serializeTeamMember(m) {
  // m.role = "owner" pour le patron, sinon le nom du grade (cf.
  // utils/bookableTeam.js) — affiché tel quel, le patron choisit le libellé
  // de ses grades donc pas besoin de mapping fixe ici.
  const roleLabel = m.role === "owner" ? "Responsable" : m.role || "";
  return {
    _id: String(m.id),
    firstName: m.firstName || "",
    lastName: m.lastName || "",
    profilePicture: m.photo || "/images/no-user.webp",
    description: m.description || "",
    role: m.showRole ? roleLabel : "",
    customInfo: (m.customInfo || []).filter((i) => i.label && i.value),
  };
}

/* ── Catégories dynamiques depuis la base ────────────────────────────────── */
// Ne compte que les utilisateurs ayant RÉELLEMENT un établissement créé (et
// non désactivé) — sinon une inscription jamais terminée (pas de Company,
// cf. injectCompany qui redirige vers /register tant qu'il n'y en a pas)
// fait apparaître une catégorie dans la sidebar qui renvoie ensuite "0
// professionnels trouvés" au clic, puisque /search ne liste que des Companies.
async function getDynamicCategories() {
  const counts = await User.aggregate([
    {
      $match: {
        businessType: { $exists: true, $ne: "" },
        $or: [{ isDisabled: false }, { isDisabled: { $exists: false } }],
      },
    },
    { $lookup: { from: "companies", localField: "_id", foreignField: "owner", as: "company" } },
    { $match: { company: { $elemMatch: { isPaused: { $ne: true } } } } },
    // Regroupe par valeur normalisée (espaces + casse) pour fusionner les
    // doublons type "Développeur freelance" / "développeur freelance " qui
    // apparaissaient sinon comme deux catégories distinctes dans la sidebar.
    { $project: { businessType: 1, _norm: { $toLower: { $trim: { input: "$businessType" } } } } },
    { $group: { _id: "$_norm", name: { $first: "$businessType" }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return counts.map(c => ({ name: (c.name || "").trim(), count: c.count }));
}

/* ── Tri des établissements : Business > Pro > Gratuit, puis par boost, puis par note ── */
function planPriority(plan, isPremium) {
  if (plan === "business")  return 3;
  if (plan === "pro")       return 2;
  if (plan === "essentiel") return 1;
  if (isPremium)            return 1; // premium sans plan précis
  return 0;                           // gratuit
}

function sortEstablishments(a, b) {
  // 1. Boostés en premier (position 1 avant 2)
  const aBoost = a.boostPosition > 0;
  const bBoost = b.boostPosition > 0;
  if (aBoost !== bBoost) return aBoost ? -1 : 1;
  if (aBoost && bBoost)  return a.boostPosition - b.boostPosition;
  // 2. Business > Pro > Gratuit
  const aPlan = planPriority(a.plan, a.owner?.isPremium || a.featured);
  const bPlan = planPriority(b.plan, b.owner?.isPremium || b.featured);
  if (aPlan !== bPlan) return bPlan - aPlan;
  // 3. Par note puis nb d'avis
  return b.avgRating - a.avgRating || b.reviewCount - a.reviewCount;
}

/* ── Flux RSS du blog ─────────────────────────────────────────────────
   Deuxième porte d'entrée pour les robots, à côté du sitemap : certains
   agrégateurs et lecteurs le suivent, et un humain peut s'y abonner. Coûte
   trente lignes, se met à jour tout seul. */
router.get("/blog/rss.xml", async (req, res) => {
  const BASE = "https://www.branshee.com";
  const echapper = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  try {
    const Article = require("../db/models/article.model");
    const articles = await Article.find({ status: "published" })
      .sort({ publishedAt: -1 })
      .limit(50)
      .select("title slug excerpt publishedAt updatedAt category")
      .lean();

    const items = articles
      .map(
        (a) => `
  <item>
    <title>${echapper(a.title)}</title>
    <link>${BASE}/blog/${a.slug}</link>
    <guid isPermaLink="true">${BASE}/blog/${a.slug}</guid>
    <description>${echapper(a.excerpt)}</description>
    ${a.category ? `<category>${echapper(a.category)}</category>` : ""}
    <pubDate>${new Date(a.publishedAt || a.updatedAt || Date.now()).toUTCString()}</pubDate>
  </item>`
      )
      .join("");

    res.type("application/rss+xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Blog BranShee</title>
  <link>${BASE}/blog</link>
  <atom:link href="${BASE}/blog/rss.xml" rel="self" type="application/rss+xml" />
  <description>Conseils pratiques pour les indépendants : remplir son agenda, réduire les rendez-vous manqués, se faire connaître en ligne.</description>
  <language>fr-BE</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}
</channel>
</rss>`);
  } catch (err) {
    console.error("rss error:", err);
    res.status(500).type("text/plain").send("Flux indisponible.");
  }
});

/* ── Clé de vérification IndexNow ─────────────────────────────────────
   Le protocole exige que la clé soit lisible à la racine du domaine : c'est
   ce qui prouve au moteur qu'on est bien propriétaire du site. */
router.get("/:cle.txt", (req, res, next) => {
  const attendue = require("../utils/indexNow").cle();
  if (!attendue || req.params.cle !== attendue) return next();
  res.type("text/plain").send(attendue);
});

/* ── Sitemap ──────────────────────────────────────────────────────── */
router.get("/sitemap.xml", async (req, res) => {
  const BASE  = "https://www.branshee.com";
  const today = new Date().toISOString().split("T")[0];

  // Tous les pros (premium ET gratuits) — slug en priorité, fallback sur _id
  let companyUrls = "";
  try {
    // Ne jamais soumettre à Google une URL qui répond 403/404 : les
    // établissements en pause ou supprimés sont exclus du sitemap.
    const companies = await Companies.find({ isPaused: { $ne: true }, isDeleted: { $ne: true } })
      .select("_id slug updatedAt owner")
      .populate("owner", "_id")
      .lean();
    companies
      .filter((c) => c.owner)
      .forEach((c) => {
        const loc     = `${BASE}/${c.slug || c._id}`;
        const lastmod = c.updatedAt
          ? new Date(c.updatedAt).toISOString().split("T")[0]
          : today;
        companyUrls += `
  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
      });
  } catch (_) {}

  // Articles de blog publiés — c'est par eux que le site se positionne sur
  // des requêtes que la page d'accueil ne peut pas viser.
  let articleUrls = "";
  try {
    const articles = await require("../controllers/blog.controller").articlesPourSitemap();
    articles.forEach((a) => {
      const lastmod = new Date(a.updatedAt || a.publishedAt || Date.now()).toISOString().split("T")[0];
      articleUrls += `
  <url>
    <loc>${BASE}/blog/${a.slug}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`;
    });
  } catch (_) {}

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
  <url>
    <loc>${BASE}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${BASE}/search</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${BASE}/blog</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${BASE}/logiciel-rendez-vous</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>${require("../utils/seoLanding").toutesLesPages().map((p) => `
  <url>
    <loc>${BASE}/logiciel-rendez-vous/${p.slug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`).join("")}
  <url>
    <loc>${BASE}/s-inscrire</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${BASE}/contact</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${BASE}/confidentialite</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${BASE}/conditions-utilisation</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>${articleUrls}${companyUrls}
</urlset>`;

  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(xml);
});

// router.get("/", async (req, res) => {
//   const coachs = await Companies.find({})
//     .populate({
//       path: "owner",
//       match: { isPremium: true },
//     })
//     .limit(10);

//   console.log({ coachs });

//   const validCoachs = coachs.filter((c) => c.isPremium === true);

//   res.render("client/landing-page", {
//     title: `BranShee — Prenez rendez-vous en ligne simplement`,
//     metaDescription: "Trouvez et réservez en ligne un coach sportif, un coiffeur, un thérapeute ou tout autre professionnel près de chez vous. Prise de rendez-vous gratuite et instantanée avec BranShee.",
//     canonical: "https://www.branshee.com/",
//     coachs: validCoachs,
//     services: getServices(res.locals.lang),
//   });
// });

// ── Page d'accueil ──────────────────────────────────────────────────────────
// NB : la home a été repensée pour optimiser la conversion des PROFESSIONNELS
// (cible payante prioritaire) — elle reprend désormais le contenu de l'ex-page
// "/manage-business". La découverte d'établissements pour les clients (recherche,
// filtres, cartes) vit maintenant entièrement sur "/search", et un bouton
// "Prendre rendez-vous" sur la home renvoie vers cette page de recherche pour
// les visiteurs qui cherchent un professionnel plutôt qu'à en devenir un.
router.get("/", requireFeatureActive("home"), (req, res) => {
  // title/meta dans les locales (pro_landing.meta_*) : le <title> suit la
  // langue du visiteur au lieu de rester figé en français pour les 6 langues.
  const pl = (res.locals.t && res.locals.t.pro_landing) || {};
  res.render("client/manage-business", {
    title: pl.meta_title || "Agenda en ligne gratuit & prise de rendez-vous 24h/24 | BranShee",
    metaDescription: pl.meta_desc || "Agenda en ligne gratuit : réservations 24h/24, rappels anti no-show, 0 % de commission, widget pour votre site. Pro à 19 €/mois, 1 mois offert.",
    canonical: "https://www.branshee.com/",
    becomeCoach: true,
  });
});

router.get("/search", requireFeatureActive("search"), async (req, res) => {
  try {
    const { name, location, category } = req.query;

    // Note minimale (case « Note 4,5 et plus » de la barre latérale). Bornée à
    // [0, 5] : le paramètre vient de l'URL, donc de n'importe qui.
    const minRating = (() => {
      const n = parseFloat(req.query.note);
      return Number.isFinite(n) && n > 0 ? Math.min(n, 5) : null;
    })();

    // Critères appliqués APRÈS la jointure de l'agrégation : on cherche donc
    // à la fois sur l'ÉTABLISSEMENT (`name`, `businessType` — source de vérité
    // depuis le multi-établissements) et sur son compte propriétaire (repli
    // pour les fiches créées avant, où ces champs vivaient sur le User).
    const conditions = [];

    if (name) {
      const rx = { $regex: escapeRegex(name.trim()).replace(/[\s\-\']/g, ".*"), $options: "i" };
      conditions.push({
        $or: [
          { name: rx },                    // nom de l'établissement
          { businessType: rx },            // métier de l'établissement
          { "owner.businessName": rx },
          { "owner.fullName": rx },
          { "owner.businessType": rx },
        ],
      });
    }

    if (location) {
      const rx = { $regex: escapeRegex(location.trim()).replace(/[\s\-\']/g, ".*"), $options: "i" };
      // `estabLocation` = adresse EFFECTIVE de l'établissement (cf. $addFields
      // plus bas). Chercher sur `owner.location` remontait le second
      // établissement d'un patron sur la ville du premier.
      const locationFilters = [
        { "estabLocation.city": rx },
        { "estabLocation.address": rx },
      ];
      const zipValue = parseInt(location);
      if (!isNaN(zipValue)) locationFilters.push({ "estabLocation.zip": zipValue });
      conditions.push({ $or: locationFilters });
    }

    // Filtre par catégorie (optionnel) — valeur exacte (insensible à la
    // casse) plutôt qu'une regex partielle : la catégorie vient du clic sur
    // un nom déjà connu (chips), pas d'une saisie libre, donc on évite tout
    // faux positif par sous-chaîne entre deux métiers différents.
    if (category && category.trim()) {
      // \s* en bordure : tolère un éventuel espace résiduel en base (cf.
      // normalisation faite dans getDynamicCategories pour fusionner les
      // doublons "Développeur freelance" / "développeur freelance ").
      const crx = { $regex: `^\\s*${escapeRegex(category.trim())}\\s*$`, $options: "i" };
      conditions.push({ $or: [{ businessType: crx }, { "owner.businessType": crx }] });
    }

    // PAS de filtre isPremium — tous les établissements, gratuits ET premium.
    // Mais on exclut les comptes désactivés par le superadmin.
    // `$ne: true` plutôt qu'un $or explicite : un `isDisabled: null` hérité
    // des vieux documents excluait l'établissement à tort.
    conditions.push({ "owner.isDisabled": { $ne: true } });

    // ── Fiches jamais configurées ────────────────────────────────────────
    // Un établissement encore nommé « Établissement » n'a jamais été touché
    // par son propriétaire : pas de nom, souvent ni ville ni photo ni service.
    // L'afficher pollue la recherche et envoie le visiteur sur une page vide.
    // Rien n'est supprimé ni mis en pause ici : la fiche reste accessible par
    // son lien direct, elle n'apparaît simplement plus dans la recherche.
    //
    // TROIS preuves de configuration, et il suffit d'UNE :
    //
    // 1. Un nom sur l'établissement. C'était l'unique critère, et il a fait
    //    disparaître de la recherche des professionnelles bien actives : sur
    //    les comptes antérieurs au multi-établissement, l'identité vit sur le
    //    COMPTE (`owner.businessName`) et n'a jamais été recopiée sur la
    //    Company — la migration d'identité n'ayant pas tourné en production.
    // 2. Un nom sur le compte propriétaire, donc, en repli.
    // 3. Au moins un rendez-vous reçu. C'est la preuve la plus forte qui
    //    soit : une fiche qui a servi à un vrai client est une vraie fiche,
    //    même sans nom ni métier renseignés.
    //
    // Ne plus dépendre d'une seule colonne est délibéré : une migration non
    // lancée ne doit plus pouvoir rendre des pros invisibles.
    const NOM_PAR_DEFAUT = /^\s*(établissement|etablissement)\s*$/i;
    const nomValide = { $exists: true, $nin: ["", null], $not: NOM_PAR_DEFAUT };
    conditions.push({
      $or: [
        { name: nomValide },
        { "owner.businessName": nomValide },
        { _aDesRdv: true },
      ],
    });

    const searchMatch = { $and: conditions };

    // ── Pagination côté BASE ────────────────────────────────────────────────
    // Avant : on chargeait TOUS les users correspondants en mémoire, puis 100
    // établissements triés en JS — intenable à l'échelle (100 000 fiches) et
    // le tri s'appliquait à un échantillon arbitraire. Ici tout (filtre, tri,
    // note moyenne, découpage en pages) est fait par MongoDB en une passe.
    const PAGE_SIZE = 24;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);

    // `description` et `location` du compte n'y figurent PAS volontairement :
    // ils appartiennent à l'établissement (estabDescription / estabLocation
    // ci-dessous). Les laisser ici suffisait à ce qu'une vue les relise et
    // réaffiche l'adresse du premier établissement sur la carte du second.
    const OWNER_FIELDS = {
      _id: 1, fullName: 1, businessName: 1, businessType: 1, businessPicture: 1,
      profilePicture: 1, verified: 1,
      subscription: 1, isPremium: 1, manualPremium: 1,
    };
    const PAID = ["essentiel", "pro", "business"];
    // getCompanyPlan fait confiance à TOUT plan connu posé sur la Company,
    // y compris "basic" (choix explicite ≠ absence de valeur).
    const KNOWN_PLANS = ["basic", "essentiel", "pro", "business"];

    // ── Identité EFFECTIVE de l'établissement ────────────────────────────────
    // Transposition en agrégation de utils/establishmentIdentity.js : adresse et
    // description appartiennent à l'ÉTABLISSEMENT, et seul celui D'ORIGINE
    // (`User.company`) retombe sur le compte tant que la migration n'a pas
    // tourné. Les deux implémentations doivent rester alignées : si hasLocation()
    // ou isPrimary() bouge là-bas, corriger ici aussi.
    const filled = (path) => ({ $not: [{ $in: [{ $ifNull: [path, ""] }, ["", null]] }] });
    // Réplique de hasLocation() : un `location` à {} (ou une chaîne héritée,
    // dont les sous-champs sont introuvables) ne compte pas comme renseigné.
    const hasLocationExpr = {
      $or: ["address", "city", "zip", "gmapUrl", "iframeUrl", "lat"].map((f) => filled(`$location.${f}`)),
    };

    const pipeline = [
      { $match: { isPaused: { $ne: true }, isDeleted: { $ne: true } } },
      { $lookup: { from: User.collection.name, localField: "owner", foreignField: "_id", as: "owner" } },
      { $unwind: "$owner" },
      // Cet établissement a-t-il déjà reçu un rendez-vous ? On s'arrête au
      // premier trouvé (`$limit: 1`) : on ne veut pas compter, seulement
      // savoir si la fiche a déjà servi à quelqu'un. C'est l'une des trois
      // preuves de configuration testées plus bas.
      { $lookup: {
          from: Booking.collection.name,
          let: { cid: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$company", "$$cid"] } } },
            { $limit: 1 },
            { $project: { _id: 1 } },
          ],
          as: "_rdv",
      } },
      { $addFields: {
          _aDesRdv: { $gt: [{ $size: "$_rdv" }, 0] },
          _isPrimary: { $eq: [{ $toString: { $ifNull: ["$owner.company", ""] } }, { $toString: "$_id" }] },
      } },
      { $addFields: {
          estabLocation: { $cond: [
            hasLocationExpr,
            "$location",
            { $cond: ["$_isPrimary", { $ifNull: ["$owner.location", null] }, null] },
          ] },
          estabDescription: { $let: {
            vars: { cd: { $ifNull: ["$description", ""] } },
            in: { $cond: [
              { $ne: ["$$cd", ""] },
              "$$cd",
              { $cond: ["$_isPrimary", { $ifNull: ["$owner.description", ""] }, ""] },
            ] },
          } },
      } },
      // Les critères de recherche portent sur l'établissement et sur son compte
      // propriétaire : on les applique après la jointure (plus de requête User
      // séparée non bornée) et après le calcul de l'identité effective.
      { $match: searchMatch },
      // Note moyenne + nombre d'avis, calculés en base.
      { $lookup: {
          from: Review.collection.name,
          let: { cid: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$company", "$$cid"] } } },
            { $group: { _id: null, avg: { $avg: "$rating" }, n: { $sum: 1 } } },
          ],
          as: "_r",
      } },
      // Prix d'appel : la prestation active la MOINS chère. « dès 22 € » situe
      // le budget depuis la liste — sans quoi le visiteur doit ouvrir chaque
      // fiche pour comparer, et il n'en ouvre pas six.
      // `price: {$gt: 0}` : le champ vaut null quand le pro ne l'a pas
      // renseigné, et un 0 signifie « sur devis », pas « gratuit ».
      { $lookup: {
          from: Service.collection.name,
          let: { cid: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$company", "$$cid"] }, active: { $ne: false }, price: { $gt: 0 } } },
            { $group: { _id: null, min: { $min: "$price" } } },
          ],
          as: "_p",
      } },
      { $addFields: {
          avgRating:   { $ifNull: [{ $first: "$_r.avg" }, 0] },
          reviewCount: { $ifNull: [{ $first: "$_r.n" }, 0] },
          priceFrom:   { $ifNull: [{ $first: "$_p.min" }, null] },
          boostPosition: { $ifNull: ["$boostPosition", 0] },
          // Réplique exacte de utils/planLimits.getCompanyPlan() : le forfait
          // appartient à l'ÉTABLISSEMENT (company.plan/planStatus) et ne
          // retombe sur celui du compte owner (getPlan) qu'à défaut.
          // NB : `$$cp` est évalué AVANT que ce $addFields n'écrase `plan`.
          plan: { $let: {
            vars: {
              cp: { $ifNull: ["$plan", ""] },
              // planStatus absent / null / "" ⇒ actif (cf. getCompanyPlan).
              cpActive: { $in: [{ $ifNull: ["$planStatus", "active"] }, ["active", "", null]] },
              sp: { $ifNull: ["$owner.subscription.plan", ""] },
              active: { $eq: ["$owner.subscription.status", "active"] },
              manual: { $or: [{ $eq: ["$owner.manualPremium", true] }, { $eq: ["$owner.isPremium", true] }] },
            },
            in: { $cond: [
              { $and: [{ $in: ["$$cp", KNOWN_PLANS] }, "$$cpActive"] },
              "$$cp",
              { $cond: [
                "$$manual",
                { $cond: [{ $in: ["$$sp", PAID] }, "$$sp", "pro"] },
                { $cond: [{ $and: ["$$active", { $in: ["$$sp", PAID] }] }, "$$sp", "basic"] },
              ] },
            ] },
          } },
      } },
      // Filtre « bien noté » : il vient forcément ICI et non dans `searchMatch`,
      // parce que `avgRating` n'existe qu'après la jointure des avis juste
      // au-dessus. Placé côté serveur, il porte sur TOUS les résultats — un
      // filtre en JavaScript n'aurait vu que les 24 fiches de la page, et le
      // compteur aurait annoncé un total faux.
      ...(minRating ? [{ $match: { avgRating: { $gte: minRating } } }] : []),
      { $addFields: {
          featured: { $in: ["$plan", ["pro", "business"]] },
          // Même ordre que sortEstablishments() : boostés d'abord, puis
          // Business > Pro > Essentiel > Gratuit, puis note, puis nb d'avis.
          boostRank: { $cond: [{ $gt: ["$boostPosition", 0] }, 0, 1] },
          planRank: { $switch: { branches: [
            { case: { $eq: ["$plan", "business"] }, then: 3 },
            { case: { $eq: ["$plan", "pro"] },      then: 2 },
            { case: { $eq: ["$plan", "essentiel"] }, then: 1 },
          ], default: 0 } },
      } },
      { $sort: { boostRank: 1, boostPosition: 1, planRank: -1, avgRating: -1, reviewCount: -1, _id: 1 } },
      // `name` / `businessType` / `photo` de l'ÉTABLISSEMENT : c'est ce qui doit
      // s'afficher sur la carte (le compte propriétaire ne sert que de repli).
      { $project: { _id: 1, slug: 1, name: 1, businessType: 1, photo: 1, boostPosition: 1, avgRating: 1, reviewCount: 1, priceFrom: 1, plan: 1, featured: 1, estabLocation: 1, estabDescription: 1, owner: OWNER_FIELDS } },
      // $facet : la page ET le total en une seule requête.
      { $facet: {
          rows:  [{ $skip: (page - 1) * PAGE_SIZE }, { $limit: PAGE_SIZE }],
          total: [{ $count: "n" }],
      } },
    ];

    const agg = await Companies.aggregate(pipeline).allowDiskUse(true);
    const coachsWithRating = (agg[0] && agg[0].rows) || [];
    const totalResults = (agg[0] && agg[0].total[0] && agg[0].total[0].n) || 0;
    const totalPages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));

    const allCategories = await getDynamicCategories();

    // ── Prochains créneaux libres ─────────────────────────────────────────
    // Voir les heures disponibles AVANT de cliquer, c'est ce qui sépare une
    // plateforme de réservation d'un annuaire : on choisit son créneau depuis
    // la liste au lieu d'ouvrir six fiches pour découvrir que personne n'est
    // libre avant mardi.
    //
    // Borné à la page affichée (24 fiches au plus) et arrêté au premier jour
    // qui donne des créneaux : le calcul coûte quelques requêtes par
    // établissement. Si ce coût devient sensible, c'est ici qu'il faudra un
    // cache court — pas dans la vue.
    //
    // Enveloppé dans un try/catch : des créneaux manquants font une carte un
    // peu plus pauvre, jamais une page de recherche en erreur 500.
    let creneauxParEtab = new Map();
    try {
      const { creneauxPourEtablissements } = require("../utils/searchSlots");
      creneauxParEtab = await creneauxPourEtablissements(coachsWithRating.map((c) => c._id));
    } catch (err) {
      console.error("[/search] créneaux indisponibles:", err.message);
    }
    coachsWithRating.forEach((c) => {
      c.creneaux = creneauxParEtab.get(String(c._id)) || null;
    });

    res.render("client/search", {
      title: `Recherche — BranShee`,
      coachs: coachsWithRating,
      searchName: name || "",
      searchLocation: location || "",
      searchCategory: category || "",
      minRating,
      allCategories,
      services: getServices(res.locals.lang),
      page,
      totalPages,
      totalResults,
      pageSize: PAGE_SIZE,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

/* ── Point d'entrée de l'application installée ────────────────────────────
   `start_url` du manifeste. Quelqu'un qui a installé l'app a déjà vu la page
   de vente — la lui remontrer à chaque ouverture lui impose deux clics avant
   d'arriver à son agenda. On l'envoie donc directement là où il va.

   Redirection côté serveur : lui seul sait si la session est celle d'un pro,
   d'un client, ou de personne. Une redirection en JavaScript ferait clignoter
   la page d'accueil avant de partir ailleurs. */
router.get("/app", async (req, res) => {
  try {
    // Ancien compte Client séparé (cf. migrate-merge-client-into-user).
    if (req.session && req.session.clientId) return res.redirect("/espace-client");

    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      const CompanyMembership = require("../db/models/company/companyMembership.model");
      // « Pro » = possède un établissement, ou est collaborateur accepté d'un
      // autre. Sans cette vérification, un compte client atterrissait sur
      // /appointment, que injectCompany renvoie aussitôt vers l'accueil : la
      // boucle exacte qu'on cherche à éviter.
      const [proprietaire, membre] = await Promise.all([
        Companies.exists({ owner: req.user._id, isDeleted: { $ne: true } }),
        CompanyMembership.exists({ user: req.user._id, status: "accepted" }),
      ]);
      return res.redirect(proprietaire || membre ? "/appointment" : "/espace-client");
    }

    return res.redirect("/login");
  } catch (err) {
    console.error("[/app] redirection impossible:", err.message);
    // En cas de pépin, la connexion reste un point de départ valable pour
    // tout le monde — jamais un écran d'erreur au lancement de l'app.
    return res.redirect("/login");
  }
});

router.get("/contact", (req, res) => {
  res.render("client/contact", { title: "Contact — BranShee", alwaysSticky: true });
});

router.post("/contact", async (req, res) => {
  const { name, surname, email, subject, message } = req.body;

  if (!name || !surname || !email || !subject || !message) {
    return res.render("client/contact", {
      title: "Contact — BranShee",
      error: "Veuillez remplir tous les champs.",
      formData: req.body,
    });
  }

  try {
    // Repli garanti : `ADMIN_EMAIL` absente envoyait `to: undefined` à Brevo,
    // le message partait dans le vide et le visiteur voyait « Envoyé ».
    const adminEmail = require("../utils/adressesContact").adminEmail();
    const html = pug.renderFile(path.join(__dirname, "../views/templates/emails/contact.pug"), { name, surname, email, subject, message });

    await sendEmail(adminEmail, `[Contact BranShee] ${subject}`, html);

    return res.render("client/contact", {
      title: "Contact — BranShee",
      success: true,
    });
  } catch (err) {
    console.error(err);
    return res.render("client/contact", {
      title: "Contact — BranShee",
      error: "Une erreur est survenue. Veuillez réessayer.",
      formData: req.body,
    });
  }
});

router.get("/confidentialite", (req, res) => {
  res.render("client/confidentialite", {
    title: "Politique de confidentialité — BranShee",
    alwaysSticky: true,
  });
});

router.get("/conditions-utilisation", (req, res) => {
  res.render("client/conditions-utilisation", {
    title: "Conditions d'utilisation — BranShee",
    alwaysSticky: true,
  });
});

// Le contenu "pro" vit désormais directement sur la home ("/") afin de
// maximiser la conversion des visiteurs en professionnels payants — on
// redirige donc en 301 (permanent) pour préserver le référencement et les
// liens existants pointant vers /manage-business.
router.get("/manage-business", (req, res) => {
  res.redirect(301, "/");
});

// ── Ancienne landing page Google Ads → redirige vers la page principale ─────
router.get("/pro", (req, res) => {
  res.redirect(301, "/");
});

// Le choix pro/client se fait désormais dans le formulaire d'inscription
// unifié lui-même (étape "Intention") — cette page de fork est obsolète.
router.get("/s-inscrire", (req, res) => res.redirect(301, "/register"));

// ─── Créer / rejoindre / gérer mes établissements (cf. plan d'unification +
// multi-établissements) — pages dédiées, accessibles depuis le sidebar
// espace-client. ──────────────────────────────────────────────────────────────
const establishmentController = require("../controllers/establishment.controller");
const isAuth = require("../middlewares/isAuth");
const isClientOrUserAuth = require("../middlewares/isClientOrUserAuth");

// ── Démarrage express (« 3 clics ») — conversion des comptes client en pro ──
// À enregistrer AVANT la route attrape-tout "/:company" pour que "demarrer" ne
// soit pas confondu avec un slug d'établissement.
const _qsUpload = require("../config/multer");
const { processSingleImage: _qsProcessImage } = require("../middlewares/processImageUpload");
router.get("/demarrer", isAuth, establishmentController.quickStartPage);
router.post(
  "/demarrer/creer",
  isAuth,
  _qsUpload.single("photo"),
  _qsProcessImage("photo"),
  establishmentController.quickStartCreate,
);
router.post("/demarrer/metier-request", isAuth, establishmentController.requestMetierIndex);

router.get("/etablissement/mes-etablissements", isClientOrUserAuth, establishmentController.listMyEstablishments);
// Page admin (sidebar.pug) — bascule l'établissement actif puis réutilise
// injectCompany pour avoir tous les locals attendus par le layout admin.
router.get(
  "/etablissement/:id/collaborateurs",
  isAuth,
  establishmentController.setActiveCompanyForCollabPage,
  require("../middlewares/injectCompany"),
  // La page est accessible à tous les membres de l'établissement (droit
  // d'office : voir le patron + la liste). setActiveCompanyForCollabPage a
  // déjà vérifié que l'utilisateur est bien owner ou membre actif.
  establishmentController.renderCollaboratorsPage,
);

router.get(
  "/etablissement/:id/grades",
  isAuth,
  establishmentController.setActiveCompanyForCollabPage,
  require("../middlewares/injectCompany"),
  require("../utils/permissions").requirePermission("grades.view"),
  establishmentController.renderGradesPage,
);

const AMENITY_OPTIONS = {
  cleanliness: [
    'Gel hydroalcoolique disponible',
    'Salle désinfectée entre les séances',
    'Filtre à air en service',
    'Masques disponibles sur demande',
    'Stérilisation UV',
    'Serviettes à usage unique',
  ],
  comfort: [
    'Table chauffante',
    'Zone calme',
    'Musique personnalisable',
    'Thé / infusion offert(e)',
    'Options aromathérapie',
    'Lumière naturelle',
  ],
  practical: [
    'Parking gratuit',
    'Accès fauteuil roulant',
    'Espèces acceptées',
    'Carte / Bancontact accepté',
    'LGBTQIA+ friendly',
    'Chargeur disponible',
  ],
};

const BADGE_OPTIONS = [
  'Vérifié',
  'LGBTQIA+ friendly',
  'Accès fauteuil roulant',
  'Parking gratuit',
  'Top rated 2024',
  'Carte acceptée',
];

// ── Blog public ───────────────────────────────────────────────────────────────
// Impérativement AVANT la route attrape-tout "/:company", sinon /blog serait
// cherché comme un slug d'établissement et renverrait un 404.
const blogCtrl = require("../controllers/blog.controller");
router.get("/blog", blogCtrl.blogIndex);
router.get("/blog/:slug", blogCtrl.blogArticle);

// ── Site builder public pages ─────────────────────────────────────────────────
const siteCtrl = require("../controllers/site.controller");
router.get("/s/:slug", siteCtrl.publicSite);
router.post("/s/:slug/contact", siteCtrl.contactForm);

/* ── Pages « logiciel de rendez-vous pour X à Y » ────────────────────────
   Personne ne cherche « branshee » : on se positionne sur ce que les pros
   tapent réellement. Une page par couple (métier, ville), avec du texte
   propre au métier et les établissements RÉELS de la ville — sans quoi ce
   ne seraient que des pages satellites, que Google déclasse. */
const seoLanding = require("../utils/seoLanding");

router.get("/logiciel-rendez-vous", (req, res) => {
  res.render("client/seo-hub", {
    title: "Logiciel de prise de rendez-vous par métier et par ville | BranShee",
    metaDescription:
      "Agenda et prise de rendez-vous en ligne pour kinés, ostéopathes, coiffeurs, esthéticiennes, psychologues… à Bruxelles, Liège, Namur, Charleroi et ailleurs.",
    canonical: "https://www.branshee.com/logiciel-rendez-vous",
    metiers: seoLanding.METIERS,
    villes: seoLanding.VILLES,
  });
});

router.get("/logiciel-rendez-vous/:slug", async (req, res, next) => {
  const cible = seoLanding.resoudre(req.params.slug);
  // Slug inconnu : on laisse passer au 404 global plutôt que d'inventer une
  // page — une URL indexable ne doit jamais répondre à n'importe quoi.
  if (!cible) return next();

  const { metier, ville } = cible;

  // Établissements réels de la ville. Le métier n'est pas exigé : à ce stade
  // il y en a peu, et une liste vide vaut moins qu'une liste de voisins.
  let etablissements = [];
  try {
    const rx = (s) => ({ $regex: s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" });
    const docs = await Companies.find({
      isPaused: { $ne: true },
      isDeleted: { $ne: true },
      $or: [{ "location.city": rx(ville.nom) }, { "location.address": rx(ville.nom) }],
    })
      .select("name slug businessType location")
      .limit(9)
      .lean();

    // Les établissements du métier visé d'abord : c'est la preuve la plus
    // parlante sur une page « kiné à Liège ».
    const cle = (c) => `${c.businessType || ""}`.toLowerCase();
    const correspond = (c) => metier.motsCles.some((m) => cle(c).includes(m.toLowerCase()));
    docs.sort((a, b) => (correspond(b) ? 1 : 0) - (correspond(a) ? 1 : 0));

    etablissements = docs.map((c) => {
      const nom = (c.name || "").trim() || "Établissement";
      return {
        nom,
        slug: c.slug || String(c._id),
        metier: c.businessType || "",
        ville: (c.location && c.location.city) || "",
        initiales: nom.slice(0, 2).toUpperCase(),
        couleur: nom.charCodeAt(0) % 8,
      };
    });
  } catch (e) {
    console.error("[seo-landing] établissements:", e.message);
  }

  // Quatre articles à proposer en bas de page. Les 80 pages métier/ville se
  // ressemblent beaucoup entre elles : pointer vers du contenu réellement
  // différent donne au robot une raison d'explorer plus loin, et au visiteur
  // qui n'est pas prêt à s'inscrire quelque chose à lire.
  let articlesBlog = [];
  try {
    const Article = require("../db/models/article.model");
    articlesBlog = await Article.find({ status: "published" })
      .sort({ publishedAt: -1 })
      .limit(4)
      .select("title slug")
      .lean();
  } catch (e) {
    console.error("[seo-landing] articles:", e.message);
  }

  const titre = `Logiciel de prise de rendez-vous pour ${metier.pluriel} à ${ville.nom} | BranShee`;
  const desc = `Agenda en ligne pour ${metier.pluriel} à ${ville.nom} : vos ${metier.clients} réservent 24h/24, rappels automatiques, moins de rendez-vous manqués. Gratuit pour commencer.`;
  const url = `https://www.branshee.com/logiciel-rendez-vous/${cible.slug}`;

  // FAQ : deux questions propres au métier + une commune. Le JSON-LD doit
  // décrire EXACTEMENT ce que la page affiche, sinon Google le rejette.
  const faq = metier.faq.concat([
    {
      q: `Combien coûte BranShee pour ${metier.pluriel === metier.nom ? "un " + metier.nom : "un " + metier.nom} à ${ville.nom} ?`,
      r: "L'offre de départ est gratuite et sans carte bancaire. Les formules payantes ajoutent les rendez-vous illimités, les rappels automatiques et les collaborateurs.",
    },
  ]);

  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: "https://www.branshee.com/" },
        { "@type": "ListItem", position: 2, name: "Logiciel de rendez-vous", item: "https://www.branshee.com/logiciel-rendez-vous" },
        { "@type": "ListItem", position: 3, name: `${metier.nom} à ${ville.nom}`, item: url },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.r },
      })),
    },
  ];

  // Échappement de `<` : le JSON part dans un <script>, un caractère non
  // échappé pourrait clore la balise.
  const ldJson = JSON.stringify(ld).replace(/</g, "\\u003c");

  res.render("client/seo-landing", {
    title: titre,
    metaDescription: desc,
    canonical: url,
    ogType: "article",
    metier,
    ville,
    // « un » / « une » selon le métier — « pour une esthéticienne » et
    // « pour un kiné » ne s'écrivent pas pareil.
    article: /^(esthéticienne|masseuse)$/i.test(metier.nom) ? "une" : "un",
    etablissements,
    titreListe: etablissements.length === 1
      ? `Un professionnel déjà sur BranShee à ${ville.nom}`
      : `Ils utilisent déjà BranShee à ${ville.nom}`,
    faq,
    ldJson,
    autresVilles: seoLanding.VILLES.filter((v) => v.slug !== ville.slug),
    autresMetiers: seoLanding.METIERS.filter((m) => m.slug !== metier.slug),
    articlesBlog,
  });
});


router.get("/:company", requireFeatureActive("booking_page"), async (req, res) => {
  const company = await getCompanyIfExist(req.params.company);

  if (!company) {
    return res.status(404).render("client/404");
  }

  const ID = company.owner;
  const coach = await User.findById(ID);

  // Établissement orphelin (compte propriétaire supprimé) : tout le reste de
  // cette route déréférence `coach` — sans ce garde on renvoyait un 500 sur
  // une URL publique.
  if (!coach) {
    return res.status(404).render("client/404");
  }

  // Compte désactivé par le superadmin → page de blocage
  if (coach && coach.isDisabled) {
    return res.status(403).render("client/account-disabled");
  }

  // Établissement mis en pause par le pro lui-même → page neutre (réversible,
  // ≠ isDisabled qui est une action du superadmin)
  if (company.isPaused) {
    return res.status(403).render("client/company-paused");
  }

  // ── Mon Site (Business) : si un mini-site est publié, il remplace la page
  // de réservation classique à cette même URL — c'est la page d'accueil de
  // l'établissement, avec le calendrier intégré dans sa section "booking".
  // `?embedded=1` = appel venant de CETTE iframe interne → on l'ignore pour
  // ne jamais boucler et toujours servir la page de réservation pure ici.
  if (!req.query.embedded) {
    const { getLimit, billingUserFor } = require("../utils/planLimits");
    // « Mon Site » est un droit de l'ÉTABLISSEMENT, pas du compte owner.
    if (getLimit("mySite", billingUserFor(company, coach))) {
      const rendered = await require("../controllers/site.controller").renderSiteForCompany(company, res);
      if (rendered) return;
    }
  }

  const Service = require("../db/models/company/service.model");
  const { getBookableTeam } = require("../utils/bookableTeam");

  const services = await Service.find({ company: company._id, active: true }).populate("employees", "fullName profilePicture").sort("order").lean();

  const team = await getBookableTeam(company._id);
  const teamById = new Map(team.map((m) => [m.id, m]));
  const activeEmployees = team;

  // ── Questionnaire de réservation (unifié pour le client) ───────────────────
  // Priorité au nouveau questionnaire multi-questions (serviceQuestionnaire +
  // questionRules) ; sinon on convertit l'ancien (bookingQuestion +
  // answerVisibility) au même format. Résultat : le client ne gère qu'un seul
  // format. Désactivé s'il n'y a aucun service actif (évite le cul-de-sac).
  const _sq = company.serviceQuestionnaire;
  let clientQuestionnaire = { enabled: false, questions: [] };
  const serviceRulesMap = {};
  if (_sq && _sq.enabled && Array.isArray(_sq.questions) && _sq.questions.length) {
    clientQuestionnaire = {
      enabled: true,
      questions: _sq.questions
        .filter((q) => q && q._id && q.question && Array.isArray(q.options) && q.options.length)
        .map((q) => ({
          id: String(q._id),
          question: q.question,
          options: (q.options || []).filter((o) => o && o._id && o.label).map((o) => ({ id: String(o._id), label: o.label })),
        }))
        .filter((q) => q.options.length),
    };
    services.forEach((s) => {
      serviceRulesMap[String(s._id)] = (s.questionRules || []).map((r) => ({
        questionId: String(r.questionId),
        optionIds: (r.optionIds || []).map(String),
      }));
    });
  } else if (company.bookingQuestion && company.bookingQuestion.enabled) {
    const bq = company.bookingQuestion;
    clientQuestionnaire = {
      enabled: true,
      questions: [{
        id: "legacy",
        question: bq.question || "Une petite question avant de commencer",
        options: [
          { id: "new", label: bq.newLabel || "Oui, je suis nouveau" },
          { id: "existing", label: bq.existingLabel || "Non, j'ai déjà consulté" },
        ],
      }],
    };
    services.forEach((s) => {
      const vis = s.answerVisibility || "all";
      serviceRulesMap[String(s._id)] = vis === "all" ? [] : [{ questionId: "legacy", optionIds: [vis] }];
    });
  }
  // Aucun service actif (ou questionnaire vidé) → pas de question.
  if (!services.length || !clientQuestionnaire.questions.length) clientQuestionnaire.enabled = false;
  const questionnaireJson = JSON.stringify(clientQuestionnaire);

  // Pre-serialize services to avoid Pug interpolation issues with nested braces
  const servicesJson = JSON.stringify(
    services.map(function (s) {
      return {
        _id: String(s._id),
        name: s.name,
        description: s.description || "",
        price: s.price,
        duration: s.duration,
        durationMax: s.durationMax || null,
        category: s.category || "",
        answerVisibility: s.answerVisibility || "all",
        questionRules: serviceRulesMap[String(s._id)] || [],
        // type/capacity/location manquaient ici — STATE.service.type retombait
        // TOUJOURS sur "individual" côté client (cf. public/js/layouts/index.js),
        // rendant tout le code "collectif" déjà écrit (saut étape employé,
        // places restantes) inerte en production.
        type: s.type || "individual",
        capacity: s.capacity || null,
        location: s.location || "",
        image: s.image || "",
        employees: (s.employees || [])
          .map(function (e) { return teamById.get(String(e._id)); })
          .filter(Boolean)
          .map(serializeTeamMember),
      };
    }),
  );

  const employeesJson = JSON.stringify(activeEmployees.map(serializeTeamMember));

  // ── Is the business open today? ─────────────────────────────────────────
  let isOpenToday = false;
  try {
    const DaysOff = require("../db/models/company/daysOff.model");
    const now        = new Date();
    const todayDow   = now.getDay();                            // 0=Sun … 6=Sat
    const todayIso   = now.toISOString().split("T")[0];

    // Base: regular weekly schedule
    const schedEntry = company.schedule
      ? company.schedule.find((d) => d.weekdayIndex === todayDow)
      : null;
    isOpenToday = !!(schedEntry && !schedEntry.dayOff &&
                     schedEntry.workingHours && schedEntry.workingHours.length > 0);

    // Override: specific date exception (affects all employees)
    const daysOffDoc = await DaysOff.findOne({ company: company._id }).lean();
    if (daysOffDoc && daysOffDoc.dates) {
      const exc = daysOffDoc.dates.find((d) => {
        const excIso = new Date(d.date).toISOString().split("T")[0];
        return excIso === todayIso && (!d.employees || d.employees.length === 0);
      });
      if (exc) {
        // Exception with hours → open with custom hours; without → closed
        isOpenToday = !!(exc.workingHours && exc.workingHours.length > 0 && exc.workingHours[0].start);
      }
    }
  } catch (_) { isOpenToday = false; }

  // Client connecté → pré-remplir le formulaire + vérifier doublon avis
  let clientUser    = null;
  let clientSession = null;
  let hasReviewed   = false;
  // Priorité à req.user, comme partout ailleurs (middlewares/injectClientUser,
  // isClientOrUserAuth, POST /reviews, booking.controller). Les deux sessions
  // peuvent coexister — req.login ne purge pas req.session.clientId — et cette
  // page était la SEULE à tester clientId d'abord : elle affichait l'identité
  // Client alors que POST /reviews et Booking.clientRef enregistraient celle du
  // User, d'où un formulaire d'avis vierge répondant « vous avez déjà laissé un
  // avis ».
  if (req.user) {
    if (String(req.user._id) !== String(company.owner)) {
      // Un User connecté qui n'est PAS le propriétaire de cet établissement
      // peut y laisser un avis (avant, seul un ancien compte Client était
      // reconnu, d'où le « connectez-vous » trompeur qui renvoyait vers
      // l'admin puisque le User était déjà connecté).
      try {
        const parts = (req.user.fullName || "").trim().split(" ");
        clientUser = {
          firstName: parts[0] || "",
          lastName: parts.slice(1).join(" ") || "",
          email: req.user.email || "",
          phone: req.user.phone || "",
        };
        clientSession = {
          _id:            String(req.user._id),
          fullName:       req.user.fullName || "",
          profilePicture: req.user.profilePicture || "/images/no-user.webp",
        };
        const Review = require("../db/models/review.model");
        const existingReview = await Review.findOne({ company: company._id, client: req.user._id }).lean();
        hasReviewed = !!existingReview;
      } catch (_) {}
    }
  } else if (req.session && req.session.clientId) {
    // Repli sur l'ancien compte Client séparé, tant que tous les comptes n'ont
    // pas été fusionnés (cf. scripts/migrate-merge-client-into-user.js).
    try {
      const Client = require("../db/models/client.model");
      const client = await Client.findById(req.session.clientId).lean();
      if (client) {
        const parts = (client.fullName || "").trim().split(" ");
        clientUser = {
          firstName: parts[0] || "",
          lastName: parts.slice(1).join(" ") || "",
          email: client.email || "",
          phone: client.phone || "",
        };
        clientSession = {
          _id:            String(client._id),
          fullName:       client.fullName || "",
          profilePicture: client.profilePicture || "/images/no-user.webp",
        };
        // Vérifier si cet utilisateur a déjà posté un avis
        const Review = require("../db/models/review.model");
        const existingReview = await Review.findOne({ company: company._id, client: client._id }).lean();
        hasReviewed = !!existingReview;
      }
    } catch (_) {}
  }

  // ── Avis ──────────────────────────────────────────────────────────────────
  let reviews = [], avgRating = 0, reviewCount = 0;
  try {
    const Review = require("../db/models/review.model");
    reviews = await Review.find({ company: company._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    reviewCount = reviews.length;
    if (reviewCount > 0) {
      avgRating = Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviewCount) * 10) / 10;
    }
  } catch (_) {}

  // Nom de l'ÉTABLISSEMENT en priorité (le compte propriétaire n'est qu'un
  // repli pour les fiches créées avant le multi-établissements).
  const bizLabel = company.name || coach.businessName || coach.fullName;
  const profileTitle = `${bizLabel} — Réserver en ligne | BranShee`;
  // Identité publique RÉSOLUE (adresse, contacts, réseaux, description).
  // Ne jamais relire coach.location & co : ces champs vivent désormais sur
  // l'établissement (cf. utils/establishmentIdentity.js). La méta description
  // en fait partie — lue sur le compte, elle décrivait le premier
  // établissement sur la page du second.
  const estab = identityFor(company, coach);
  const profileDesc = estab.description ? `${estab.description.slice(0, 150)}…` : `Réservez en ligne avec ${bizLabel}. Prise de rendez-vous rapide et gratuite sur BranShee.`;

  const cs = coach.calendarSettings || {};

  // Stripe plateforme BranShee — actif dès que la clé publiable est disponible
  const _spk = _routeEnv.stripePublishableKey || process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY_LOCAL || "";
  const _stripeActive = !!_spk;
  console.log("[booking page] stripeActive:", _stripeActive, "| spk:", _spk ? _spk.slice(0,12) : "VIDE", "| cancellationRule:", company.cancellationPolicy?.rule, "| prepayEnabled:", company.prepayment?.enabled);

  const prepaymentConfig = {
    enabled:      !!(company.prepayment?.enabled) && _stripeActive,
    required:     !!(company.prepayment?.required) && _stripeActive,
    stripeActive: _stripeActive,
    // Autres modes de paiement
    cash:         !!(company.acceptedPayments?.cash),
    cardOnSite:   !!(company.acceptedPayments?.cardOnSite),
    bankTransfer: !!(company.acceptedPayments?.bankTransfer?.enabled),
    bankDetails: {
      iban:     company.acceptedPayments?.bankTransfer?.iban     || "",
      bic:      company.acceptedPayments?.bankTransfer?.bic      || "",
      bankName: company.acceptedPayments?.bankTransfer?.bankName || "",
      note:     company.acceptedPayments?.bankTransfer?.note     || "",
    },
    // PayPal
    paypal:       !!(company.acceptedPayments?.paypal?.enabled),
    paypalMe:     company.acceptedPayments?.paypal?.paypalMe || "",
    // QR code
    qrCode:       !!(company.acceptedPayments?.qrCode?.enabled) && !!(company.acceptedPayments?.qrCode?.imageUrl),
    qrCodeImage:  company.acceptedPayments?.qrCode?.imageUrl || "",
    qrCodeNote:   company.acceptedPayments?.qrCode?.note     || "",
    cancellationRule: company.cancellationPolicy?.rule || "free",
  };

  // Detect whether the visitor is an authenticated admin user
  const visitorIsAdmin = !!(req.isAuthenticated && req.isAuthenticated() && req.user);

  res.render("client/index", {
    title: profileTitle,
    metaDescription: profileDesc,
    ogType: "profile",
    // Photo de l'ÉTABLISSEMENT : c'est l'aperçu de tout lien partagé.
    ogImage: company.photo || coach.businessPicture || coach.profilePicture || "https://www.branshee.com/images/og-cover.jpg",
    canonical: `https://www.branshee.com/${company.slug || company._id}`,
    company,
    coach,
    estab,
    services,
    activeEmployees,
    servicesJson,
    employeesJson,
    questionnaireJson,
    clientUser,
    clientSession,
    hasReviewed,
    // Pour l'affichage de la section avis : un connecté ne doit jamais voir
    // « connectez-vous », et le propriétaire voit un message dédié.
    viewerLoggedIn: !!(req.user || (req.session && req.session.clientId)),
    viewerIsOwner:  !!(req.user && String(req.user._id) === String(company.owner)),
    reviews,
    avgRating,
    reviewCount,
    isOpenToday,
    cs,
    gallery:   cs.gallery   || [],
    equipment: cs.equipment || [],
    amenityOptions: AMENITY_OPTIONS,
    badgeOptions: BADGE_OPTIONS,
    prepaymentConfig,
    stripePublishableKey: _spk,
    visitorIsAdmin,
    alwaysSticky: true,
    clientAuth: true,
  });
});

module.exports = router;
