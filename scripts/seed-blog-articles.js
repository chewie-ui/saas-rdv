/**
 * Publie les premiers articles du blog.
 *
 * Le blog était en ligne mais vide : Google n'avait donc rien à indexer, et
 * un visiteur qui cliquait sur « Blog » tombait sur une page morte.
 *
 * Idempotent : chaque article est repéré par son slug. Relancer le script
 * met à jour le contenu sans créer de doublon et sans toucher à la date de
 * première publication (sinon un article ancien remonterait en tête à chaque
 * exécution).
 *
 *   node scripts/seed-blog-articles.js            # aperçu, n'écrit rien
 *   node scripts/seed-blog-articles.js --apply    # écrit en base
 *   node scripts/seed-blog-articles.js --apply --prod
 *
 * `--purge-tests` retire en plus les deux articles de démonstration écrits
 * pendant la construction du blog : trois paragraphes chacun, ils tirent la
 * qualité moyenne du blog vers le bas et Google traite ce genre de page
 * comme du contenu creux.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Article = require("../db/models/article.model");
const { sanitizeArticleHtml } = require("../utils/sanitizeArticleHtml");

const APPLIQUER = process.argv.includes("--apply");
const PROD = process.argv.includes("--prod");
const PURGER = process.argv.includes("--purge-tests");
const URI = PROD ? process.env.MONGO_URI_SERVER : process.env.MONGO_URI_LOCAL;

// Articles de démonstration à retirer (voir --purge-tests).
const SLUGS_TEST = [
  "reduire-les-rendez-vous-manques-ce-qui-marche-vraiment",
  "agenda-en-ligne-pour-kinesitherapeutes-ce-qu-il-faut-regarder",
];

/* ════════════════════════════════════════════════════════════════════════════
   LES ARTICLES

   Trois règles tenues sur chacun :
   1. Répondre pour de vrai à la question posée dans le titre. Un article qui
      ne sert qu'à placer un lien ne se positionne pas et ne convertit pas.
   2. Aucun chiffre inventé. Les ordres de grandeur sont présentés comme des
      exemples de calcul, jamais comme des statistiques mesurées.
   3. Ne jamais citer un tarif concurrent : il change sans prévenir, et une
      page publique qui ment sur un prix se retourne contre nous.

   Les illustrations sont des SVG faits maison (public/images/blog/) : légers,
   nets à toutes les tailles, et ils ne dépendent d'aucune banque d'images.
   ═══════════════════════════════════════════════════════════════════════════ */

