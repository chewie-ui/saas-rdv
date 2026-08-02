const User = require("../db/models/user.model");
const Booking = require("../db/models/book.model");
const PageView = require("../db/models/pageView.model");
const Company = require("../db/models/company/company.model");
const { CHEMINS_ACQUISITION } = require("./acquisition.controller");

/**
 * Page superadmin « Tableau de bord ».
 *
 * Le panel n'affichait que des totaux instantanés : « 34 comptes », « 187
 * rendez-vous ». Un total ne dit pas si ça monte ou si ça descend, et c'est
 * pourtant la seule chose qu'on veut savoir. Cette page ne montre donc que de
 * l'ÉVOLUTION : trois séries journalières sur 30 jours, chacune comparée aux
 * 30 jours précédents.
 *
 * Deux pièges volontairement évités ici :
 *  - les réservations sont comptées sur `createdAt` (date de PRISE) et non sur
 *    `date` (date du rendez-vous), sinon la courbe mesure le futur ;
 *  - un « client payant » est un abonnement Stripe actif, jamais un octroi
 *    manuel. Confondre les deux faisait croire à cinq clients payants alors
 *    qu'il y en a zéro.
 */

const JOURS = 30;
// Le produit vit à l'heure belge : découper les jours en UTC déplacerait une
// inscription de 01 h du matin sur la veille pendant tout l'été.
const FUSEAU = "Europe/Brussels";

// Géométrie des courbes. Le viewBox est étiré horizontalement par le CSS
// (preserveAspectRatio="none") ; la marge basse évite que les jours à zéro
// se confondent avec le bord de la carte.
const LARGEUR = 600;
const HAUTEUR = 150;
const MARGE = 10;

const formatteurJour = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSEAU,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
// en-CA rend directement « 2026-08-03 », soit la même clé que $dateToString.
const cleJour = (d) => formatteurJour.format(d);

const dateJour = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: FUSEAU } };

/**
 * Les 60 clés de jour, de la plus ancienne à aujourd'hui.
 * On avance de 24 h à partir d'une ancre à midi UTC : à midi UTC on est
 * toujours le même jour à Bruxelles, été comme hiver, donc aucun jour n'est
 * dupliqué ni sauté au changement d'heure.
 */
function clesDesJours(nb) {
  const ancre = new Date(cleJour(new Date()) + "T12:00:00Z").getTime();
  const cles = [];
  for (let i = nb - 1; i >= 0; i--) cles.push(cleJour(new Date(ancre - i * 86400000)));
  return cles;
}

/**
 * Remplit une série à partir d'une agrégation `{_id: "YYYY-MM-DD", n}`.
 * Sans ce remplissage les jours sans événement disparaîtraient et la courbe
 * mentirait sur l'échelle des abscisses.
 */
function serie(agregat, cles) {
  const parCle = new Map(agregat.map((l) => [l._id, l.n]));
  return cles.map((c) => parCle.get(c) || 0);
}

