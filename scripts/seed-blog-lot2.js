/**
 * Six articles de blog, programmés un par semaine.
 *
 * RÈGLES TENUES EN LES ÉCRIVANT — les mêmes que pour le premier lot :
 *   · le titre pose une question, le texte y répond dès le premier paragraphe ;
 *   · aucune statistique inventée. Pas de « 30 % de no-shows en moins » : ces
 *     chiffres circulent partout sans source, et un pro qui vérifie ne trouve
 *     rien. On décrit des mécanismes, pas des pourcentages ;
 *   · aucun prix de concurrent, aucune comparaison nominative ;
 *   · BranShee n'apparaît qu'à la fin, une fois la question réellement traitée.
 *     Un article qui vend dès la deuxième ligne ne se lit pas jusqu'au bout,
 *     et Google mesure si les gens restent.
 *
 * Les sujets évitent les cinq déjà publiés (coût d'un logiciel, no-shows,
 * WhatsApp, Google, kinésithérapeutes).
 *
 * Usage :
 *   node scripts/seed-blog-lot2.js              → aperçu, n'écrit rien
 *   node scripts/seed-blog-lot2.js --apply      → écrit en base
 *   node scripts/seed-blog-lot2.js --apply --prod
 *
 * Idempotent : un article dont le slug existe déjà est laissé intact.
 */
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const PROD = process.argv.includes("--prod");
const env = require(`../environment/${PROD ? "production" : "development"}`);
const Article = require("../db/models/article.model");

// Premier lundi à 09h00 au moins 7 jours après le lancement du script, puis
// un article par semaine. Publier « maintenant » les six d'un coup serait
// exactement le pic que le référencement ne récompense pas.
function lundisSuccessifs(n) {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const j = new Date(d);
    j.setDate(d.getDate() + i * 7);
    return j;
  });
}

