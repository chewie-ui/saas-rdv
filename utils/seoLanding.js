/**
 * Pages d'atterrissage « métier + ville ».
 *
 * Personne ne cherche « branshee » — on se positionne donc sur ce que les
 * professionnels tapent vraiment : « logiciel de prise de rendez-vous pour
 * kiné à Bruxelles ». Une page par couple (métier, ville).
 *
 * Deux règles pour ne PAS produire des pages satellites que Google déclasse :
 *   1. le texte change réellement d'un métier à l'autre (vocabulaire,
 *      arguments, questions) — pas un gabarit où seul le nom est substitué ;
 *   2. chaque page liste les établissements RÉELS de cette ville, quand il y
 *      en a. C'est le contenu que personne d'autre ne peut copier.
 *
 * La matrice reste volontairement courte (10 métiers × 8 villes). Sur un
 * domaine sans autorité, 4000 pages creuses font plus de mal que 80 pages
 * qui disent quelque chose.
 */

const METIERS = [
  {
    slug: "kine",
    // `nom` sert dans les titres, `pluriel` dans les listes.
    nom: "kinésithérapeute",
    pluriel: "kinésithérapeutes",
    // Le mot que le métier emploie pour les gens qu'il reçoit.
    clients: "patients",
    // Termes tels qu'ils apparaissent en base (businessType) — sert à
    // retrouver les vrais établissements.
    motsCles: ["kiné", "kinésithérapeute", "kinesitherapeute", "physio"],
    accroche:
      "Entre deux séances, vous n'avez pas le temps de décrocher. Vos patients réservent eux-mêmes, vous gardez votre planning en main.",
    arguments: [
      {
        titre: "Des séances qui s'enchaînent sans trou",
        texte: "Durées variables (30 à 45 min selon le soin), temps de battement entre deux patients, séances de suivi qui reviennent chaque semaine : votre agenda reflète votre façon de travailler, pas l'inverse.",
      },
      {
        titre: "Moins d'absences non prévenues",
        texte: "Un rappel automatique part la veille par e-mail, SMS ou WhatsApp. Le patient qui ne peut plus venir annule lui-même, et le créneau se libère pour quelqu'un d'autre.",
      },
      {
        titre: "Le dossier du patient sous la main",
        texte: "Antécédents, ce qui a été travaillé la dernière fois, ce qu'il faut revoir : vos notes suivent le patient d'une séance à l'autre, sans classeur ni feuille volante.",
      },
    ],
    faq: [
      {
        q: "Puis-je gérer des séances de durées différentes ?",
        r: "Oui. Chaque prestation a sa propre durée, et vous pouvez définir une fourchette (par exemple 30 à 45 minutes) puis choisir la durée réelle au moment de la réservation.",
      },
      {
        q: "Mes patients doivent-ils créer un compte ?",
        r: "Non. Un patient réserve avec son nom, son e-mail et son téléphone. Le compte est facultatif — il sert seulement à retrouver ses rendez-vous plus tard.",
      },
    ],
  },
  {
    slug: "osteopathe",
    nom: "ostéopathe",
    pluriel: "ostéopathes",
    clients: "patients",
    motsCles: ["ostéopathe", "osteopathe", "ostéo", "osteo"],
    accroche:
      "Vous consultez seul, souvent sans secrétariat. La prise de rendez-vous en ligne prend le relais du téléphone.",
    arguments: [
      {
        titre: "Le téléphone qui sonne pendant une consultation",
        texte: "C'est le vrai problème du praticien seul : soit vous interrompez le patient sur la table, soit vous ratez l'appel. En ligne, la réservation se fait sans vous.",
      },
      {
        titre: "Première consultation et suivi distingués",
        texte: "Un premier rendez-vous prend souvent plus de temps qu'un contrôle. Deux prestations, deux durées, deux tarifs — le patient choisit, l'agenda s'ajuste.",
      },
      {
        titre: "Vos indisponibilités respectées",
        texte: "Congés, formations, demi-journées : vous fermez les créneaux d'un geste, et personne ne peut réserver dessus. Les rendez-vous déjà pris, eux, ne sont jamais annulés.",
      },
    ],
    faq: [
      {
        q: "Puis-je bloquer une journée sans annuler les rendez-vous déjà pris ?",
        r: "Oui. Poser une absence empêche toute nouvelle réservation sur la plage, mais les rendez-vous existants restent dans votre agenda — vous les honorez normalement.",
      },
      {
        q: "Est-ce que je peux demander un acompte ?",
        r: "Oui, le paiement en ligne est optionnel : acompte, paiement intégral ou empreinte de carte pour couvrir les annulations tardives.",
      },
    ],
  },
  {
    slug: "coiffeur",
    nom: "coiffeur",
    pluriel: "coiffeurs",
    clients: "clients",
    motsCles: ["coiffeur", "coiffure", "salon de coiffure", "coiffeuse"],
    accroche:
      "Les mains dans les cheveux, vous ne pouvez pas noter un rendez-vous. Vos clients réservent depuis leur téléphone, à toute heure.",
    arguments: [
      {
        titre: "Chaque prestation a sa durée réelle",
        texte: "Une coupe, une couleur et un balayage ne prennent pas le même temps. En les distinguant, votre journée se remplit sans trous ni chevauchements.",
      },
      {
        titre: "Plusieurs coiffeurs, un seul agenda",
        texte: "Le client choisit avec qui il veut prendre rendez-vous, ou laisse le salon décider. Chacun garde ses propres horaires et ses propres congés.",
      },
      {
        titre: "Les réservations arrivent le soir",
        texte: "Une grande partie des prises de rendez-vous se font en dehors des heures d'ouverture, quand votre salon est fermé et que le téléphone ne répond pas.",
      },
    ],
    faq: [
      {
        q: "Puis-je gérer plusieurs coiffeurs avec des horaires différents ?",
        r: "Oui. Chaque membre de l'équipe a ses horaires, ses jours de congé et ses prestations. Le client voit uniquement les créneaux réellement disponibles.",
      },
      {
        q: "Comment éviter les clients qui ne viennent pas ?",
        r: "Un rappel part automatiquement avant le rendez-vous, et vous pouvez exiger une empreinte de carte pour prélever des frais en cas d'annulation tardive.",
      },
    ],
  },
  {
    slug: "estheticienne",
    nom: "esthéticienne",
    pluriel: "esthéticiennes",
    clients: "clientes",
    motsCles: ["esthéticienne", "estheticienne", "institut de beauté", "esthétique"],
    accroche:
      "Un soin dure, et pendant ce temps l'institut ne répond pas. Vos clientes réservent en ligne, vous restez concentrée.",
    arguments: [
      {
        titre: "Un catalogue de soins lisible",
        texte: "Chaque soin avec sa durée, son prix et sa description. La cliente sait exactement ce qu'elle réserve, et vous n'expliquez plus la même chose dix fois par jour.",
      },
      {
        titre: "Les cabines et le matériel respectés",
        texte: "Vos disponibilités tiennent compte de ce que vous pouvez réellement faire en même temps — pas de double réservation sur un appareil unique.",
      },
      {
        titre: "Vos clientes reviennent",
        texte: "Vous gardez l'historique de chaque cliente : ce qui a été fait, avec quels produits, ce qu'elle a demandé la dernière fois.",
      },
    ],
    faq: [
      {
        q: "Puis-je afficher mes prix sur la page de réservation ?",
        r: "Oui, chaque prestation peut afficher son prix, ou le masquer si vous préférez en parler de vive voix.",
      },
      {
        q: "Puis-je poser des questions avant la réservation ?",
        r: "Oui. Un formulaire personnalisable vous permet de demander ce dont vous avez besoin — allergies, type de peau, première visite — avant la venue.",
      },
    ],
  },
  {
    slug: "barbier",
    nom: "barbier",
    pluriel: "barbiers",
    clients: "clients",
    motsCles: ["barbier", "barber", "barbershop"],
    accroche:
      "Les créneaux courts s'enchaînent vite. Une réservation en ligne évite les files d'attente et les créneaux perdus.",
    arguments: [
      {
        titre: "Des créneaux courts, bien remplis",
        texte: "Coupe, barbe, les deux : chaque prestation a sa durée. Votre journée se remplit au quart d'heure près, sans blanc entre deux clients.",
      },
      {
        titre: "Chaque barbier a ses habitués",
        texte: "Le client choisit son barbier. Ceux qui ont leurs habitudes les retrouvent, les nouveaux prennent le premier disponible.",
      },
      {
        titre: "Fini le carnet papier",
        texte: "Votre agenda vous suit sur le téléphone. Vous voyez la journée du lendemain avant même d'ouvrir la boutique.",
      },
    ],
    faq: [
      {
        q: "Puis-je limiter les réservations de dernière minute ?",
        r: "Oui. Vous fixez un délai minimum — par exemple pas de réservation moins de 2 heures avant — pour ne pas être surpris en plein service.",
      },
      {
        q: "Puis-je accepter les clients sans rendez-vous en parallèle ?",
        r: "Oui, rien ne vous oblige à ouvrir tous vos créneaux à la réservation. Vous gardez les plages que vous voulez pour le passage libre.",
      },
    ],
  },
  {
    slug: "tatoueur",
    nom: "tatoueur",
    pluriel: "tatoueurs",
    clients: "clients",
    motsCles: ["tatoueur", "tattoo", "tatouage", "piercing"],
    accroche:
      "Un projet se discute avant de se dessiner. Le formulaire de réservation collecte l'essentiel avant même le premier échange.",
    arguments: [
      {
        titre: "Le projet décrit dès la réservation",
        texte: "Emplacement, taille, style, référence : vous posez vos questions dans le formulaire et vous arrivez au rendez-vous en sachant de quoi il s'agit.",
      },
      {
        titre: "Un acompte pour engager le client",
        texte: "Les séances longues se réservent des semaines à l'avance. L'acompte en ligne filtre ceux qui ne viendront pas.",
      },
      {
        titre: "Des séances de plusieurs heures",
        texte: "Un flash d'une heure et une pièce de six heures ne se gèrent pas pareil. Chaque prestation a sa durée réelle, aussi longue soit-elle.",
      },
    ],
    faq: [
      {
        q: "Puis-je demander un acompte à la réservation ?",
        r: "Oui. Vous choisissez le montant, et le créneau n'est confirmé qu'une fois l'acompte payé.",
      },
      {
        q: "Puis-je recevoir des photos de référence ?",
        r: "Le formulaire de réservation accepte des questions libres où le client décrit son projet. Vous convenez ensuite des visuels par le canal qui vous arrange.",
      },
    ],
  },
  {
    slug: "psychologue",
    nom: "psychologue",
    pluriel: "psychologues",
    clients: "patients",
    motsCles: ["psychologue", "psychothérapeute", "psychotherapeute", "psy"],
    accroche:
      "Prendre le premier rendez-vous demande déjà un effort. Une réservation en ligne discrète, sans téléphone, lève un obstacle de plus.",
    arguments: [
      {
        titre: "Sans passer par la parole",
        texte: "Beaucoup de patients repoussent l'appel téléphonique. Réserver un créneau en trois clics, à minuit, supprime cette barrière.",
      },
      {
        titre: "Des séances régulières, faciles à reconduire",
        texte: "Un suivi se construit dans la durée. Vous retrouvez l'historique du patient et reposez les séances suivantes sans reprendre les informations à zéro.",
      },
      {
        titre: "Vos notes restent vos notes",
        texte: "Le dossier de suivi est privé, hébergé en Europe, jamais visible du patient. Les pièces jointes ne sont accessibles que par vous.",
      },
    ],
    faq: [
      {
        q: "Les informations de mes patients sont-elles protégées ?",
        r: "Les données sont hébergées en Europe et les documents du dossier de suivi sont stockés hors du site public, accessibles uniquement par votre compte.",
      },
      {
        q: "Puis-je proposer des séances en visio ?",
        r: "Oui. Une prestation peut être marquée « en ligne » : vous transmettez le lien de connexion dans le message de confirmation.",
      },
    ],
  },
  {
    slug: "podologue",
    nom: "podologue",
    pluriel: "podologues",
    clients: "patients",
    motsCles: ["podologue", "pédicure", "pedicure", "podologie"],
    accroche:
      "Entre les soins et les semelles, votre planning mêle des rendez-vous très différents. Chacun trouve sa place.",
    arguments: [
      {
        titre: "Soins et appareillage distingués",
        texte: "Un soin de pédicure médicale et une prise d'empreinte n'occupent ni le même temps ni le même matériel. Deux prestations, deux durées.",
      },
      {
        titre: "Le suivi d'un patient chronique",
        texte: "Diabète, troubles de la marche : ces patients reviennent régulièrement. Leur historique est là, séance après séance.",
      },
      {
        titre: "Des rappels qui évitent les oublis",
        texte: "Un rendez-vous pris trois mois à l'avance s'oublie. Le rappel automatique part la veille, par e-mail ou par SMS.",
      },
    ],
    faq: [
      {
        q: "Puis-je espacer les rendez-vous d'un même patient ?",
        r: "Vous gérez librement vos créneaux et pouvez reposer un rendez-vous de suivi à la date de votre choix depuis la fiche du patient.",
      },
      {
        q: "Puis-je exiger le téléphone du patient ?",
        r: "Oui, et c'est le réglage par défaut : sans numéro, impossible de joindre un patient en cas d'imprévu.",
      },
    ],
  },
  {
    slug: "masseur",
    nom: "masseur",
    pluriel: "masseurs",
    clients: "clients",
    motsCles: ["masseur", "massage", "masseuse", "spa"],
    accroche:
      "Un massage ne s'interrompt pas pour répondre au téléphone. La réservation se fait sans vous, pendant que vous travaillez.",
    arguments: [
      {
        titre: "Des durées au choix du client",
        texte: "30, 60 ou 90 minutes : le client choisit la formule, et le créneau réservé correspond exactement à ce qu'il a pris.",
      },
      {
        titre: "Le temps de remise en état compté",
        texte: "Un battement automatique entre deux rendez-vous vous laisse le temps de préparer la cabine, sans avoir à y penser.",
      },
      {
        titre: "Les cartes cadeaux et forfaits",
        texte: "Vous suivez qui a payé quoi, et gardez l'historique de chaque client d'une séance à l'autre.",
      },
    ],
    faq: [
      {
        q: "Puis-je prévoir un temps de battement entre deux rendez-vous ?",
        r: "Oui, vous définissez un temps avant et après chaque prestation. Il est retiré automatiquement des créneaux proposés.",
      },
      {
        q: "Puis-je proposer plusieurs durées pour un même massage ?",
        r: "Oui, soit en créant une prestation par durée, soit en définissant une fourchette et en choisissant la durée réelle au moment du rendez-vous.",
      },
    ],
  },
  {
    slug: "coach-sportif",
    nom: "coach sportif",
    pluriel: "coachs sportifs",
    clients: "clients",
    motsCles: ["coach sportif", "coach", "personal trainer", "préparateur physique"],
    accroche:
      "Séances individuelles et cours collectifs dans le même agenda, avec le bon nombre de places à chaque fois.",
    arguments: [
      {
        titre: "Individuel et collectif au même endroit",
        texte: "Un cours de groupe a un nombre de places limité ; une séance individuelle occupe le créneau entier. Les deux cohabitent sans se marcher dessus.",
      },
      {
        titre: "Des séances qui reviennent chaque semaine",
        texte: "Vos cours récurrents se posent une fois et se répètent. Les clients s'inscrivent à la séance qui les arrange.",
      },
      {
        titre: "Le suivi de chaque client",
        texte: "Objectifs, progression, ce qui a été travaillé la dernière fois : vous retrouvez tout avant la séance suivante.",
      },
    ],
    faq: [
      {
        q: "Puis-je limiter le nombre de participants à un cours ?",
        r: "Oui. Un cours collectif a une capacité : une fois atteinte, il n'apparaît plus comme disponible.",
      },
      {
        q: "Puis-je programmer des cours qui se répètent ?",
        r: "Oui, un cours peut se répéter sur les jours de la semaine que vous choisissez, ou être posé à des dates ponctuelles.",
      },
    ],
  },
];

