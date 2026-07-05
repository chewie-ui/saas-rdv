// ── Templates de site complets ("Mon site") ──────────────────────────────────
// Chaque template = un thème (couleurs/police/coins) + un jeu de sections déjà
// rempli avec de vrais textes, de belles images (Unsplash, URLs vérifiées) et
// une mise en page cohérente. L'utilisateur clique "Appliquer" et obtient un
// site prêt à publier, qu'il peut ensuite personnaliser bloc par bloc.
//
// Images : URLs Unsplash CDN (auto-format, ~1400px). Ce sont des placeholders
// premium destinés à être remplacés par les photos du client, mais qui rendent
// déjà très bien tels quels.

const IMG = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1400&q=80`;

// ── Template A — "Sérénité" (bien-être / institut / spa — clair, élégant) ─────
const SERENITE = {
  id: "serenite",
  name: "Sérénité",
  tagline: "Bien-être, spa, instituts",
  description: "Un site tout en douceur : typographie élégante, tons chauds et ambiance apaisante. Idéal pour les instituts, spas et praticien·ne·s du bien-être.",
  bestFor: "Spa · Institut · Massage · Bien-être",
  features: ["Réservation intégrée", "Galerie & avis clients", "Design élégant & chaleureux"],
  thumb: { bg: "#faf6f0", accent: "#a97b52", text: "#2b2420" },
  theme: {
    primaryColor: "#a97b52",
    bgColor: "#faf6f0",
    textColor: "#2b2420",
    fontFamily: "Lora",
    roundness: "pill",
    siteTemplate: "1",
  },
  seo: {
    title: "Institut bien-être — Réservez votre soin en ligne",
    description: "Offrez-vous une parenthèse de détente. Réservation en ligne simple et rapide.",
  },
  sections: [
    { id: "hero", type: "hero", enabled: true, order: 0, data: {
      title: "L'art de prendre soin de vous",
      subtitle: "Une parenthèse de détente rien que pour vous. Réservez votre moment bien-être en quelques clics.",
      ctaText: "Réserver ma séance",
      heroLayout: "full", textAlign: "center",
      bgImage: IMG("1600334129128-685c5582fd35"),
      overlayOpacity: 45,
    }},
    { id: "about", type: "about", enabled: true, order: 1, data: {
      subtitle: "NOTRE MAISON",
      title: "Un havre de paix au cœur de la ville",
      text: "<p>Depuis notre ouverture, nous cultivons un art de vivre où chaque détail compte. Nos praticien·ne·s vous accueillent dans un cocon pensé pour la détente, avec des soins personnalisés et des produits sélectionnés avec soin.</p><p>Ici, on ralentit. On respire. On prend soin de soi.</p>",
      image: IMG("1544161515-4ab6ce6db874"),
      layout: "default",
      values: [
        { icon: "🌿", title: "Produits naturels", desc: "Des soins doux, respectueux de votre peau et de l'environnement." },
        { icon: "✋", title: "Gestes experts", desc: "Une équipe formée et passionnée, à votre écoute." },
        { icon: "🕊️", title: "Sérénité absolue", desc: "Une ambiance apaisante, loin du tumulte du quotidien." },
      ],
    }},
    { id: "services", type: "services", enabled: true, order: 2, data: {
      title: "Nos soins signature",
      subtitle: "Des prestations pensées pour votre bien-être",
    }},
    { id: "stats", type: "stats", enabled: true, order: 3, data: {
      title: "La confiance de nos client·e·s",
      items: [
        { icon: "💆", number: "12 000+", label: "Soins prodigués" },
        { icon: "⭐", number: "4,9/5", label: "Note moyenne" },
        { icon: "🗓️", number: "10 ans", label: "D'expérience" },
        { icon: "⏱️", number: "< 15 min", label: "Réponse garantie" },
      ],
    }},
    { id: "testimonials", type: "testimonials", enabled: true, order: 4, data: {
      title: "Elles et ils en parlent mieux que nous",
      source: "manual",
      items: [
        { name: "Camille R.", rating: 5, text: "Un moment suspendu. Je ressors à chaque fois totalement détendue, l'accueil est adorable." },
        { name: "Sophie L.", rating: 5, text: "Le soin du visage est incroyable, ma peau n'a jamais été aussi belle. Je recommande les yeux fermés." },
        { name: "Julie M.", rating: 5, text: "Cadre magnifique, praticienne aux mains d'or. C'est devenu mon rituel du mois !" },
      ],
    }},
    { id: "gallery", type: "gallery", enabled: true, order: 5, data: {
      title: "L'ambiance de notre institut",
      columns: "3",
      images: [
        { url: IMG("1512290923902-8a9f81dc236c"), caption: "Espace détente" },
        { url: IMG("1596178065887-1198b6148b2b"), caption: "Soins du visage" },
        { url: IMG("1519824145371-296894a0daa9"), caption: "Rituel relaxant" },
        { url: IMG("1487412947147-5cebf100ffc2"), caption: "Notre cabine" },
      ],
    }},
    { id: "faq", type: "faq", enabled: true, order: 6, data: {
      title: "Questions fréquentes",
      items: [
        { question: "Comment réserver un soin ?", answer: "Directement en ligne sur cette page, en choisissant la prestation et le créneau qui vous conviennent. C'est immédiat et sans appel." },
        { question: "Puis-je annuler ou reporter ?", answer: "Oui, vous pouvez annuler ou reporter jusqu'à 24h avant votre rendez-vous, simplement depuis votre e-mail de confirmation." },
        { question: "Proposez-vous des cartes cadeaux ?", answer: "Absolument ! Contactez-nous et offrez un moment de détente à celles et ceux que vous aimez." },
        { question: "Faut-il arriver en avance ?", answer: "Nous vous conseillons d'arriver 5 minutes avant afin de profiter pleinement de votre soin dans le calme." },
      ],
    }},
    { id: "booking", type: "booking", enabled: true, order: 7, data: {
      title: "Réservez votre moment",
      subtitle: "Choisissez le soin et le créneau qui vous conviennent",
      embedMode: "full",
    }},
    { id: "cta", type: "cta", enabled: true, order: 8, data: {
      title: "Offrez-vous une pause bien méritée",
      text: "Nos praticien·ne·s vous accueillent 6 jours sur 7.",
      buttonText: "Prendre rendez-vous",
      buttonUrl: "#booking",
      bg: "gradient",
    }},
    { id: "contact", type: "contact", enabled: true, order: 9, data: {
      title: "Nous trouver",
      phone: "", email: "", address: "",
    }},
  ],
};

// ── Template B — "Studio" (barbier / coiffure / fitness — sombre, audacieux) ──
const STUDIO = {
  id: "studio",
  name: "Studio",
  tagline: "Barbier, coiffure, fitness",
  description: "Un site sombre et percutant qui met en valeur votre style et vos prestations. Parfait pour les barbiers, salons de coiffure et studios de sport.",
  bestFor: "Barbier · Coiffure · Fitness · Tatouage",
  features: ["Réservation intégrée", "Mise en avant des prestations", "Style sombre & moderne"],
  thumb: { bg: "#0f1012", accent: "#e8b04b", text: "#f2f2f0" },
  theme: {
    primaryColor: "#e8b04b",
    bgColor: "#0f1012",
    textColor: "#f2f2f0",
    fontFamily: "Montserrat",
    roundness: "sharp",
    siteTemplate: "2",
  },
  seo: {
    title: "Studio — Prenez rendez-vous en ligne",
    description: "Coupes précises, ambiance unique. Réservez votre créneau en ligne, sans appel.",
  },
  sections: [
    { id: "hero", type: "hero", enabled: true, order: 0, data: {
      title: "Votre style, notre signature",
      subtitle: "Coupes précises, ambiance unique. Prenez rendez-vous et repartez transformé·e.",
      ctaText: "Réserver maintenant",
      heroLayout: "full", textAlign: "left",
      bgImage: IMG("1585747860715-2ba37e788b70"),
      overlayOpacity: 60,
    }},
    { id: "stats", type: "stats", enabled: true, order: 1, data: {
      title: "Le studio en chiffres",
      items: [
        { icon: "✂️", number: "25 000+", label: "Coupes réalisées" },
        { icon: "🔥", number: "4,9/5", label: "Satisfaction" },
        { icon: "👑", number: "12 ans", label: "Savoir-faire" },
        { icon: "⚡", number: "7j/7", label: "Ouvert" },
      ],
    }},
    { id: "services", type: "services", enabled: true, order: 2, data: {
      title: "Nos prestations",
      subtitle: "Le geste juste, à chaque fois",
    }},
    { id: "about", type: "about", enabled: true, order: 3, data: {
      subtitle: "NOTRE HISTOIRE",
      title: "Bien plus qu'un salon",
      text: "<p>Né d'une passion pour le détail et le style, notre studio est un lieu où l'on prend le temps de bien faire. Chaque coupe est une rencontre, chaque client·e repart avec une allure qui lui ressemble.</p><p>Poussez la porte, installez-vous : vous êtes chez vous.</p>",
      image: IMG("1503951914875-452162b0f3f1"),
      layout: "reverse",
      values: [
        { icon: "🪒", title: "Précision", desc: "Des finitions nettes et un savoir-faire technique irréprochable." },
        { icon: "🎯", title: "Sur-mesure", desc: "Une coupe adaptée à votre style de vie et à votre visage." },
        { icon: "🤝", title: "Convivialité", desc: "Une ambiance détendue où l'on aime prendre le temps." },
      ],
    }},
    { id: "gallery", type: "gallery", enabled: true, order: 4, data: {
      title: "Dans notre antre",
      columns: "3",
      images: [
        { url: IMG("1622287162716-f311baa1a2b8"), caption: "Le fauteuil" },
        { url: IMG("1517832606299-7ae9b720a186"), caption: "Coupe homme" },
        { url: IMG("1599351431202-1e0f0137899a"), caption: "Détails" },
        { url: IMG("1534438327276-14e5300c3a48"), caption: "L'ambiance" },
      ],
    }},
    { id: "testimonials", type: "testimonials", enabled: true, order: 5, data: {
      title: "Ils nous font confiance",
      source: "manual",
      items: [
        { name: "Thomas B.", rating: 5, text: "Le meilleur barbier de la ville, sans hésiter. Toujours au top, jamais déçu." },
        { name: "Karim S.", rating: 5, text: "Ambiance géniale, coupe parfaite et réservation en ligne hyper pratique. Rien à redire." },
        { name: "Lucas D.", rating: 5, text: "Un vrai savoir-faire. On sent la passion, et le résultat est toujours impeccable." },
      ],
    }},
    { id: "faq", type: "faq", enabled: true, order: 6, data: {
      title: "Vos questions",
      items: [
        { question: "Comment prendre rendez-vous ?", answer: "En ligne, directement sur cette page. Choisissez votre prestation et votre créneau, c'est réglé en une minute." },
        { question: "Puis-je venir sans réserver ?", answer: "Nous privilégions la réservation pour vous garantir un créneau sans attente, mais passez nous voir, on fait toujours au mieux !" },
        { question: "Quels moyens de paiement acceptez-vous ?", answer: "Carte, espèces et paiement en ligne. À vous de choisir ce qui vous arrange." },
        { question: "Proposez-vous des forfaits ?", answer: "Oui, demandez-nous nos formules fidélité et cartes cadeaux en boutique." },
      ],
    }},
    { id: "booking", type: "booking", enabled: true, order: 7, data: {
      title: "Réservez votre créneau",
      subtitle: "Simple, rapide, sans appel",
      embedMode: "full",
    }},
    { id: "cta", type: "cta", enabled: true, order: 8, data: {
      title: "Prêt·e pour votre nouvelle coupe ?",
      text: "Réservez en ligne en moins d'une minute.",
      buttonText: "Je réserve",
      buttonUrl: "#booking",
      bg: "dark",
    }},
    { id: "contact", type: "contact", enabled: true, order: 9, data: {
      title: "Nous trouver",
      phone: "", email: "", address: "",
    }},
  ],
};

// ── Template C — "Atelier" (coiffeur / barbier — éditorial chic) ─────────────
// Reprend la maquette "Atelier Lumière" : pairing Playfair (titres) + Inter
// (texte), palette crème / charbon / terracotta, mise en page éditoriale.
const ATELIER = {
  id: "atelier",
  name: "Atelier",
  tagline: "Coiffeur, barbier, beauté",
  description: "Un site éditorial chic : titres en serif élégant, tons crème et terracotta, grandes images. Parfait pour les salons de coiffure, barbiers et instituts de beauté qui veulent un rendu haut de gamme.",
  bestFor: "Coiffeur · Barbier · Institut · Beauté",
  features: ["Réservation intégrée", "Titres serif élégants (Playfair)", "Galerie & avis clients"],
  thumb: { bg: "#f7f3ee", accent: "#b5744e", text: "#211c19" },
  theme: {
    primaryColor: "#b5744e",
    bgColor: "#f7f3ee",
    textColor: "#211c19",
    fontFamily: "Inter",
    headingFont: "Playfair Display",
    roundness: "soft",
    siteTemplate: "1",
  },
  seo: {
    title: "Salon de coiffure — Réservez votre rendez-vous en ligne",
    description: "Coupe, couleur et soins sur-mesure. Réservation en ligne simple et rapide.",
  },
  sections: [
    { id: "hero", type: "hero", enabled: true, order: 0, data: {
      title: "Révélez votre plus belle version",
      subtitle: "Coupe, couleur et soins sur-mesure dans un écrin chaleureux. Une équipe d'expert·e·s à votre écoute, pour une coiffure qui vous ressemble.",
      ctaText: "Prendre rendez-vous",
      heroLayout: "full", textAlign: "left",
      bgImage: IMG("1560066984-138dadb4c035"),
      overlayOpacity: 52,
    }},
    { id: "services", type: "services", enabled: true, order: 1, data: {
      title: "Un savoir-faire pour chaque envie",
      subtitle: "Des prestations pensées pour sublimer votre chevelure, avec des produits nobles et des gestes précis.",
    }},
    { id: "about", type: "about", enabled: true, order: 2, data: {
      subtitle: "LE SALON",
      title: "Un lieu pensé pour prendre soin de vous",
      text: "<p>Niché au cœur de la ville, notre atelier est un havre où l'on ralentit. Nous mêlons expertise technique et écoute sincère, pour que chaque visite soit un vrai moment pour soi — et une coiffure dont vous serez fier·e en repartant.</p>",
      image: IMG("1521590832167-7bcbfaa6381f"),
      layout: "default",
      values: [
        { icon: "🏆", title: "Expertise reconnue", desc: "Une équipe formée aux dernières techniques de coupe et de couleur." },
        { icon: "🌿", title: "Produits nobles", desc: "Des soins respectueux de vos cheveux comme de la planète." },
        { icon: "💬", title: "À votre écoute", desc: "Un diagnostic offert pour définir ensemble la coiffure qui vous ressemble." },
      ],
    }},
    { id: "stats", type: "stats", enabled: true, order: 3, data: {
      title: "La confiance de nos client·e·s",
      items: [
        { icon: "✂️", number: "15 ans", label: "D'expérience" },
        { icon: "⭐", number: "4,9/5", label: "+800 avis" },
        { icon: "💇", number: "8 000+", label: "Client·e·s ravi·e·s" },
        { icon: "👥", number: "6 experts", label: "À votre service" },
      ],
    }},
    { id: "gallery", type: "gallery", enabled: true, order: 4, data: {
      title: "Nos réalisations",
      columns: "3",
      images: [
        { url: IMG("1562322140-8baeececf3df"), caption: "Coupe & brushing" },
        { url: IMG("1599351431202-1e0f0137899a"), caption: "Coiffage" },
        { url: IMG("1633681926022-84c23e8cb2d6"), caption: "Coloration" },
        { url: IMG("1503951914875-452162b0f3f1"), caption: "Coupe homme" },
        { url: IMG("1522337094846-8a818192de1f"), caption: "Brushing" },
        { url: IMG("1487412947147-5cebf100ffc2"), caption: "L'ambiance" },
      ],
    }},
    { id: "testimonials", type: "testimonials", enabled: true, order: 5, data: {
      title: "Ils nous font confiance",
      source: "manual",
      items: [
        { name: "Camille M.", rating: 5, text: "La meilleure coloriste que j'ai rencontrée. Mon balayage est naturel et tient des mois. On se sent écoutée du début à la fin." },
        { name: "Thomas L.", rating: 5, text: "Accueil chaleureux, salon magnifique et une coupe parfaite à chaque fois. La prise de rendez-vous en ligne est hyper pratique." },
        { name: "Sofia B.", rating: 5, text: "Un vrai moment de détente. Ils ont su comprendre exactement ce que je voulais. Je ressors toujours avec le sourire." },
      ],
    }},
    { id: "faq", type: "faq", enabled: true, order: 6, data: {
      title: "Questions fréquentes",
      items: [
        { question: "Comment prendre rendez-vous ?", answer: "En ligne, directement sur cette page — choisissez votre prestation et votre créneau en moins d'une minute, sans appel." },
        { question: "Puis-je annuler ou reporter ?", answer: "Oui, jusqu'à 24h avant votre rendez-vous, simplement depuis votre e-mail de confirmation." },
        { question: "Proposez-vous un diagnostic ?", answer: "Bien sûr — un temps d'échange offert pour comprendre vos envies et définir le meilleur pour vous." },
      ],
    }},
    { id: "booking", type: "booking", enabled: true, order: 7, data: {
      title: "Prêt·e à changer de tête ?",
      subtitle: "Réservez votre créneau en ligne en moins d'une minute, sans appel.",
      embedMode: "full",
    }},
    { id: "cta", type: "cta", enabled: true, order: 8, data: {
      title: "Offrez-vous un moment rien qu'à vous",
      text: "Nos coiffeur·se·s vous accueillent du mardi au samedi.",
      buttonText: "Prendre rendez-vous",
      buttonUrl: "#booking",
      bg: "gradient",
    }},
    { id: "contact", type: "contact", enabled: true, order: 9, data: {
      title: "Passez nous voir",
      phone: "", email: "", address: "",
    }},
  ],
};

const TEMPLATES = [ATELIER, SERENITE, STUDIO];

// Métadonnées légères pour afficher les cartes dans l'éditeur (sans balancer
// tout le contenu des sections au rendu de la page).
function listMeta() {
  return TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    tagline: t.tagline,
    description: t.description || "",
    bestFor: t.bestFor || "",
    features: t.features || [],
    sectionsCount: (t.sections || []).length,
    thumb: t.thumb,
  }));
}

function getById(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

module.exports = { TEMPLATES, listMeta, getById };