function pointsSvg(valeurs) {
  const max = Math.max(...valeurs, 1); // jamais 0 : une série vide diviserait par zéro
  const dernier = valeurs.length - 1;
  const pts = valeurs
    .map((v, i) => {
      const x = dernier > 0 ? (i * LARGEUR) / dernier : LARGEUR / 2;
      const y = HAUTEUR - MARGE - (v / max) * (HAUTEUR - MARGE * 2);
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(" ");
  return { pts, fillPts: `0,${HAUTEUR} ${pts} ${LARGEUR},${HAUTEUR}`, max };
}

function delta(courant, precedent) {
  if (!courant && !precedent) return null;
  if (!precedent) return { libelle: "Nouveau", positif: true };
  const p = Math.round(((courant - precedent) / precedent) * 100);
  return { libelle: `${p >= 0 ? "+" : ""}${p} %`, positif: p >= 0 };
}

const somme = (t) => t.reduce((s, n) => s + n, 0);

// « 3 août » à partir d'une clé « 2026-08-03 » — lecture en UTC pour ne pas
// reculer d'un jour sur un serveur configuré à l'ouest de Greenwich.
const libelleJour = (cle) =>
  new Date(cle + "T12:00:00Z").toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

// Même définition de « page produit » que la page Acquisition, d'où l'import :
// les visiteurs d'une page de réservation viennent voir un pro précis, pas
// BranShee, et les gonfler ici donnerait une courbe flatteuse et fausse.
const echappe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const REGEX_PRODUIT = new RegExp(
  "^(?:" + [...CHEMINS_ACQUISITION].map(echappe).join("|") + ")\\/?(?:\\?|$)|^\\/blog\\/"
);

exports.dashboardPage = async (req, res) => {
  try {
    const cles = clesDesJours(JOURS * 2);
    const clesPrecedent = cles.slice(0, JOURS);
    const clesCourant = cles.slice(JOURS);
    const debutPrecedent = clesPrecedent[0];
    const debutCourant = clesCourant[0];

    // Borne large en Date pour que l'index sur createdAt serve : le découpage
    // exact est fait juste après sur la clé de jour, en heure belge.
    const borne = new Date(Date.now() - (JOURS * 2 + 2) * 86400000);
    const parJour = [
      { $addFields: { j: dateJour } },
      { $match: { j: { $gte: debutPrecedent } } },
      { $group: { _id: "$j", n: { $sum: 1 } } },
    ];

    const [
      inscriptions,
      reservations,
      visiteursParJour,
      visiteursParFenetre,
      etablissementsBruts,
      payants,
      octrois,
    ] = await Promise.all([
      User.aggregate([{ $match: { createdAt: { $gte: borne } } }, ...parJour]),
      // createdAt = date de PRISE du rendez-vous. Aucun filtre sur `status` :
      // un rendez-vous annulé a quand même été pris, et l'exclure ferait
      // baisser rétroactivement des jours déjà passés.
      Booking.aggregate([{ $match: { createdAt: { $gte: borne } } }, ...parJour]),
      // Deux étages : un simple $sum compterait les vues, pas les visiteurs.
      PageView.aggregate([
        { $match: { createdAt: { $gte: borne }, path: REGEX_PRODUIT } },
        { $addFields: { j: dateJour } },
        { $match: { j: { $gte: debutPrecedent } } },
        { $group: { _id: { j: "$j", v: "$visitorId" } } },
        { $group: { _id: "$_id.j", n: { $sum: 1 } } },
      ]),
      // Le total d'une fenêtre n'est PAS la somme des jours : un visiteur
      // revenu trois fois compte une seule fois sur la période.
      PageView.aggregate([
        { $match: { createdAt: { $gte: borne }, path: REGEX_PRODUIT } },
        { $addFields: { j: dateJour } },
        { $match: { j: { $gte: debutPrecedent } } },
        {
          $group: {
            _id: {
              f: { $cond: [{ $gte: ["$j", debutCourant] }, "courant", "precedent"] },
              v: "$visitorId",
            },
          },
        },
        { $group: { _id: "$_id.f", n: { $sum: 1 } } },
      ]),
      // Même critère que la page Établissements (superadmin.controller.js) :
      // sans le filtre sur le nom affichable, les coquilles vides d'une
      // inscription jamais terminée feraient diverger les deux pages.
      Company.find({ isDeleted: { $ne: true } })
        .populate("owner", "businessName")
        .select("name isPaused owner")
        .lean(),
      // Signature exacte de ce que Stripe écrit lors d'un paiement
      // (admin.controller.js) : un identifiant « sub_… » ET un abonnement
      // actif. Un octroi manuel met manualPremium=true sans jamais poser
      // d'identifiant, il ne peut donc pas passer ici.
      // Le compte qui cumule les deux (le fondateur, qui s'est offert son
      // propre accès) est volontairement écarté : cette page doit sous-estimer
      // plutôt que gonfler — c'est l'inverse qui a fait croire à cinq clients.
      User.countDocuments({
        manualPremium: { $ne: true },
        "subscription.status": "active",
        "subscription.stripeSubscriptionId": /^sub_/,
      }),
      User.countDocuments({ manualPremium: true }),
    ]);

    const visiteurs = new Map(visiteursParFenetre.map((l) => [l._id, l.n]));

    const series = [
      {
        cle: "inscriptions",
        titre: "Inscriptions",
        icone: "person_add",
        aide: "Comptes créés, par jour",
        valeurs: serie(inscriptions, cles),
      },
      {
        cle: "reservations",
        titre: "Réservations",
        icone: "event_available",
        aide: "Rendez-vous pris, par jour de prise",
        valeurs: serie(reservations, cles),
      },
      {
        cle: "visiteurs",
        titre: "Visiteurs — pages produit",
        icone: "groups",
        aide: "Visiteurs distincts, par jour",
        valeurs: serie(visiteursParJour, cles),
        total: visiteurs.get("courant") || 0,
        totalPrecedent: visiteurs.get("precedent") || 0,
      },
    ];

    const graphiques = series.map((s) => {
      const valeurs = s.valeurs.slice(JOURS);
      const total = s.total !== undefined ? s.total : somme(valeurs);
      const totalPrecedent =
        s.totalPrecedent !== undefined ? s.totalPrecedent : somme(s.valeurs.slice(0, JOURS));
      return {
        cle: s.cle,
        titre: s.titre,
        icone: s.icone,
        aide: s.aide,
        total,
        totalPrecedent,
        delta: delta(total, totalPrecedent),
        ...pointsSvg(valeurs),
        debut: libelleJour(clesCourant[0]),
        milieu: libelleJour(clesCourant[Math.floor(JOURS / 2)]),
        fin: libelleJour(clesCourant[JOURS - 1]),
      };
    });

    const etablissements = etablissementsBruts.filter(
      (c) => (c.name || (c.owner && c.owner.businessName) || "").trim() !== ""
    );

    res.render("superadmin/tableau-de-bord", {
      saPage: "dashboard",
      title: "Tableau de bord — BranShee",
      pageName: "Tableau de bord",
      graphiques,
      parc: {
        etablissements: etablissements.length,
        actifs: etablissements.filter((c) => c.isPaused !== true).length,
        payants,
        octrois,
      },
    });
  } catch (err) {
    console.error("dashboardPage error:", err);
    res.status(500).send("Erreur serveur.");
  }
};