const ARTICLES = [
  {
    slug: "acompte-rendez-vous-independant",
    title: "Faut-il demander un acompte pour ses rendez-vous ?",
    category: "Gérer son agenda",
    tags: ["acompte", "paiement", "no-show"],
    excerpt:
      "Oui, mais pas partout ni pour tout le monde. Voici quand l'acompte protège vraiment votre agenda, et quand il vous coûte des clients.",
    metaTitle: "Acompte pour un rendez-vous : quand le demander (et quand éviter)",
    metaDescription:
      "Faut-il demander un acompte à ses clients ? Les cas où ça protège votre agenda, ceux où ça fait fuir, et comment l'annoncer sans crisper.",
    contentHtml: `
<p>Réponse courte : l'acompte fonctionne sur les prestations longues et les nouveaux clients. Sur une prestation courte payée par une habituée, il crée une friction pour un risque qui n'existe pas.</p>

<h2>Ce que l'acompte règle vraiment</h2>
<p>Un acompte ne rend pas un client plus ponctuel. Il fait deux choses, et seulement deux : il vous dédommage quand la place reste vide, et il élimine les réservations faites sans intention réelle de venir. Ce second effet est le plus important. Quelqu'un qui bloque un créneau « pour voir » ne sort pas sa carte.</p>

<h2>Les trois cas où il se justifie</h2>
<p><strong>Les prestations longues.</strong> Deux heures perdues ne se rattrapent pas dans la journée. Plus le créneau est difficile à recaser, plus l'acompte se défend.</p>
<p><strong>Les nouveaux clients.</strong> Vous n'avez aucun historique avec eux. C'est là que le risque se concentre, et c'est là que la demande passe le mieux : ils ne connaissent pas encore vos habitudes, donc rien ne leur paraît anormal.</p>
<p><strong>Les créneaux rares.</strong> Le samedi, la fin de journée. Ceux qu'on vous réclame et qui, laissés vides, vous coûtent le plus.</p>

<h2>Les cas où il vous coûte plus qu'il ne rapporte</h2>
<p>Sur une prestation de trente minutes à petit prix, l'acompte ajoute une étape de paiement pour couvrir une somme modeste. Vous perdrez plus de réservations que d'absences évitées.</p>
<p>Sur une cliente qui vient depuis trois ans, c'est un message de défiance. Elle le lira comme tel.</p>

<h2>Comment l'annoncer sans crisper</h2>
<p>La formulation compte plus que le montant. « Un acompte de 10 € est demandé à la réservation, déduit du prix final » passe. « Acompte obligatoire non remboursable » fait reculer.</p>
<p>Trois principes tiennent :</p>
<ul>
<li><strong>Dites qu'il est déduit.</strong> Ce n'est pas un supplément, c'est une avance. Beaucoup de clients ne le comprennent pas spontanément.</li>
<li><strong>Annoncez-le avant le choix du créneau</strong>, pas au moment de payer. Une condition découverte à la dernière étape donne l'impression d'un piège.</li>
<li><strong>Dites ce qui se passe en cas d'annulation.</strong> « Remboursé si vous prévenez 24 h avant » rassure davantage que le silence.</li>
</ul>

<h2>L'alternative : l'empreinte bancaire</h2>
<p>Plutôt que de prélever, vous enregistrez la carte sans rien débiter, et vous ne prélevez qu'en cas d'absence non prévenue. Le client ne paie rien à la réservation — la friction tombe — mais l'engagement est réel.</p>
<p>C'est souvent le bon compromis quand l'acompte vous semble trop dur mais que les absences vous pèsent.</p>

<h2>Commencez par mesurer</h2>
<p>Avant de changer quoi que ce soit : combien d'absences par mois, sur quels créneaux, avec quels clients ? Beaucoup d'indépendants instaurent un acompte général pour deux ou trois absences par mois, toujours aux mêmes horaires. Un acompte ciblé sur ces créneaux-là aurait suffi.</p>

<p>Avec BranShee, l'acompte et l'empreinte bancaire se règlent par prestation : vous pouvez les activer sur vos soins longs et laisser les autres sans friction.</p>
`.trim(),
  },

  {
    slug: "agenda-papier-vers-agenda-en-ligne",
    title: "Passer du carnet papier à l'agenda en ligne : par où commencer ?",
    category: "Choisir son outil",
    tags: ["organisation", "démarrage"],
    excerpt:
      "Pas besoin de tout basculer d'un coup. La méthode en trois semaines qui évite de perdre des rendez-vous — et de perdre ses clients au passage.",
    metaTitle: "Du carnet papier à l'agenda en ligne : la méthode en 3 semaines",
    metaDescription:
      "Comment passer d'un agenda papier à un agenda en ligne sans perdre de rendez-vous ni brusquer vos clients. Une méthode progressive, semaine par semaine.",
    contentHtml: `
<p>La bascule rate presque toujours pour la même raison : on veut tout basculer le même jour. Le carnet part à la poubelle, les clients ne sont pas prévenus, et à la première panne de doute on retourne au papier.</p>
<p>La méthode qui tient est progressive. Comptez trois semaines.</p>

<h2>Semaine 1 : le double affichage</h2>
<p>Vous continuez à noter dans le carnet. En parallèle, vous saisissez les mêmes rendez-vous dans l'agenda en ligne. Oui, c'est du travail en double — mais une seule semaine.</p>
<p>Le but n'est pas de gagner du temps tout de suite : c'est de vérifier que l'outil correspond à votre façon de travailler. Vos durées, vos pauses, vos créneaux du samedi. Si quelque chose coince, vous le découvrez avec le carnet comme filet.</p>

<h2>Semaine 2 : vos horaires et vos prestations</h2>
<p>Réglez ce qui vous est propre avant d'ouvrir aux clients :</p>
<ul>
<li><strong>Vos horaires réels</strong>, pas théoriques. Si vous ne prenez personne le lundi matin, bloquez-le.</li>
<li><strong>Vos durées vraies.</strong> C'est l'erreur la plus fréquente : on annonce 30 minutes pour une prestation qui en prend 45, et l'agenda déborde dès le troisième client.</li>
<li><strong>Vos temps morts.</strong> Le nettoyage entre deux clients, la pause déjeuner. Un agenda qui les ignore vous fait travailler sans respirer.</li>
</ul>
<p>Prenez le temps sur ce point. Un agenda mal réglé produit des journées invivables, et vous en conclurez à tort que l'outil ne vaut rien.</p>

<h2>Semaine 3 : ouvrir aux clients</h2>
<p>Vous partagez votre lien. Sur votre bio Instagram, dans votre signature, sur votre fiche Google.</p>
<p>Ne demandez à personne de « passer au numérique ». Dites simplement : <em>« vous pouvez maintenant réserver en ligne ici, ou continuer à m'appeler, comme vous préférez »</em>. Les clients qui préfèrent le téléphone garderont le téléphone — et beaucoup basculeront d'eux-mêmes, parce que réserver à 22 h leur convient mieux qu'appeler entre midi et deux.</p>

<h2>Ce qu'il ne faut pas faire</h2>
<p><strong>Jeter le carnet.</strong> Gardez-le un mois, sans y écrire. Le jour où vous doutez d'un rendez-vous, vous vérifiez, et cette sécurité vous évite de tout abandonner sur un coup de stress.</p>
<p><strong>Reprendre l'historique.</strong> Personne n'a besoin des rendez-vous de l'an dernier. Saisissez ce qui est à venir, rien d'autre.</p>
<p><strong>Tout ouvrir d'un coup.</strong> Vous pouvez n'ouvrir que certaines prestations à la réservation en ligne, et garder les autres sur demande. Rien n'oblige à basculer entièrement.</p>

<h2>Et les clients qui n'aiment pas ça ?</h2>
<p>Il y en aura, et c'est très bien. L'agenda en ligne n'est pas censé remplacer le téléphone : il absorbe les demandes simples — un créneau, une prestation connue — pour que le téléphone reste disponible pour les cas qui le méritent.</p>
<p>Le bon indicateur, au bout d'un mois, n'est pas « combien de clients réservent en ligne » mais « combien d'appels en moins pendant que je travaille ».</p>

<p>BranShee est gratuit pour démarrer, sans carte bancaire : vous pouvez faire votre semaine 1 en double sans rien engager.</p>
`.trim(),
  },

  {
    slug: "gerer-ses-conges-quand-on-est-seul",
    title: "Comment prendre des vacances quand on est seul à travailler ?",
    category: "Gérer son agenda",
    tags: ["congés", "organisation"],
    excerpt:
      "Fermer une semaine coûte cher, mais mal la préparer coûte plus cher encore. Ce qu'il faut régler avant de partir.",
    metaTitle: "Prendre des vacances quand on est indépendant seul : le guide",
    metaDescription:
      "Comment préparer ses congés quand on travaille seul : à quel moment prévenir, comment éviter les réservations pendant l'absence, comment relancer au retour.",
    contentHtml: `
<p>Le vrai coût des vacances, quand on est seul, ce n'est pas la semaine fermée. C'est la semaine d'après : un agenda vide parce que les clients ont pris ailleurs, et une semaine d'avant surchargée parce que tout le monde a voulu passer avant votre départ.</p>
<p>Ces deux effets se préparent.</p>

<h2>Bloquez vos dates avant de les annoncer</h2>
<p>Dans l'ordre : d'abord vous fermez les créneaux, ensuite vous prévenez. L'inverse produit une ruée sur les derniers créneaux disponibles, et vous finissez par accepter des rendez-vous que vous ne vouliez pas.</p>
<p>Bloquez aussi le jour du retour. Rentrer et enchaîner cinq clients dans la foulée est le meilleur moyen de commencer épuisé.</p>

<h2>Prévenez à deux moments, pas un</h2>
<p><strong>Trois à quatre semaines avant</strong>, pour ceux qui viennent régulièrement : ils ont le temps de caler leur rendez-vous avant ou après.</p>
<p><strong>Quelques jours avant</strong>, pour tout le monde : un rappel court, sur le canal où vos clients vous lisent vraiment.</p>
<p>Une seule annonce, trop tôt, sera oubliée. Trop tard, elle ne laisse pas le choix.</p>

<h2>Le point qu'on oublie : les réservations pendant l'absence</h2>
<p>Si vous prenez les rendez-vous par message, quelqu'un vous écrira pendant vos congés — et découvrira votre réponse cinq jours plus tard. C'est une réservation perdue, souvent partie chez un confrère entre-temps.</p>
<p>Deux façons de traiter ça :</p>
<ul>
<li><strong>Laisser la réservation ouverte pour les dates d'après.</strong> Vos créneaux fermés n'apparaissent pas, mais ceux du retour se remplissent pendant que vous êtes absent. C'est le plus efficace, et ça règle aussi la semaine creuse au retour.</li>
<li><strong>Un message d'absence clair</strong>, avec la date exacte de retour. « Je réponds à partir du 12 » vaut mieux que « je suis en congés ».</li>
</ul>

<h2>Préparez le retour avant de partir</h2>
<p>La semaine qui suit les vacances est celle qui décide si vos congés vous ont coûté ou non. Deux gestes simples :</p>
<p>Avant de partir, proposez à vos habitués de caler leur prochain rendez-vous après votre retour. Beaucoup diront oui — et votre semaine de reprise sera déjà à moitié remplie.</p>
<p>Et prévoyez un créneau tampon le premier jour : il y aura des demandes en attente, des messages à traiter, et personne n'est efficace en sortant de deux semaines d'arrêt.</p>

<h2>Fermer moins longtemps, plus souvent</h2>
<p>Beaucoup d'indépendants tiennent une seule grosse coupure annuelle, et la redoutent. Deux fermetures plus courtes se préparent mieux, se rattrapent plus vite, et pèsent moins sur la trésorerie.</p>
<p>À trancher selon votre activité — mais c'est une option qu'on n'envisage souvent pas.</p>

<p>Sur BranShee, vos congés se posent sur une plage de dates, avec des horaires spéciaux si vous ne fermez qu'une partie de la journée. Les créneaux concernés disparaissent de votre page de réservation, mais ceux d'après restent ouverts.</p>
`.trim(),
  },

  {
    slug: "ou-mettre-son-lien-de-reservation",
    title: "Où mettre son lien de réservation pour qu'il serve vraiment ?",
    category: "Se faire connaître",
    tags: ["instagram", "google", "réservation"],
    excerpt:
      "Avoir un lien ne suffit pas. Les endroits où il est réellement cliqué, et ceux où il dort depuis des mois.",
    metaTitle: "Où placer son lien de réservation en ligne : les endroits qui marchent",
    metaDescription:
      "Instagram, Google, signature d'e-mail, carte de visite : où mettre son lien de réservation pour qu'il soit vu et cliqué. Ce qui fonctionne, ce qui ne sert à rien.",
    contentHtml: `
<p>Un lien de réservation ne travaille que là où quelqu'un se demande déjà « est-ce que je prends rendez-vous ? ». Placé ailleurs, il ne se passe rien — et on en conclut à tort que la réservation en ligne ne prend pas.</p>

<h2>La fiche Google : le premier endroit, sans discussion</h2>
<p>C'est là que les gens vous cherchent, souvent sans connaître votre nom : « coiffeur » plus le nom du quartier. Ils tombent sur votre fiche et cherchent comment vous joindre.</p>
<p>Votre fiche Google d'établissement accepte un lien de réservation. C'est le placement qui rapporte le plus, parce que l'intention est déjà là : personne ne consulte une fiche par curiosité.</p>
<p>Si vous ne deviez en faire qu'un seul, c'est celui-là.</p>

<h2>La bio Instagram : oui, mais avec le bon libellé</h2>
<p>Le lien en bio fonctionne, à condition qu'on comprenne où il mène. « Mon site » ne dit rien. « Réserver » dit tout.</p>
<p>Instagram propose aussi un bouton d'action sur les profils professionnels : plus visible que la ligne de bio, et compris immédiatement.</p>
<p>Un point qui change tout : <strong>remettez le lien dans vos stories</strong>. Une bio, on la regarde une fois. Une story se consulte le soir, exactement au moment où quelqu'un se dit qu'il faudrait prendre rendez-vous.</p>

<h2>Votre signature d'e-mail</h2>
<p>Sous-estimé, et gratuit. Chaque message que vous envoyez porte le lien. Sur un an, ça représente beaucoup de rappels passifs, sans rien demander à personne.</p>

<h2>Les endroits où le lien ne sert à rien</h2>
<p><strong>Une publication unique.</strong> Un post qui annonce « vous pouvez maintenant réserver en ligne » sera vu une fois puis enseveli. Ce n'est pas une annonce, c'est un moyen permanent — il doit vivre à un endroit stable.</p>
<p><strong>Un QR code sans contexte.</strong> Un QR code seul sur une affiche ne dit pas ce qu'il fait. Avec « Réservez votre prochain rendez-vous » à côté, il est scanné.</p>
<p><strong>Un lien trop long.</strong> Une adresse à rallonge ne se retient pas et ne se dicte pas. Un lien court à votre nom se lit au téléphone et s'imprime sur une carte.</p>

<h2>Le moment qui compte le plus</h2>
<p>Le meilleur endroit n'est pas en ligne : c'est <strong>la fin du rendez-vous</strong>. Le client est satisfait, il vient de vivre la prestation. C'est là qu'on prend le suivant.</p>
<p>Une carte avec votre lien, ou simplement « je vous envoie le lien pour la prochaine fois ». Aucun canal numérique n'a un taux de réponse comparable à ce moment-là.</p>

<h2>Vérifiez qu'il marche depuis un téléphone</h2>
<p>La majorité de vos clients cliqueront depuis un mobile, souvent le soir. Testez le parcours complet vous-même : le lien, le choix du créneau, la confirmation. Si une étape coince sur un petit écran, vous perdez des réservations sans jamais le savoir.</p>

<p>Avec BranShee, votre lien prend la forme <code>branshee.com/votre-nom</code> — assez court pour se dicter au téléphone et tenir sur une carte de visite.</p>
`.trim(),
  },

  {
    slug: "fixer-ses-tarifs-independant",
    title: "Comment fixer ses tarifs quand on démarre ?",
    category: "Conseils",
    tags: ["tarifs", "démarrage"],
    excerpt:
      "Ni au hasard, ni en copiant le voisin. La méthode par le calcul, et pourquoi le prix bas est le piège le plus courant.",
    metaTitle: "Fixer ses tarifs quand on est indépendant : la méthode par le calcul",
    metaDescription:
      "Comment calculer ses tarifs d'indépendant à partir de ses charges et de ses heures facturables — et pourquoi s'aligner sur la concurrence est une mauvaise base.",
    contentHtml: `
<p>La plupart des indépendants fixent leur premier tarif en regardant ce que font les autres, puis en retirant un peu « pour commencer ». C'est le point de départ le plus risqué : vous héritez des contraintes d'un confrère dont vous ne connaissez ni les charges, ni le loyer, ni le volume.</p>
<p>Le prix se calcule d'abord, se compare ensuite.</p>

<h2>Partez de ce que vous devez gagner</h2>
<p>Trois nombres suffisent :</p>
<ul>
<li><strong>Vos charges annuelles.</strong> Loyer, matériel, assurances, cotisations, comptable, logiciels, formation.</li>
<li><strong>Le revenu que vous voulez vous verser</strong>, net, sur l'année.</li>
<li><strong>Vos heures réellement facturables.</strong> C'est ici que tout se joue.</li>
</ul>
<p>Charges plus revenu souhaité, divisé par les heures facturables : vous obtenez le prix plancher de votre heure de travail.</p>

<h2>Le piège des heures facturables</h2>
<p>Si vous travaillez 35 heures par semaine, vous n'en facturez pas 35. Il y a l'administratif, les déplacements, le nettoyage, les réseaux sociaux, les créneaux que personne ne réserve.</p>
<p>Compter toutes vos heures comme facturables produit un tarif trop bas — et c'est l'erreur de calcul la plus répandue chez ceux qui démarrent.</p>
<p>Retirez aussi vos congés et vos jours de maladie. Personne ne vous les paiera.</p>

<h2>Alors seulement, regardez autour</h2>
<p>Une fois votre plancher connu, comparez. Trois situations :</p>
<p><strong>Votre calcul donne moins que le marché.</strong> Alignez-vous sur le marché. Vous vous sous-évaluiez.</p>
<p><strong>Votre calcul donne à peu près la même chose.</strong> Bon signe : votre structure de coûts ressemble à celle du métier.</p>
<p><strong>Votre calcul donne nettement plus.</strong> Ne baissez pas mécaniquement. Cherchez d'abord pourquoi : charges trop lourdes, trop peu d'heures facturables, objectif de revenu irréaliste ? Baisser le prix pour « rentrer dans le marché » sans corriger la cause revient à travailler à perte en connaissance de cause.</p>

<h2>Pourquoi le prix bas ne fait pas décoller</h2>
<p>L'idée paraît logique : commencer moins cher pour attirer, augmenter ensuite. En pratique elle se retourne souvent.</p>
<p>Un prix bas attire une clientèle sensible au prix — celle qui partira au premier concurrent moins cher. Vous construisez une base que vous perdrez précisément le jour où vous augmenterez.</p>
<p>Et augmenter est plus difficile qu'on ne croit : chaque hausse doit être annoncée à des gens habitués à l'ancien tarif.</p>

<h2>Ce qui marche mieux qu'un prix bas</h2>
<p>Un tarif juste, avec une raison claire de venir chez vous : un créneau que personne d'autre ne propose, une spécialité, un accueil. Ce sont des arguments qui ne s'effritent pas quand un concurrent casse ses prix.</p>

<h2>Augmenter : deux règles</h2>
<p><strong>Prévenez à l'avance</strong>, quelques semaines. Découvrir une hausse en payant est ce qui fait partir les gens — pas la hausse elle-même.</p>
<p><strong>Ne vous justifiez pas trop.</strong> « Mes tarifs évoluent au 1er mars » suffit. Un long paragraphe d'excuses suggère que vous n'y croyez pas vous-même.</p>

<p>Sur BranShee, chaque prestation porte son prix et sa durée : vos clients voient le tarif avant de réserver, ce qui évite les surprises à la caisse.</p>
`.trim(),
  },

  {
    slug: "reservation-en-ligne-clients-ages",
    title: "Mes clients sont âgés : la réservation en ligne peut-elle marcher ?",
    category: "Choisir son outil",
    tags: ["clients", "accessibilité"],
    excerpt:
      "C'est l'objection la plus fréquente, et elle repose sur une idée fausse. Ce qui bloque vraiment, et comment le lever.",
    metaTitle: "Réservation en ligne et clientèle âgée : ce qui marche vraiment",
    metaDescription:
      "« Mes clients sont trop âgés pour réserver en ligne » : pourquoi l'âge n'est pas le vrai obstacle, et comment mettre en place la réservation sans perdre personne.",
    contentHtml: `
<p>« Ça ne marchera pas chez moi, ma clientèle est âgée. » C'est l'objection numéro un, et elle mélange deux choses très différentes : savoir utiliser un téléphone, et avoir envie de changer une habitude.</p>
<p>Le premier point est rarement le problème. Le second, presque toujours.</p>

<h2>Ce qui bloque réellement</h2>
<p>Une personne de 70 ans qui envoie des photos à ses petits-enfants sait remplir un formulaire de trois champs. Ce qui la fait renoncer, ce n'est pas la technique :</p>
<ul>
<li><strong>La peur de mal faire.</strong> « Et si je me trompe de créneau ? » Sans confirmation immédiate, le doute reste.</li>
<li><strong>La création de compte.</strong> C'est là qu'on perd le plus de monde, tous âges confondus. Devoir choisir un mot de passe pour prendre rendez-vous chez son coiffeur décourage largement.</li>
<li><strong>L'habitude.</strong> Elle vous appelle depuis quinze ans. Elle continuera, et c'est parfaitement légitime.</li>
</ul>

<h2>La bonne question n'est pas celle-là</h2>
<p>L'objectif n'a jamais été que 100 % de vos clients réservent en ligne. C'est que <strong>ceux qui le peuvent cessent de vous appeler pendant que vous travaillez</strong>.</p>
<p>Même avec une clientèle très âgée, il reste les enfants qui prennent rendez-vous pour leurs parents, les nouveaux clients trouvés sur Google, et ceux qui pensent à vous à 22 h — quand votre téléphone est éteint.</p>
<p>Ces réservations-là n'existaient pas avant. Elles ne remplacent aucun appel : elles s'ajoutent.</p>

<h2>Trois réglages qui changent tout</h2>
<p><strong>Pas de compte obligatoire.</strong> Nom, e-mail, c'est tout. Chaque champ supplémentaire fait abandonner du monde.</p>
<p><strong>Une confirmation immédiate</strong>, à l'écran puis par e-mail. C'est ce qui lève la peur de s'être trompé, et ça supprime l'appel de vérification qui suit.</p>
<p><strong>Un lien court.</strong> Une adresse qu'on peut dicter au téléphone, à lire sans lunettes.</p>

<h2>Comment l'introduire</h2>
<p>Surtout pas d'annonce solennelle du type « nous passons à la réservation en ligne ». Ça sonne comme une contrainte, et ça inquiète ceux qui pensent qu'on va leur retirer le téléphone.</p>
<p>La formule qui passe, en fin de rendez-vous : <em>« si un jour ça vous arrange, vous pouvez aussi réserver ici — mais appelez-moi quand vous voulez, ça ne change rien »</em>.</p>
<p>Vous verrez : certains essaieront par curiosité, et une partie ne reviendra pas au téléphone. Sans qu'on leur ait rien imposé.</p>

<h2>Gardez le téléphone, vraiment</h2>
<p>Un pro qui met en ligne et arrête de décrocher perd des clients. La réservation en ligne absorbe les demandes simples pour que le téléphone reste disponible pour le reste — pas pour le remplacer.</p>
<p>Vous pouvez d'ailleurs saisir vous-même les rendez-vous pris par téléphone : tout se retrouve au même endroit, et vous ne tenez plus deux agendas en parallèle.</p>

<h2>Un test avant de conclure</h2>
<p>Avant de décider que votre clientèle n'y arrivera pas, faites l'essai avec trois clients. Pas trente : trois. Vous saurez en une semaine si l'obstacle est réel ou supposé.</p>
<p>Le plus souvent, la surprise vient de ceux dont on n'attendait rien.</p>

<p>BranShee ne demande aucun compte à vos clients : nom, e-mail, et c'est réservé. La confirmation part immédiatement.</p>
`.trim(),
  },
];