const ARTICLES = [
  {
    slug: "combien-coute-un-logiciel-de-prise-de-rendez-vous",
    title: "Combien coûte vraiment un logiciel de prise de rendez-vous ?",
    category: "Choisir son outil",
    tags: ["tarifs", "comparatif", "logiciel"],
    coverImage: "/images/blog/cover-prix.svg",
    excerpt:
      "Abonnement, commission, gratuit avec annuaire : les quatre modèles de tarification n'ont pas du tout le même coût réel. Le calcul complet, les coûts qu'on oublie, et les questions à poser avant de signer.",
    seo: {
      metaTitle: "Prix d'un logiciel de prise de rendez-vous : le vrai calcul",
      metaDescription:
        "Abonnement fixe, commission par réservation, formule gratuite : comprendre ce que chaque modèle vous coûte réellement à l'année, avec un calcul concret et les frais cachés.",
    },
    contentHtml: `
<p>La question revient dans presque tous les échanges qu'on a avec des indépendants : « c'est combien ? ». Et la réponse honnête, c'est que le prix affiché ne veut pas dire grand-chose tant qu'on n'a pas regardé <strong>comment</strong> il est calculé. Deux outils qui annoncent le même tarif mensuel peuvent vous coûter du simple au décuple à la fin de l'année.</p>

<p>Cet article ne compare pas des marques. Il compare des <em>modèles économiques</em> — parce que c'est le modèle, pas le logo, qui détermine ce que vous allez payer. À la fin, vous aurez de quoi calculer votre propre chiffre en dix minutes.</p>

<h2>Les quatre façons de vous facturer</h2>

<h3>1. L'abonnement fixe</h3>
<p>Vous payez un montant par mois, quel que soit votre volume. C'est le modèle le plus courant et le plus lisible : vous savez en janvier ce que vous paierez en décembre, et si votre activité double, votre facture ne bouge pas.</p>
<p>Le piège se cache ailleurs : dans le <strong>découpage par palier</strong>. Beaucoup d'outils facturent par utilisateur, ou débloquent les rappels SMS, l'export comptable, la gestion de plusieurs employés ou la page de réservation personnalisée uniquement à partir d'une formule supérieure. Le tarif d'appel sert à vous faire entrer, pas à vous faire travailler.</p>
<p>La bonne méthode : avant de comparer deux prix, listez les cinq fonctions dont vous ne pourrez pas vous passer, puis regardez dans quelle formule elles tombent <em>chacune</em>. C'est le prix de la formule la plus haute de votre liste qu'il faut comparer, pas celui affiché en gros sur la page d'accueil.</p>

<h3>2. La commission par réservation</h3>
<p>L'outil ne vous prend rien à l'installation, mais prélève un pourcentage sur chaque rendez-vous. C'est très confortable au démarrage, et c'est exactement là que le calcul devient trompeur : la facture grandit au rythme de votre réussite.</p>
<p>Prenons un exemple. Vous facturez une prestation 45 €, vous en réalisez 60 par mois, et la commission est de 20 % :</p>
<ul>
  <li>60 × 45 € = <strong>2 700 €</strong> de chiffre d'affaires mensuel</li>
  <li>Commission : 2 700 × 20 % = <strong>540 € par mois</strong></li>
  <li>Sur l'année : <strong>6 480 €</strong></li>
</ul>
<p>Le même volume sur un abonnement fixe à 30 € par mois coûte 360 € à l'année. L'écart n'est pas de quelques euros : il représente plusieurs semaines de travail.</p>

<figure>
  <img src="/images/blog/figure-cout-annuel.svg" alt="Graphique du coût cumulé sur douze mois : la commission grimpe jusqu'à 6 480 €, l'abonnement fixe reste à 360 €." width="900" height="420" />
  <figcaption>Le même volume d'activité, deux modèles de facturation. L'écart se creuse chaque mois.</figcaption>
</figure>

<p>La commission a un vrai sens dans un seul cas : quand la plateforme vous <strong>apporte</strong> des clients que vous n'auriez pas eus. Payer 20 % à un annuaire qui vous amène un nouveau visage, ça se défend — c'est un coût d'acquisition, et il est même plutôt raisonnable comparé à de la publicité. Payer 20 % sur la cliente qui vient chez vous depuis six ans et qui a simplement cliqué sur un lien, beaucoup moins.</p>
<p>Si vous êtes sur ce modèle, posez-vous la question tous les six mois : <em>quelle part de mes réservations vient de clients que la plateforme m'a réellement amenés ?</em> Le jour où la réponse tombe sous les 20 ou 30 %, le modèle ne joue plus en votre faveur.</p>

<h3>3. Le gratuit financé par la place de marché</h3>
<p>Certains outils sont gratuits pour vous parce que vous n'êtes pas le client : vous êtes le stock. Votre fiche vit dans un annuaire où vos concurrents apparaissent juste en dessous, et où la mise en avant se paie.</p>
<p>Ça peut valoir le coup si vous démarrez et que vous avez besoin de visibilité plus que d'autonomie. Mais posez trois questions avant de vous installer :</p>
<ul>
  <li><strong>Emportez-vous votre fichier client si vous partez ?</strong> Si la réponse est non, le prix réel de la gratuité, c'est votre dépendance.</li>
  <li><strong>Vos clients réservent-ils chez vous, ou sur la plateforme ?</strong> La nuance paraît sémantique ; elle décide de qui possède la relation.</li>
  <li><strong>Que se passe-t-il si la mise en avant devient payante ?</strong> Un outil gratuit qui prend de l'ampleur finit par devoir se financer.</li>
</ul>

<h3>4. Le gratuit avec limite d'usage</h3>
<p>Une formule gratuite réellement utilisable, plafonnée à un certain nombre de rendez-vous ou de fonctionnalités, et un abonnement quand vous dépassez. C'est le modèle le plus sain pour tester : vous voyez si l'outil vous convient sur vos vrais rendez-vous, pas sur une démo préparée pour bien se présenter.</p>
<p>Le point de vigilance ici, c'est le <strong>moment du basculement</strong>. Regardez à quel seuil vous sortez du gratuit et ce que coûte la marche suivante. Un plafond très bas suivi d'un abonnement cher, c'est une période d'essai déguisée.</p>

<h2>Les coûts qu'on oublie systématiquement</h2>

<p>Le tarif affiché n'est jamais le coût complet. Regardez aussi :</p>
<ul>
  <li><strong>Les SMS.</strong> Presque toujours facturés à l'unité, en plus de l'abonnement. À raison d'un rappel par rendez-vous et de 60 rendez-vous par mois, ça devient une ligne de budget à part entière — vérifiez le prix unitaire, s'il existe un quota inclus, et si vous pouvez basculer sur un canal moins cher.</li>
  <li><strong>Les frais de paiement en ligne.</strong> Si vous encaissez un acompte, le processeur de paiement prend sa part, indépendamment du logiciel. C'est normal, mais ça doit entrer dans le calcul.</li>
  <li><strong>Le temps de mise en route.</strong> Un outil qui demande deux jours de paramétrage vous coûte deux jours de chiffre d'affaires. C'est souvent le poste le plus cher, et jamais celui qu'on compare. Demandez toujours : « en combien de temps mon premier rendez-vous peut-il être pris ? »</li>
  <li><strong>La formation de l'équipe.</strong> Si vous êtes trois, comptez le temps de chacun.</li>
  <li><strong>La sortie.</strong> Pouvez-vous exporter vos clients et votre historique dans un fichier lisible ? Si ce n'est pas prévu, changer d'avis vous coûtera cher plus tard — et vous le découvrirez au pire moment.</li>
</ul>

<h2>Trois profils, trois bons choix</h2>

<p>Il n'y a pas de meilleur modèle dans l'absolu. Il y a un modèle qui correspond à votre situation.</p>

<h3>Vous démarrez, vous avez peu de clients</h3>
<p>Le gratuit avec limite d'usage, ou une place de marché si votre problème est vraiment la visibilité. À ce stade, une commission sur dix rendez-vous par mois ne coûte pas grand-chose, et un abonnement fixe pèse proportionnellement lourd.</p>

<h3>Vous avez déjà une clientèle, vous voulez arrêter le téléphone</h3>
<p>L'abonnement fixe, sans hésiter — voire la formule gratuite si elle suffit. Vos clients existent déjà : payer une commission pour qu'on vous les « apporte » n'a aucun sens. Ce que vous achetez ici, c'est du temps et la fin des doubles réservations.</p>

<h3>Vous êtes plusieurs, avec des agendas séparés</h3>
<p>Regardez d'abord le mode de facturation par utilisateur : c'est lui qui décide de tout. Un outil à 15 € par personne coûte 45 € à trois et 90 € à six. Comparez-le à un forfait d'établissement, qui devient très vite plus intéressant.</p>

<h2>Les questions à poser avant de signer</h2>

<p>Copiez-les et envoyez-les au support. La qualité des réponses vous en dira autant que la grille tarifaire.</p>
<ul>
  <li>Quelles fonctions sont dans la formule que vous me proposez, et lesquelles nécessitent la formule au-dessus ?</li>
  <li>Les SMS sont-ils inclus ? À quel prix l'unité au-delà ?</li>
  <li>Le tarif est-il par utilisateur ou par établissement ?</li>
  <li>Puis-je exporter mes clients et mes rendez-vous ? Dans quel format ?</li>
  <li>L'engagement est-il mensuel ou annuel ? Comment se résilie-t-il ?</li>
  <li>Le tarif est-il garanti combien de temps ?</li>
</ul>

<h2>Comment décider en dix minutes</h2>

<p>Prenez une feuille et notez trois chiffres : votre nombre de rendez-vous par mois, votre panier moyen, et le nombre de personnes qui doivent accéder à l'agenda. Puis, pour chaque outil envisagé, calculez le <strong>coût annuel complet</strong> — abonnement de la formule qui contient vraiment ce dont vous avez besoin, plus SMS, plus commissions.</p>

<p>Comparez ce total à ce que l'outil vous fait gagner. Un logiciel qui vous évite deux rendez-vous manqués par mois à 45 € récupère 1 080 € sur l'année : il s'est déjà remboursé bien avant qu'on parle de gain de temps.</p>

<h2>Notre position, en toute transparence</h2>

<p>BranShee fonctionne sur le quatrième modèle : une formule gratuite réellement utilisable, sans commission sur vos rendez-vous et sans carte bancaire pour commencer. Vos clients restent vos clients, et vos données sont exportables.</p>

<p>Ce n'est pas le bon choix pour tout le monde, et autant le dire ici. Si vous cherchez avant tout de la visibilité et que vous acceptez d'en payer le prix en commission, une place de marché vous servira mieux — nous ne vous apporterons pas de clients à votre place. Si vous avez déjà une clientèle et que vous voulez simplement arrêter de gérer votre agenda au téléphone, alors oui, c'est exactement ce pour quoi l'outil est fait.</p>
`,
  },

  {
    slug: "reduire-les-rendez-vous-non-honores",
    title: "Rendez-vous non honorés : ce qui marche vraiment (et ce qui ne sert à rien)",
    category: "Gérer son agenda",
    tags: ["no-show", "rappels", "organisation"],
    coverImage: "/images/blog/cover-no-show.svg",
    excerpt:
      "Un créneau vide ne se rattrape jamais. Sept leviers concrets contre les rendez-vous manqués, classés du plus rentable au plus contraignant — et les trois erreurs qui aggravent le problème.",
    seo: {
      metaTitle: "Réduire les rendez-vous non honorés : 7 leviers concrets",
      metaDescription:
        "Rappels, acompte, liste d'attente, politique d'annulation : ce qui réduit réellement les rendez-vous manqués chez un indépendant, dans quel ordre s'y prendre, et ce qu'il ne faut surtout pas faire.",
    },
    contentHtml: `
<p>Un rendez-vous manqué, ce n'est pas juste une heure perdue. C'est une heure que vous avez refusée à quelqu'un d'autre, un déplacement parfois, et une préparation faite pour rien. Contrairement à un produit invendu, un créneau ne se stocke pas : à 15 h 30, l'heure de 15 h est définitivement partie.</p>

<p>La bonne nouvelle, c'est que la grande majorité des absences ne sont pas de la mauvaise foi. Ce sont des oublis. Et un oubli, ça se traite — sans devenir désagréable avec les 95 % de gens qui viennent.</p>

<h2>D'abord, chiffrez votre problème</h2>

<p>Avant de choisir un remède, mesurez. Reprenez les huit dernières semaines et comptez simplement combien de créneaux sont restés vides sans prévenir. Multipliez par votre tarif moyen.</p>

<p>Trois absences par semaine à 45 €, c'est 135 € par semaine, environ 6 000 € sur l'année. Ce chiffre a deux vertus : il vous dit combien vous pouvez raisonnablement investir pour régler le problème, et il vous évite de sortir l'artillerie lourde pour une absence par mois.</p>

<h2>1. Le rappel automatique — le levier de loin le plus rentable</h2>

<p>C'est le premier réflexe, et c'est aussi celui qui a le meilleur rapport effort / résultat. Un message envoyé la veille suffit à récupérer une bonne partie des oublis purs, sans rien demander à personne.</p>

<p>Trois détails changent beaucoup de choses.</p>

<h3>Le moment</h3>
<p>La veille en fin de matinée fonctionne mieux que le matin même : la personne a encore le temps de s'organiser, ou de prévenir si elle ne peut pas venir. Un rappel envoyé deux heures avant arrive trop tard pour que vous puissiez remplir le créneau — vous êtes juste prévenu de votre trou.</p>

<figure>
  <img src="/images/blog/figure-timing-rappel.svg" alt="Ligne de temps : un rappel la veille laisse une longue fenêtre pour replacer le créneau, un rappel deux heures avant n'en laisse aucune." width="900" height="300" />
  <figcaption>Le rappel ne sert pas seulement à faire venir : il sert à libérer le créneau assez tôt.</figcaption>
</figure>

<h3>Le canal</h3>
<p>Un e-mail se noie dans une boîte de réception. Un SMS ou un message WhatsApp est lu dans les minutes qui suivent. Si vous ne devez automatiser qu'une seule chose, automatisez celle-là. Gardez l'e-mail pour la confirmation à la réservation, où le détail compte plus que l'immédiateté.</p>

<h3>Le contenu</h3>
<p>Mettez la date, l'heure, l'adresse, et surtout <strong>un moyen d'annuler en un clic</strong>. Cela paraît contre-intuitif de faciliter l'annulation — c'est pourtant ce qui transforme une absence en créneau libéré, que vous pouvez encore revendre.</p>
<p>Un exemple qui fonctionne : « Bonjour Marie, petit rappel de votre rendez-vous demain mardi à 14 h, au 12 rue des Tanneurs. Un empêchement ? Annulez ici : [lien]. À demain ! »</p>

<h2>2. Rendre l'annulation facile</h2>

<p>Beaucoup de gens ne préviennent pas parce que prévenir est pénible : il faut appeler, tomber sur un répondeur, se justifier auprès de quelqu'un. Alors ils ne font rien, et ils ne viennent pas.</p>

<p>Un lien d'annulation dans le mail de confirmation retourne complètement la situation. Vous préférez mille fois une annulation à 9 h pour un rendez-vous de 14 h qu'un silence radio : la première vous laisse cinq heures pour replacer le créneau, la seconde ne vous laisse rien.</p>

<p>La crainte classique — « si je facilite l'annulation, les gens vont annuler » — ne tient pas à l'usage. Les gens qui annulent ne seraient pas venus de toute façon. Vous ne perdez pas un rendez-vous, vous récupérez de l'information plus tôt.</p>

<h2>3. La confirmation immédiate</h2>

<p>Un rendez-vous pris au téléphone et noté sur un carnet n'existe que dans votre tête et dans la sienne. Un rendez-vous confirmé par écrit dans la minute existe dans son agenda.</p>

<p>Envoyez systématiquement une confirmation, et proposez le fichier d'ajout à l'agenda (Google, Apple, Outlook). Quand le rendez-vous est dans le téléphone de la personne, son téléphone fait le rappel pour vous — gratuitement, et sans que vous ayez rien à gérer.</p>

<h2>4. L'acompte, pour les prestations longues</h2>

<p>C'est efficace, et c'est aussi le levier le plus délicat. Demander 10 ou 20 € à la réservation change radicalement le rapport au rendez-vous : on ne « zappe » pas quelque chose qu'on a déjà payé.</p>

<p>Mais l'acompte a un coût : il crée de la friction et fera renoncer une partie des nouveaux clients, ceux-là mêmes que vous cherchez à attirer. Notre conseil, c'est de ne surtout pas l'appliquer partout :</p>
<ul>
  <li>Sur les prestations <strong>longues ou coûteuses</strong>, où une absence fait vraiment mal — oui.</li>
  <li>Sur un premier rendez-vous de découverte de vingt minutes — probablement pas, vous perdrez plus en réservations que vous ne gagnerez en présence.</li>
  <li>Sur les clients réguliers qui viennent depuis des années — non. C'est un signal de défiance pour un problème que vous n'avez pas avec eux.</li>
</ul>

<h2>5. Une politique d'annulation écrite, et annoncée avant</h2>

<p>« Toute annulation à moins de 24 h est due » ne fonctionne que si la personne l'a lue <em>au moment de réserver</em>, pas quand vous la lui opposez après coup. Affichez-la sur la page de réservation et rappelez-la dans la confirmation.</p>

<p>L'objectif n'est d'ailleurs pas d'encaisser ces pénalités. C'est de faire comprendre que le créneau a de la valeur. Dans la pratique, la simple mention suffit le plus souvent et vous n'aurez jamais à facturer quoi que ce soit — ce qui est exactement le résultat recherché.</p>

<p>Un conseil de formulation : préférez « merci de prévenir au moins 24 h à l'avance, cela permet de proposer le créneau à quelqu'un d'autre » à « toute absence sera facturée ». Le premier explique, le second menace. Le premier marche mieux.</p>

<h2>6. La liste d'attente</h2>

<p>Celui-là ne réduit pas les absences : il en annule les conséquences. Si vous savez qui aimerait ce créneau, une annulation à 9 h pour 14 h devient un coup de fil et un trou rebouché.</p>

<p>Même une version artisanale fonctionne : trois noms notés sur un carnet, ou un message dans une conversation de groupe. Ce qui compte, c'est de ne pas avoir à <em>chercher</em> qui appeler au moment où le créneau se libère — parce qu'à ce moment-là, vous êtes avec un client et vous n'aurez pas le temps.</p>

<h2>7. Repérer les récidivistes</h2>

<p>Une absence, c'est la vie. Trois absences en six mois, c'est un motif. Sans historique, vous ne le verrez jamais — vous garderez juste une impression vague, et cette impression est souvent injuste.</p>

<p>Tenir un historique par client vous permet de traiter ces cas individuellement : demander un acompte à cette personne-là uniquement, ou avoir une conversation franche. C'est infiniment plus juste que de durcir les règles pour tout le monde à cause de trois personnes.</p>

<h2>Les trois erreurs qui aggravent le problème</h2>

<p><strong>Tout empiler d'un coup.</strong> Acompte, pénalité, double rappel, confirmation obligatoire par retour de SMS : vous transformez la prise de rendez-vous en parcours du combattant. Vous gagnerez en présence ce que vous perdrez — en pire — en réservations.</p>

<p><strong>Punir avant d'avoir facilité.</strong> Instaurer une pénalité alors que la personne n'a aucun moyen simple d'annuler, c'est sanctionner un problème que vous avez créé. Le lien d'annulation vient toujours avant la politique d'annulation.</p>

<p><strong>Reprocher l'absence à la personne suivante.</strong> Un mot sec au client d'après, une règle affichée sur un ton excédé : ça se sent, et ça coûte plus cher qu'un créneau vide.</p>

<h2>Par où commencer</h2>

<p>Si vous ne devez faire qu'une seule chose cette semaine : <strong>le rappel automatique la veille, par SMS, avec un lien d'annulation</strong>. C'est celui qui demande le moins d'effort et qui récupère le plus de créneaux.</p>

<p>Le reste vient ensuite, dans cet ordre : confirmation immédiate à la réservation, politique d'annulation affichée, liste d'attente, puis acompte si votre activité le justifie. Ajoutez un levier, laissez tourner un mois, remesurez. Vous saurez très vite lequel travaille pour vous.</p>
`,
  },

  {
    slug: "prendre-ses-rendez-vous-par-whatsapp-les-limites",
    title: "Prendre ses rendez-vous par WhatsApp : jusqu'où ça tient ?",
    category: "Gérer son agenda",
    tags: ["organisation", "whatsapp", "outils"],
    coverImage: "/images/blog/cover-whatsapp.svg",
    excerpt:
      "WhatsApp marche très bien au début — puis un jour vous notez deux personnes sur le même créneau. Où est la limite, quoi garder, quoi automatiser, et comment faire la bascule sans perdre le contact direct.",
    seo: {
      metaTitle: "Gérer ses rendez-vous par WhatsApp : avantages et limites",
      metaDescription:
        "Pourquoi WhatsApp fonctionne au démarrage d'une activité indépendante, à partir de quel moment ça coince, et comment évoluer sans perdre la relation directe avec ses clients.",
    },
    contentHtml: `
<p>Il faut commencer par dire une chose : WhatsApp, pour prendre ses rendez-vous, <strong>c'est un très bon départ</strong>. C'est gratuit, tout le monde l'a, le message est lu dans la minute, et la conversation reste humaine. Beaucoup d'indépendants ont construit une clientèle solide comme ça, et c'était le bon choix.</p>

<p>Le problème n'apparaît pas au début. Il apparaît quand ça marche.</p>

<h2>Le moment où ça coince</h2>

<p>On reconnaît généralement le basculement à quatre symptômes. Si vous en cochez deux, vous y êtes.</p>

<h3>Le double booking</h3>
<p>Vous répondez « oui, mardi 14 h ça marche » à quelqu'un pendant que vous êtes avec un client. Vous notez le rendez-vous mentalement, en vous disant que vous le reporterez plus tard. Trois conversations plus loin, vous proposez le même créneau à quelqu'un d'autre. C'est arrivé à tout le monde, et c'est très inconfortable à rattraper : quelle que soit la personne que vous décalez, elle comprendra qu'elle est passée en second.</p>

<h3>Le temps invisible</h3>
<p>Chaque rendez-vous coûte cinq à dix messages : proposer des créneaux, attendre, reproposer parce que ça ne va pas, confirmer, rappeler la veille. Multipliez par le nombre de rendez-vous dans la semaine.</p>
<p>C'est du temps qui ne se voit nulle part, parce qu'il est fractionné en petits bouts de quarante secondes. Mais si vous le cumulez, il représente souvent plusieurs heures par semaine — et surtout, il vous coupe en permanence de ce que vous êtes en train de faire.</p>

<h3>Les messages hors horaires</h3>
<p>Quelqu'un demande un créneau à 22 h 40 un dimanche. Vous le voyez. Soit vous répondez et vous ne décrochez jamais, soit vous ne répondez pas et vous y pensez toute la soirée. Les deux options sont mauvaises, et aucune n'est de la faute du client : il vous écrit au moment où il y pense.</p>

<h3>Rien n'est cherchable</h3>
<p>« Elle est venue quand la dernière fois ? » « Elle m'avait dit quoi pour son genou ? » « Combien je lui avais facturé ? » L'information existe, quelque part, dans une conversation de trois mille messages. La retrouver prend dix minutes, ou n'arrive jamais.</p>

<h2>Ce qui vaut la peine d'être gardé</h2>

<p>Le réflexe habituel — « il faut un vrai logiciel » — rate quelque chose d'important. Ce qui fait la force de WhatsApp, ce n'est pas la technique, c'est la <strong>relation directe</strong>. Vos clients vous écrivent comme ils écriraient à quelqu'un qu'ils connaissent. Un formulaire froid qui remplace ça vous fera perdre plus que ce qu'il vous fera gagner.</p>

<p>La bonne question n'est donc pas « comment remplacer WhatsApp », mais <strong>« qu'est-ce qui doit sortir de WhatsApp »</strong>.</p>

<h2>La répartition qui fonctionne</h2>

<p>Dans la pratique, ce découpage tient bien : vous automatisez ce qui est mécanique, vous gardez ce qui est relationnel.</p>

<figure>
  <img src="/images/blog/figure-repartition-whatsapp.svg" alt="Deux colonnes : à gauche ce qui passe sur un lien de réservation, à droite ce qui reste dans la conversation WhatsApp." width="900" height="400" />
  <figcaption>Rien de ce qui compte pour la relation ne quitte la conversation.</figcaption>
</figure>

<ul>
  <li><strong>La prise de rendez-vous</strong> passe sur un lien. La personne voit vos vraies disponibilités et choisit son créneau, y compris à 22 h 40 un dimanche — sans que vous ayez à faire quoi que ce soit.</li>
  <li><strong>Les confirmations et les rappels</strong> deviennent automatiques. C'est exactement le genre de message qui n'a aucune valeur ajoutée à être tapé à la main.</li>
  <li><strong>La conversation</strong> reste sur WhatsApp. Les questions avant de venir, le suivi, le « je serai un peu en retard » — ça, ça doit rester humain et direct.</li>
</ul>

<p>Vos clients ne perdent rien dans l'affaire. Ils gagnent même la possibilité de réserver quand vous dormez, et de voir vos disponibilités réelles au lieu de jouer aux devinettes.</p>

<h2>Le test des trois questions</h2>

<p>Si vous hésitez encore, répondez à ceci :</p>
<ul>
  <li>Vous est-il déjà arrivé de proposer un créneau déjà pris ?</li>
  <li>Combien de messages vous a coûté votre dernier rendez-vous pris ?</li>
  <li>Si on vous demandait la date du dernier passage de votre troisième client, combien de temps pour la retrouver ?</li>
</ul>
<p>Deux réponses inconfortables sur trois, et le moment est venu.</p>

<h2>Comment faire la bascule sans casser vos habitudes</h2>

<p>Trois conseils de terrain, valables quel que soit l'outil que vous choisirez.</p>

<h3>Ne coupez rien</h3>
<p>Continuez à accepter les rendez-vous par message pendant plusieurs mois. Une partie de vos clients ne changera jamais, et c'est très bien. Le lien est une option supplémentaire, pas un remplacement imposé. Le jour où vous annoncez « désormais il faut passer par le site », vous perdez les gens qui n'ont pas envie d'apprendre.</p>

<h3>Mettez le lien là où il sera vu</h3>
<p>Dans votre statut WhatsApp, dans votre bio Instagram, dans votre signature, sur votre fiche Google. La plupart des gens ne connaissent pas votre site — ils connaissent votre profil. Un lien planqué en pied de page ne servira à personne.</p>

<h3>Répondez avec le lien, plutôt qu'avec une liste de créneaux</h3>
<p>Quand quelqu'un demande « t'as de la place jeudi ? », répondre « regarde ici, tu prends ce qui t'arrange » est plus rapide pour vous et plus pratique pour lui. Au bout de deux ou trois fois, le réflexe est pris tout seul — sans que vous ayez eu à annoncer quoi que ce soit.</p>

<h2>Combien de temps ça prend</h2>

<p>Comptez une vingtaine de minutes pour poser vos horaires et vos prestations, et une semaine pour que les premiers clients prennent le pli. Vous saurez que c'est passé le jour où une réservation apparaîtra pendant que vous étiez en séance, sans qu'aucun message n'ait été échangé.</p>

<h2>Le vrai bénéfice, à la fin</h2>

<p>Ce n'est pas le gain de temps, même s'il est réel. C'est de ne plus avoir votre agenda dans la tête. Savoir que rien ne peut être doublé, que personne ne va oublier, et qu'un dimanche soir est un dimanche soir : ça vaut largement les vingt minutes de mise en route.</p>
`,
  },

  {
    slug: "se-faire-trouver-sur-google-quand-on-est-independant",
    title: "Se faire trouver sur Google quand on est indépendant : le guide pratique",
    category: "Se faire connaître",
    tags: ["google", "visibilité", "seo local"],
    coverImage: "/images/blog/cover-google-local.svg",
    excerpt:
      "Vous n'avez pas besoin d'un site à 3 000 €. Vous avez besoin d'apparaître quand quelqu'un tape votre métier suivi du nom de votre ville. L'ordre dans lequel s'y prendre, et ce qui ne sert à rien.",
    seo: {
      metaTitle: "Se faire trouver sur Google : guide pour indépendants",
      metaDescription:
        "Fiche Google, avis clients, page de réservation, annuaires : les étapes concrètes pour apparaître quand un client cherche votre métier dans votre ville.",
    },
    contentHtml: `
<p>Un client qui cherche un professionnel ne tape presque jamais un nom d'entreprise. Il tape un besoin et un lieu : « kiné Ixelles », « coiffeur près de moi », « ostéopathe Namur samedi ». Votre travail, c'est d'être là à ce moment précis.</p>

<p>Bonne nouvelle : pour une activité locale, l'essentiel du résultat vient de trois ou quatre actions gratuites. Le site web vient après, et il est beaucoup moins déterminant qu'on ne le croit.</p>

<h2>Comprendre ce que Google affiche</h2>

<p>Sur une recherche locale, la page de résultats se lit de haut en bas comme ceci : d'abord parfois de la publicité, puis un bloc avec une carte et trois établissements — c'est ce bloc qui compte —, et seulement ensuite les liens classiques vers des sites.</p>

<p>Autrement dit : <strong>votre concurrent qui apparaît dans les trois de la carte est vu avant celui qui a le plus beau site</strong>. Et ce bloc-là ne se gagne pas avec un site : il se gagne avec une fiche d'établissement.</p>

<h2>Étape 1 — La fiche d'établissement Google</h2>

<p>C'est de très loin le poste le plus rentable, et beaucoup d'indépendants s'arrêtent à mi-chemin après l'avoir créée.</p>

<figure>
  <img src="/images/blog/figure-fiche-google.svg" alt="Composition d'une fiche d'établissement complète, et poids relatif de chaque élément sur le classement local." width="900" height="460" />
  <figcaption>Le champ « lien de réservation » existe, il est peu rempli, et il transforme une recherche en rendez-vous.</figcaption>
</figure>

<p>Une fiche qui fonctionne est une fiche <strong>complète</strong> :</p>
<ul>
  <li><strong>La catégorie exacte de votre métier.</strong> C'est elle qui décide dans quelles recherches vous apparaissez. Une catégorie approximative — « salon de beauté » quand vous êtes prothésiste ongulaire — vous sort de la moitié des résultats qui vous concernent.</li>
  <li><strong>Les horaires réels</strong>, y compris les fermetures exceptionnelles. Google favorise les fiches à jour, et un client qui se déplace pour rien laisse rarement un bon avis.</li>
  <li><strong>Des photos récentes de l'endroit</strong>, pas seulement un logo. L'intérieur, la devanture, le poste de travail. Les gens veulent savoir où ils mettent les pieds.</li>
  <li><strong>La liste de vos prestations</strong>, écrite avec les mots qu'utilisent vos clients — pas le jargon du métier. On cherche « massage dos », pas « technique myofasciale ».</li>
  <li><strong>Un lien de réservation.</strong> Le champ existe, il est peu utilisé, et il transforme une recherche en rendez-vous sans que la personne ait à vous appeler. C'est probablement le meilleur rapport effort/résultat de toute cette liste.</li>
</ul>

<h2>Étape 2 — Les avis</h2>

<p>À service comparable, la fiche qui a trente avis passe devant celle qui en a trois. Et les avis pèsent doublement : sur le classement, et sur la décision de la personne qui hésite entre vous et le cabinet d'à côté.</p>

<h3>Comment en obtenir</h3>
<p>Ce qui marche, c'est de <strong>demander au bon moment</strong> : juste après la prestation, quand la personne est satisfaite et encore avec vous. Pas trois semaines plus tard par e-mail, quand le souvenir s'est estompé.</p>
<p>Une formulation simple et directe fonctionne mieux qu'un dispositif compliqué : « si vous avez deux minutes, un avis Google m'aiderait beaucoup ». Ayez un QR code ou un lien court prêt, pour que ça se fasse tout de suite.</p>

<h3>Ce qu'il ne faut jamais faire</h3>
<p>Ne payez jamais pour des avis, et n'en écrivez jamais vous-même. Google le détecte, et la sanction est bien pire que l'absence d'avis. Ne filtrez pas non plus en ne sollicitant que les clients contents : une fiche exclusivement à cinq étoiles finit par sembler suspecte.</p>

<h3>Répondez à tous</h3>
<p>Y compris — surtout — aux mauvais. Une réponse calme et factuelle à un avis à deux étoiles rassure davantage un futur client qu'une page de cinq étoiles sans une seule réponse. Elle montre qu'il y a quelqu'un derrière, et comment vous réagissez quand ça se passe mal.</p>

<h2>Étape 3 — Une page publique à votre nom</h2>

<p>Il vous faut une adresse à donner : dans votre bio Instagram, dans votre signature, sur une carte de visite, dans le champ « site web » de votre fiche Google.</p>

<p>Cette page doit répondre à quatre questions en moins de dix secondes : <strong>qui vous êtes, ce que vous faites, où, et comment prendre rendez-vous</strong>. C'est tout. Un site de douze pages ne vous apportera pas un client de plus si ces quatre réponses ne sautent pas aux yeux.</p>

<p>Deux exigences concrètes : le bouton de réservation doit être visible <strong>sans faire défiler la page</strong>, et la page doit s'afficher correctement sur téléphone — c'est là que se fait la quasi-totalité des recherches locales. Un visiteur décidé qui doit chercher comment vous joindre est un visiteur que vous perdez.</p>

<h2>Étape 4 — Les annuaires de votre métier</h2>

<p>Selon votre secteur, il existe des annuaires professionnels, des associations, des mutuelles ou des pages de commerçants de quartier. Chaque inscription est un lien de plus vers vous, et un endroit de plus où l'on peut vous trouver.</p>

<p>Une seule exigence, mais elle est stricte : vos informations doivent être <strong>rigoureusement identiques</strong> partout — même orthographe du nom, même adresse écrite de la même façon, même numéro. Des variantes contradictoires brouillent Google, qui ne sait plus lequel est le bon et se met à douter des deux.</p>

<h2>Ce qui ne sert à rien au début</h2>

<p>Autant le dire clairement, pour vous éviter du temps et de l'argent :</p>
<ul>
  <li><strong>Acheter des mots-clés</strong> avant d'avoir une fiche Google complète. Vous payez pour de la visibilité que vous auriez pu obtenir gratuitement.</li>
  <li><strong>Un site vitrine à plusieurs milliers d'euros</strong> quand une page claire avec un bouton de réservation convertit mieux.</li>
  <li><strong>Publier partout à la fois.</strong> Un réseau tenu régulièrement vaut mieux que quatre comptes abandonnés — un compte mort donne l'impression que l'activité l'est aussi.</li>
  <li><strong>Les mots-clés cachés et autres astuces.</strong> Ça ne marche plus depuis longtemps et ça peut vous faire déclasser.</li>
</ul>

<h2>Un plan sur trente jours</h2>

<p>Si vous voulez un ordre de marche concret :</p>
<ul>
  <li><strong>Semaine 1</strong> — Créer ou revendiquer la fiche Google. Catégorie, horaires, adresse, téléphone.</li>
  <li><strong>Semaine 2</strong> — Photos, liste des prestations, lien de réservation.</li>
  <li><strong>Semaine 3</strong> — Demander un avis à chaque client satisfait. Répondre à tous ceux qui existent déjà.</li>
  <li><strong>Semaine 4</strong> — S'inscrire dans deux ou trois annuaires du métier, avec des informations strictement identiques.</li>
</ul>

<h2>Comment savoir si ça marche</h2>

<p>La fiche Google fournit ses propres statistiques : combien de fois elle a été vue, combien de personnes ont cliqué sur l'itinéraire, sur le téléphone, sur le lien de réservation. Ce sont les seuls chiffres qui comptent vraiment, parce qu'ils mesurent des intentions, pas des impressions.</p>

<p>Regardez-les une fois par mois, pas tous les jours. Et comparez au même mois de l'année précédente si vous le pouvez : beaucoup d'activités sont saisonnières, et une baisse en août ne veut rien dire.</p>

<h2>Combien de temps avant que ça bouge</h2>

<p>Soyons francs : la fiche Google peut produire des effets en quelques semaines. Le reste — avis, notoriété, positionnement — se compte en mois. Toute personne qui vous promet la première place en dix jours vous vend quelque chose.</p>

<p>La bonne façon de voir les choses, c'est un cumul : chaque avis, chaque photo, chaque information à jour s'ajoute aux précédentes. Ce n'est pas spectaculaire sur une semaine, c'est très net sur un an.</p>
`,
  },

  {
    slug: "agenda-en-ligne-pour-kinesitherapeute",
    title: "Agenda en ligne pour kinésithérapeute : ce qui change vraiment au cabinet",
    category: "Par métier",
    tags: ["kinésithérapie", "cabinet", "organisation"],
    coverImage: "/images/blog/cover-kine.svg",
    excerpt:
      "Séries de séances, patients qui reviennent chaque semaine, données de santé, cabinet à plusieurs : la kiné a des contraintes que peu d'agendas génériques prennent au sérieux. Ce qu'il faut vérifier avant de choisir.",
    seo: {
      metaTitle: "Agenda en ligne pour kiné : ce qu'il faut regarder",
      metaDescription:
        "Séries de séances, créneaux récurrents, secret médical, cabinet à plusieurs praticiens : les critères qui comptent vraiment pour choisir un agenda de kinésithérapeute.",
    },
    contentHtml: `
<p>La kinésithérapie a une particularité que la plupart des agendas en ligne gèrent mal : un patient ne prend presque jamais <em>un</em> rendez-vous. Il en prend six, à raison de deux par semaine, sur un mois. Et si l'outil ne sait pas faire ça, vous vous retrouvez à saisir six fois la même chose.</p>

<p>Cet article passe en revue ce qui compte réellement au cabinet, sans détour par les fonctionnalités décoratives.</p>

<h2>Poser plusieurs séances d'un coup</h2>

<p>C'est le point numéro un, et le plus sous-estimé. Une prescription de dix-huit séances, ça se cale en fin de première consultation, pendant que le patient est encore devant vous — pas le soir en rappelant tout le monde.</p>

<p>Ce qu'il faut vérifier : pouvez-vous choisir <strong>plusieurs dates libres</strong> — pas forcément à un rythme régulier — et créer les rendez-vous en une seule opération, avec les coordonnées saisies une seule fois ?</p>

<h3>Le détail qui change tout : l'indépendance</h3>
<p>Ces rendez-vous doivent rester <strong>indépendants</strong> les uns des autres. Si le patient annule la séance du 12, cela ne doit toucher ni celle du 15, ni les quatre suivantes.</p>

<p>Beaucoup d'outils traitent ça comme une « récurrence » — un seul objet répété. Déplacer une séance déplace alors tout le bloc, ce qui est ingérable dès la première semaine de vacances scolaires.</p>

<figure>
  <img src="/images/blog/figure-serie-vs-recurrence.svg" alt="En haut, une récurrence : déplacer une séance décale toutes les autres. En bas, des séances indépendantes : une seule bouge." width="900" height="420" />
  <figcaption>La même série de séances, gérée de deux façons. Seule la seconde survit à un patient qui a une contrainte.</figcaption>
</figure>

<p>Testez-le avant de vous engager : créez une série de trois séances, déplacez celle du milieu, et regardez ce qui arrive aux deux autres. C'est un test de trente secondes qui vous dira tout.</p>

<h2>Le créneau réservé au même patient</h2>

<p>Beaucoup de cabinets fonctionnent avec des habitudes : monsieur D. le mardi 9 h depuis trois ans. Cette place ne doit pas apparaître comme libre à un nouveau patient qui réserve en ligne.</p>

<p>L'outil doit donc permettre de bloquer un créneau récurrent sans avoir à le ressaisir chaque semaine, et — tout aussi important — de le libérer facilement pendant les vacances du patient, sans casser l'habitude pour autant.</p>

<h2>Des durées qui collent à la réalité</h2>

<p>Trente minutes, vingt minutes, parfois quinze pour un simple contrôle, et une heure pour un premier bilan. Un agenda qui ne raisonne qu'en tranches d'une heure vous fait perdre un quart de vos capacités.</p>

<p>Deux points à vérifier : pouvez-vous définir une durée <strong>par type de prestation</strong>, et pouvez-vous la modifier au cas par cas sans tout reparamétrer ? Un patient qui a besoin de dix minutes de plus ce jour-là ne doit pas vous obliger à créer une nouvelle prestation.</p>

<h2>Le cabinet à plusieurs</h2>

<p>Dès que vous êtes deux, les questions changent :</p>
<ul>
  <li>Chacun a-t-il <strong>ses propres horaires</strong> ? Un temps partiel le mercredi ne doit pas être imposé au collègue.</li>
  <li>Peut-on voir tous les agendas côte à côte, et filtrer sur un seul praticien ?</li>
  <li>Le patient peut-il choisir son kiné en réservant — ou demander le premier disponible ?</li>
  <li>Chacun voit-il ce qu'il doit voir, et rien de plus ? Un remplaçant n'a pas à accéder à la comptabilité du cabinet, ni aux dossiers des patients qu'il ne suit pas.</li>
  <li>Que se passe-t-il quand quelqu'un part ? Ses patients doivent pouvoir être repris sans perdre l'historique.</li>
</ul>

<h2>Les données de santé : le point à ne pas prendre à la légère</h2>

<p>Vous manipulez des données de santé, qui relèvent d'une catégorie particulière du RGPD. Trois vérifications minimales avant de confier votre patientèle à un outil :</p>
<ul>
  <li><strong>Où sont hébergées les données ?</strong> Un hébergement dans l'Union européenne simplifie beaucoup de choses.</li>
  <li><strong>Pouvez-vous tout exporter ?</strong> Fiches patients, historique des séances, documents. Si l'export n'existe pas, vous êtes captif — et le jour où vous voudrez partir, ce sera trop tard.</li>
  <li><strong>Les documents sensibles sont-ils protégés ?</strong> Une ordonnance scannée ne doit pas être accessible via une simple adresse devinable dans un navigateur : elle doit passer par un accès authentifié.</li>
</ul>

<p>Posez ces trois questions au support avant de vous engager. La précision de la réponse vous en dira long — un éditeur qui n'a jamais réfléchi à la question répondra à côté.</p>

<h2>Les rappels : votre meilleur retour sur investissement</h2>

<p>Sur une série de dix-huit séances, il y aura des oublis. C'est mathématique, et ça n'a rien à voir avec le sérieux du patient. Le rappel automatique la veille est le levier le plus rentable dont vous disposez, et il coûte quelques centimes par message.</p>

<p>Vérifiez surtout que le patient peut <strong>annuler en un clic</strong> depuis le rappel. Une séance annulée la veille au soir, c'est un créneau que vous pouvez encore proposer à quelqu'un d'autre. Une absence sans prévenir, c'est trente minutes perdues et un patient qui prend du retard sur sa rééducation.</p>

<h2>Ce qui n'a pas d'importance</h2>

<p>Deux choses sur lesquelles il ne faut pas payer un supplément.</p>

<p><strong>La personnalisation graphique poussée</strong> de la page de réservation. Votre patient veut un créneau, pas une identité visuelle. Un logo et vos couleurs suffisent largement.</p>

<p><strong>L'application mobile dédiée.</strong> Un site qui fonctionne bien sur téléphone rend exactement le même service, sans obliger personne à installer quoi que ce soit — et sans que vous dépendiez d'une mise à jour de l'éditeur pour chaque correction.</p>

<h2>Les questions à poser avant de signer</h2>

<ul>
  <li>Puis-je créer six séances en une fois, à des dates que je choisis librement ?</li>
  <li>Si j'en déplace une, les autres bougent-elles ?</li>
  <li>Puis-je bloquer un créneau récurrent pour un patient précis ?</li>
  <li>Chaque praticien peut-il avoir ses propres horaires et ses propres droits ?</li>
  <li>Où sont hébergées les données, et comment je les exporte ?</li>
  <li>Les documents des patients sont-ils accessibles sans authentification ?</li>
</ul>

<h2>La question à se poser en premier</h2>

<p>Avant de comparer des fonctionnalités, chronométrez ce que vous faites aujourd'hui. Combien de minutes par jour passez-vous à répondre au téléphone, rappeler, replacer, noter, chercher une information dans un carnet ? C'est ce chiffre-là que l'outil doit faire baisser.</p>

<p>S'il ne le fait pas, peu importe le reste.</p>
`,
  },
];

