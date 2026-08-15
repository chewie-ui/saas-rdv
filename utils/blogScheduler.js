// ── Publication programmée des articles de blog ────────────────────────────
//
// Le référencement récompense la RÉGULARITÉ, pas les à-coups. Or personne ne
// tient une régularité qui dépend de s'en souvenir un mardi matin. Ce cron
// permet d'écrire plusieurs articles d'affilée, de leur donner une date, et de
// les laisser sortir un par un.
//
// Il automatise la PUBLICATION, jamais la rédaction. C'est délibéré : générer
// du texte en série pour remplir un calendrier est précisément ce que Google
// nomme « scaled content abuse » dans ses règles anti-spam, et il déclasse les
// sites qui le font. Un article par semaine écrit sérieusement bat trente
// articles fabriqués — l'automatisation ne doit pas transformer un atout en
// sanction.
const cron = require("node-cron");
const Article = require("../db/models/article.model");
const { signaler } = require("./indexNow");

/**
 * Publie les brouillons dont la date programmée est arrivée.
 *
 * Un article à la fois plutôt qu'un `updateMany` : chacun doit passer par le
 * hook `pre('save')` du modèle (qui renseigne `publishedAt`) et être signalé
 * individuellement aux moteurs. Un lot en base court-circuiterait les deux.
 *
 * @returns {Promise<number>} nombre d'articles publiés
 */
async function publierArticlesDus() {
  const maintenant = new Date();

  const dus = await Article.find({
    status: "draft",
    scheduledFor: { $ne: null, $lte: maintenant },
  }).limit(20); // garde-fou : un import massif ne doit pas tout sortir d'un coup

  if (!dus.length) return 0;

  let publies = 0;
  for (const article of dus) {
    try {
      article.status = "published";
      // La date affichée est celle qu'on avait PRÉVUE, pas celle du réveil du
      // cron : un article programmé à 09h00 ne doit pas s'afficher « 09h07 »
      // parce que la tâche tourne au quart d'heure.
      article.publishedAt = article.scheduledFor;
      article.scheduledFor = null;
      await article.save();

      // Signalement aux moteurs (IndexNow). `signaler` attend un TABLEAU, et
      // on prévient aussi l'index du blog : sa liste vient de changer.
      // Volontairement non attendu — la réponse d'un moteur ne doit pas
      // retarder la publication suivante, ni son échec annuler une
      // publication déjà écrite en base.
      if (article.slug) {
        signaler([`/blog/${article.slug}`, "/blog"])
          .then((r) => { if (!r.envoye) console.warn("[blogScheduler] IndexNow non envoyé:", r.motif || r.statut); })
          .catch((e) => console.error("[blogScheduler] IndexNow:", e.message));
      }

      publies++;
      console.log(`[blogScheduler] publié : ${article.slug}`);
    } catch (err) {
      // Un article en échec ne doit pas bloquer les suivants — il repassera au
      // prochain tour, sa date restant dans le passé.
      console.error(`[blogScheduler] échec sur ${article.slug}:`, err.message);
    }
  }
  return publies;
}

/**
 * Toutes les quinze minutes. Ni plus fin (l'heure exacte de mise en ligne n'a
 * aucune importance pour le référencement), ni quotidien (programmer un
 * article à 09h00 doit vouloir dire 09h00, pas « dans la nuit »).
 */
function start() {
  cron.schedule("*/15 * * * *", () => {
    publierArticlesDus().catch((err) =>
      console.error("[blogScheduler] Erreur tâche ❌", err),
    );
  });
  console.log("[blogScheduler] programmateur d'articles démarré");
}

module.exports = { start, publierArticlesDus };