/**
 * Chaque ville porte son propre contexte. Sans lui, deux pages du même métier
 * dans deux villes étaient identiques à 98 % — le seul mot qui changeait était
 * le nom de la ville. C'est le schéma de pages satellites que Google déclasse,
 * et à juste titre : une telle page n'apprend rien à personne.
 */
const VILLES = [
  {
    slug: "bruxelles",
    nom: "Bruxelles",
    region: "Région de Bruxelles-Capitale",
    contexte:
      "Bruxelles concentre plus d'un million d'habitants sur dix-neuf communes, avec une clientèle souvent bilingue et une part importante d'expatriés. Une page de réservation accessible sans appel téléphonique lève la barrière de la langue : le client lit, choisit son créneau et réserve, sans avoir à expliquer sa demande à l'oral.",
    zones: ["Ixelles", "Uccle", "Schaerbeek", "Saint-Gilles", "Etterbeek", "Woluwe-Saint-Lambert", "Anderlecht", "Forest"],
    mobilite: "Beaucoup de clients viennent en transports en commun : indiquez la station la plus proche dans votre description, et prévoyez un battement suffisant entre deux rendez-vous.",
  },
  {
    slug: "liege",
    nom: "Liège",
    region: "Province de Liège",
    contexte:
      "Liège est la plus grande ville de Wallonie et son bassin déborde largement sur Seraing, Herstal et Ans. La clientèle vient donc souvent de plusieurs communes autour, ce qui rend la réservation en ligne d'autant plus utile : personne ne se déplace pour découvrir que vous êtes complet.",
    zones: ["Guillemins", "Outremeuse", "Sainte-Walburge", "Angleur", "Seraing", "Herstal", "Ans", "Chênée"],
    mobilite: "Le stationnement en centre-ville reste compliqué : préciser où se garer dans le message de confirmation évite bien des retards.",
  },
  {
    slug: "namur",
    nom: "Namur",
    region: "Province de Namur",
    contexte:
      "Capitale de la Wallonie, Namur mêle une activité administrative dense en semaine et une clientèle plus résidentielle le samedi. Les créneaux du midi et de fin de journée partent vite : les ouvrir à la réservation en ligne, c'est les remplir sans y penser.",
    zones: ["Jambes", "Salzinnes", "Bouge", "Saint-Servais", "Belgrade", "Wépion", "Erpent"],
    mobilite: "Entre la ville haute et Jambes, quelques minutes de trajet suffisent à décaler un rendez-vous : un rappel la veille limite les retards.",
  },
  {
    slug: "charleroi",
    nom: "Charleroi",
    region: "Province de Hainaut",
    contexte:
      "Charleroi et sa périphérie forment le plus grand bassin de population de Wallonie. La concurrence y est réelle, et la première impression se joue souvent en ligne : un professionnel qu'on peut réserver en trois clics passe devant celui qu'il faut appeler aux heures de bureau.",
    zones: ["Marcinelle", "Gilly", "Montignies-sur-Sambre", "Jumet", "Gosselies", "Couillet", "Lodelinsart"],
    mobilite: "La ville est étendue : indiquez clairement votre adresse et votre commune, plusieurs quartiers portant des noms proches.",
  },
  {
    slug: "mons",
    nom: "Mons",
    region: "Province de Hainaut",
    contexte:
      "Mons vit au rythme de son université et de ses services publics, avec une clientèle jeune et habituée à tout réserver depuis son téléphone. Un professionnel qui n'a que le téléphone comme point d'entrée se coupe d'une partie de cette clientèle.",
    zones: ["Jemappes", "Cuesmes", "Ghlin", "Havré", "Nimy", "Hyon"],
    mobilite: "Les périodes d'examens et de congés universitaires font varier fortement la demande : vos horaires se modifient en quelques secondes.",
  },
  {
    slug: "wavre",
    nom: "Wavre",
    region: "Brabant wallon",
    contexte:
      "Wavre est au centre d'un Brabant wallon résidentiel, où beaucoup de clients travaillent à Bruxelles et ne sont disponibles qu'en début ou en fin de journée. Ouvrir la réservation en ligne, c'est capter ces demandes le soir, quand votre cabinet est fermé.",
    zones: ["Bierges", "Limal", "Basse-Wavre", "Ottignies", "Rixensart", "Grez-Doiceau"],
    mobilite: "Le trafic vers Bruxelles conditionne les horaires : les créneaux avant 9h et après 17h sont les plus demandés.",
  },
  {
    slug: "tournai",
    nom: "Tournai",
    region: "Province de Hainaut",
    contexte:
      "À dix minutes de la frontière, Tournai accueille aussi une clientèle française du Nord. Une page de réservation publique, trouvable sur Google et partageable par lien, vaut mieux qu'un numéro belge qu'on hésite à composer depuis l'étranger.",
    zones: ["Kain", "Froyennes", "Templeuve", "Marquain", "Vaulx", "Orcq"],
    mobilite: "Pensez à indiquer votre numéro au format international : vos clients français composeront plus facilement.",
  },
  {
    slug: "louvain-la-neuve",
    nom: "Louvain-la-Neuve",
    region: "Brabant wallon",
    contexte:
      "Ville universitaire et piétonne, Louvain-la-Neuve a une clientèle jeune, connectée, et un rythme très marqué par le calendrier académique. Tout s'y réserve en ligne — c'est la norme, pas un avantage.",
    zones: ["Ottignies", "Blocry", "Lauzelle", "Biéreau", "Céroux-Mousty", "Limelette"],
    mobilite: "Le centre étant piéton, précisez le parking le plus proche : c'est la première question de tout nouveau client.",
  },
];

/** Toutes les combinaisons, pour le sitemap et la page d'index. */
function toutesLesPages() {
  const pages = [];
  for (const m of METIERS) {
    for (const v of VILLES) {
      pages.push({ metier: m, ville: v, slug: `${m.slug}-${v.slug}` });
    }
  }
  return pages;
}

/**
 * Résout « kine-louvain-la-neuve ». On ne peut pas couper au premier tiret :
 * les deux moitiés en contiennent. On teste donc les slugs connus, du plus
 * long au plus court pour que « coach-sportif » l'emporte sur « coach ».
 */
function resoudre(slug) {
  if (!slug) return null;
  const s = String(slug).toLowerCase().trim();
  const metiers = [...METIERS].sort((a, b) => b.slug.length - a.slug.length);
  for (const m of metiers) {
    if (!s.startsWith(m.slug + "-")) continue;
    const resteVille = s.slice(m.slug.length + 1);
    const v = VILLES.find((x) => x.slug === resteVille);
    if (v) return { metier: m, ville: v, slug: s };
  }
  return null;
}

module.exports = { METIERS, VILLES, toutesLesPages, resoudre };