/* ══════════════════════════════════════════════════════════════════════════ */

(async () => {
  if (!URI) {
    console.error(`Variable ${PROD ? "MONGO_URI_SERVER" : "MONGO_URI_LOCAL"} absente de .env`);
    process.exit(1);
  }

  await mongoose.connect(URI);
  console.log(`Base : ${PROD ? "PRODUCTION" : "locale"}`);
  console.log(APPLIQUER ? "Mode : ÉCRITURE\n" : "Mode : aperçu (rien n'est écrit)\n");

  let crees = 0;
  let majs = 0;

  for (const a of ARTICLES) {
    const contentHtml = sanitizeArticleHtml(a.contentHtml);
    const mots = contentHtml.replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
    const images = (contentHtml.match(/<img /g) || []).length;
    const existant = await Article.findOne({ slug: a.slug });

    const etat = existant ? "~ maj  " : "+ créé ";
    console.log(`${etat} ${String(mots).padStart(4)} mots · ${images} illustration(s) · ${a.slug}`);

    if (!APPLIQUER) continue;

    if (existant) {
      majs++;
      existant.title = a.title;
      existant.excerpt = a.excerpt;
      existant.category = a.category;
      existant.tags = a.tags;
      existant.seo = a.seo;
      existant.coverImage = a.coverImage;
      existant.contentHtml = contentHtml;
      existant.status = "published";
      // publishedAt volontairement conservé : republier ne doit pas faire
      // remonter un vieil article en tête de liste.
      await existant.save();
    } else {
      crees++;
      await Article.create({
        title: a.title,
        slug: a.slug,
        excerpt: a.excerpt,
        category: a.category,
        tags: a.tags,
        seo: a.seo,
        coverImage: a.coverImage,
        contentHtml,
        status: "published",
        authorName: "L'équipe BranShee",
      });
    }
  }

  if (PURGER) {
    const cibles = await Article.find({ slug: { $in: SLUGS_TEST } }).select("slug title").lean();
    console.log(`\nArticles de démonstration à retirer : ${cibles.length}`);
    cibles.forEach((c) => console.log(`  − ${c.slug}`));
    if (APPLIQUER && cibles.length) {
      await Article.deleteMany({ slug: { $in: SLUGS_TEST } });
    }
  } else {
    console.log("\n(--purge-tests pour retirer aussi les deux articles de démonstration)");
  }

  if (APPLIQUER) console.log(`\n${crees} créé(s), ${majs} mis à jour.`);
  else console.log("\nRelancez avec --apply pour écrire.");

  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