function minutesDeLecture(html) {
  const mots = html.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(mots / 200)); // ~200 mots/minute en lecture écran
}

(async () => {
  await mongoose.connect(env.dbUri);
  const dates = lundisSuccessifs(ARTICLES.length);

  console.log(`Base : ${PROD ? "PRODUCTION" : "développement"}`);
  console.log(APPLY ? "Mode : ÉCRITURE\n" : "Mode : APERÇU (rien n'est écrit)\n");

  let crees = 0;
  let ignores = 0;

  for (let i = 0; i < ARTICLES.length; i++) {
    const a = ARTICLES[i];
    const quand = dates[i];
    const existe = await Article.findOne({ slug: a.slug }).select("_id").lean();

    if (existe) {
      console.log(`= déjà en base : ${a.slug}`);
      ignores++;
      continue;
    }

    const lecture = minutesDeLecture(a.contentHtml);
    console.log(`+ ${quand.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} 09h00 · ${lecture} min · ${a.title}`);

    if (APPLY) {
      await Article.create({
        title: a.title,
        slug: a.slug,
        excerpt: a.excerpt,
        contentHtml: a.contentHtml,
        category: a.category,
        tags: a.tags,
        status: "draft",
        scheduledFor: quand,
        seo: { metaTitle: a.metaTitle, metaDescription: a.metaDescription },
        authorName: "L'équipe BranShee",
        readingMinutes: lecture,
      });
      crees++;
    }
  }

  console.log(`\n${APPLY ? crees + " créé(s)" : ARTICLES.length - ignores + " à créer"}, ${ignores} ignoré(s).`);
  if (!APPLY) console.log("Relancez avec --apply pour écrire.");
  await mongoose.disconnect();
})().catch((e) => {
  console.error("ERREUR :", e.message);
  process.exit(1);
});
