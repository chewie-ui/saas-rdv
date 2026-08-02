const PageView = require("../db/models/pageView.model");
const User = require("../db/models/user.model");
const Company = require("../db/models/company/company.model");
const Booking = require("../db/models/book.model");

/**
 * Page superadmin « Acquisition ».
 *
 * Les vues sont déjà collectées (middlewares/trackPageView.js + beacon), mais
 * elles n'étaient exploitées nulle part : la page Utilisateurs se contentait
 * d'un « top 8 des sources, depuis toujours ». Impossible de savoir si une
 * action donnée avait servi à quelque chose.
 *
 * Le parti pris de cette page : ne jamais mélanger les trois natures de
 * trafic. Un pro qui consulte son propre agenda n'est pas un prospect, et un
 * client qui réserve chez Cécile n'est pas venu pour BranShee. Les additionner
 * donne un chiffre flatteur et faux.
 */

// Pages « produit » : c'est là qu'un prospect atterrit et se décide.
const CHEMINS_ACQUISITION = new Set([
  "/", "/search", "/register", "/login", "/contact", "/subscription",
  "/demarrer", "/forgot-password", "/reset-password", "/s-inscrire",
  "/confidentialite", "/conditions-utilisation", "/blog",
]);
// Espaces connectés : usage d'un compte existant, pas de l'acquisition.
const PREFIXES_INTERNES = [
  "/espace-client", "/etablissement", "/appointment", "/clients", "/clients-hub",
  "/services", "/availability", "/history", "/settings", "/customize",
  "/mon-site", "/employees", "/group-sessions", "/informations", "/forms",
  "/support", "/subscription/", "/auth", "/superadmin", "/dashboard", "/book",
];

/**
 * Range un chemin dans l'une des trois natures.
 * Tout ce qui n'est ni produit ni interne est une page publique de pro
 * (`/mon-slug`, ou `/<id>` pour les fiches sans slug).
 */
function natureDuChemin(chemin) {
  const p = String(chemin || "").split("?")[0].replace(/\/+$/, "") || "/";
  if (CHEMINS_ACQUISITION.has(p)) return "acquisition";
  if (p.startsWith("/blog/")) return "acquisition";
  if (PREFIXES_INTERNES.some((prefixe) => p === prefixe || p.startsWith(prefixe + "/"))) return "interne";
  return "reservation";
}

const PERIODES = { "7": 7, "30": 30, "90": 90, tout: null };

/**
 * Range une source dans un canal. Sans ça, la liste brute mélange le trafic
 * qui compte, les renvois des régies publicitaires et le spam de referrer —
 * et le total « 686 visiteurs » paraît bien meilleur qu'il ne l'est.
 */
const CANAUX = [
  { cle: "recherche", libelle: "Recherche", motifs: [/^google\.[a-z.]+$/, /^(www\.)?bing\.com$/, /duckduckgo\.com$/, /ecosia\.org$/, /qwant\.com$/, /yahoo\./, /yandex\./] },
  { cle: "social", libelle: "Réseaux sociaux", motifs: [/youtube\.com$/, /facebook\.com$/, /instagram\.com$/, /linkedin\.com$/, /tiktok\.com$/, /^t\.co$/, /^(x|twitter)\.com$/, /pinterest\./, /reddit\.com$/, /whatsapp\.com$/] },
  { cle: "publicite", libelle: "Régies publicitaires", motifs: [/^google-ads$/, /googlesyndication\.com$/, /doubleclick\.net$/, /syndicatedsearch\.goog$/, /googleadservices\.com$/] },
];

// Spam de referrer : des robots visitent le site en se faisant passer pour un
// site tiers, dans l'espoir d'apparaître dans les statistiques. Ils ne
// correspondent à personne. Signature typique : sous-domaine alphanumérique
// court sur un domaine exotique.
const MOTIFS_SPAM = [
  /\.biz\.id$/, /\.my\.id$/, /\.web\.id$/, /\.or\.id$/,
  /^[a-z]{2,8}\d{1,3}\./,
  /buttons-for-website|semalt|darodar|ilovevitaly|hulfingtonpost|4webmasters/,
];

function canalDeLaSource(source) {
  const s = String(source || "direct").toLowerCase();
  if (s === "direct" || !s) return { cle: "direct", libelle: "Direct" };
  if (MOTIFS_SPAM.some((r) => r.test(s))) return { cle: "spam", libelle: "Spam de referrer" };
  for (const c of CANAUX) {
    if (c.motifs.some((r) => r.test(s))) return { cle: c.cle, libelle: c.libelle };
  }
  return { cle: "site", libelle: "Autres sites" };
}

exports.acquisitionPage = async (req, res) => {
  try {
    const clePeriode = Object.keys(PERIODES).includes(req.query.periode) ? req.query.periode : "30";
    const jours = PERIODES[clePeriode];
    const depuis = jours ? new Date(Date.now() - jours * 86400000) : null;
    const filtreDate = depuis ? { createdAt: { $gte: depuis } } : {};

    const [vues, inscrits, nouvellesCompagnies] = await Promise.all([
      PageView.find(filtreDate).select("visitorId path source campaign createdAt").lean(),
      User.find(filtreDate).select("acquisition createdAt").lean(),
      Company.find({ ...filtreDate, isDeleted: { $ne: true } }).select("_id").lean(),
    ]);
    // Combien de ces NOUVEAUX établissements ont déjà reçu un rendez-vous.
    // Comparer à l'ensemble des établissements donnerait un taux au-dessus de
    // 100 %, les anciens continuant évidemment d'encaisser des réservations.
    const idsNouveaux = nouvellesCompagnies.map((c) => c._id);
    const avecRdv = idsNouveaux.length
      ? (await Booking.distinct("company", { company: { $in: idsNouveaux } })).length
      : 0;

    // ── Répartition par nature ────────────────────────────────────────────
    const parNature = { acquisition: [], reservation: [], interne: [] };
    vues.forEach((v) => parNature[natureDuChemin(v.path)].push(v));

    const compter = (liste) => ({
      vues: liste.length,
      visiteurs: new Set(liste.map((v) => v.visitorId)).size,
    });
    const natures = {
      acquisition: compter(parNature.acquisition),
      reservation: compter(parNature.reservation),
      interne: compter(parNature.interne),
      total: compter(vues),
    };

    // ── Concentration : quelle part vient d'une poignée de visiteurs ? ─────
    // Un visiteur à 180 vues sur 30 jours est le patron ou un pro, pas un
    // prospect. Le dire évite de prendre son propre usage pour de l'audience.
    const parVisiteur = new Map();
    vues.forEach((v) => parVisiteur.set(v.visitorId, (parVisiteur.get(v.visitorId) || 0) + 1));
    const classement = [...parVisiteur.values()].sort((a, b) => b - a);
    const top10 = classement.slice(0, 10).reduce((s, n) => s + n, 0);
    const concentration = {
      partTop10: vues.length ? Math.round((top10 / vues.length) * 100) : 0,
      grosVisiteurs: classement.filter((n) => n >= 20).length,
    };

    // ── Sources, sur les pages produit uniquement ─────────────────────────
    const parSource = new Map();
    parNature.acquisition.forEach((v) => {
      const cle = (v.source || "direct") + (v.campaign ? " · " + v.campaign : "");
      if (!parSource.has(cle)) parSource.set(cle, { vues: 0, visiteurs: new Set() });
      const e = parSource.get(cle);
      e.vues += 1;
      e.visiteurs.add(v.visitorId);
    });
    const toutesSources = [...parSource.entries()]
      .map(([nom, e]) => ({
        nom,
        vues: e.vues,
        visiteurs: e.visiteurs.size,
        canal: canalDeLaSource(nom.split(" · ")[0]),
      }))
      .sort((a, b) => b.visiteurs - a.visiteurs);
    const sources = toutesSources.filter((s) => s.canal.cle !== "spam").slice(0, 12);
    const sourcesSpam = toutesSources.filter((s) => s.canal.cle === "spam");

    // Vue par canal : c'est ce qui répond vraiment à « d'où viennent les gens ».
    // Un visiteur peut arriver par plusieurs sources ; on compte donc les
    // visiteurs distincts par canal, ce qui peut légèrement dépasser le total.
    const parCanal = new Map();
    parNature.acquisition.forEach((v) => {
      const c = canalDeLaSource(v.source);
      if (!parCanal.has(c.cle)) parCanal.set(c.cle, { libelle: c.libelle, visiteurs: new Set(), vues: 0 });
      const e = parCanal.get(c.cle);
      e.visiteurs.add(v.visitorId);
      e.vues += 1;
    });
    const canaux = [...parCanal.entries()]
      .map(([cle, e]) => ({ cle, libelle: e.libelle, visiteurs: e.visiteurs.size, vues: e.vues }))
      .sort((a, b) => b.visiteurs - a.visiteurs);
    const visiteursHorsBruit = canaux
      .filter((c) => c.cle !== "spam" && c.cle !== "publicite")
      .reduce((s, c) => s + c.visiteurs, 0);

    // ── Pages les plus vues, par nature ──────────────────────────────────
    const topChemins = (liste, max = 8) => {
      const m = new Map();
      liste.forEach((v) => {
        const p = String(v.path || "").split("?")[0] || "/";
        if (!m.has(p)) m.set(p, { vues: 0, visiteurs: new Set() });
        const e = m.get(p);
        e.vues += 1;
        e.visiteurs.add(v.visitorId);
      });
      return [...m.entries()]
        .map(([chemin, e]) => ({ chemin, vues: e.vues, visiteurs: e.visiteurs.size }))
        .sort((a, b) => b.visiteurs - a.visiteurs)
        .slice(0, max);
    };

    // ── Entonnoir ────────────────────────────────────────────────────────
    // Mesuré en visiteurs UNIQUES, pas en vues : une personne qui recharge
    // trois fois la page d'inscription reste une personne.
    const visiteursSur = (predicat) =>
      new Set(parNature.acquisition.filter((v) => predicat(String(v.path || "").split("?")[0])).map((v) => v.visitorId)).size;

    const etapes = [
      { nom: "Ont vu une page BranShee", valeur: natures.acquisition.visiteurs, aide: "visiteurs uniques sur les pages produit" },
      { nom: "Ont ouvert l'inscription", valeur: visiteursSur((p) => p === "/register" || p === "/s-inscrire"), aide: "page /register" },
      { nom: "Ont créé un compte", valeur: inscrits.length, aide: "comptes réellement créés" },
      { nom: "Ont créé un établissement", valeur: idsNouveaux.length, aide: "établissements créés sur la période" },
      { nom: "Ont reçu un premier rendez-vous", valeur: avecRdv, aide: "parmi ces nouveaux établissements" },
    ];
    // Taux de passage d'une étape à la suivante, et non depuis le début : c'est
    // la marche à franchir qui indique où ça coince.
    etapes.forEach((e, i) => {
      const precedent = i === 0 ? null : etapes[i - 1].valeur;
      e.taux = precedent ? Math.round((e.valeur / precedent) * 100) : null;
      e.largeur = etapes[0].valeur ? Math.max(2, Math.round((e.valeur / etapes[0].valeur) * 100)) : 0;
    });

    // ── Provenance des comptes créés ─────────────────────────────────────
    // La seule mesure qui relie une source à un compte réel. `acquisition` est
    // figée à l'inscription (utils/attribution.js) et jamais recalculée.
    const parProvenance = new Map();
    let sansProvenance = 0;
    inscrits.forEach((u) => {
      const src = u.acquisition && u.acquisition.source;
      if (!src) return sansProvenance++;
      const cle = src + (u.acquisition.campaign ? " · " + u.acquisition.campaign : "");
      parProvenance.set(cle, (parProvenance.get(cle) || 0) + 1);
    });
    const provenances = [...parProvenance.entries()]
      .map(([nom, n]) => ({ nom, n }))
      .sort((a, b) => b.n - a.n);

    res.render("superadmin/acquisition", {
      saPage: "acquisition",
      pageName: "Acquisition",
      periode: clePeriode,
      libellePeriode: jours ? `${jours} derniers jours` : "depuis le début",
      natures,
      concentration,
      sources,
      sourcesSpam,
      canaux,
      visiteursHorsBruit,
      etapes,
      provenances,
      sansProvenance,
      pagesProduit: topChemins(parNature.acquisition),
      pagesReservation: topChemins(parNature.reservation, 6),
      pagesInternes: topChemins(parNature.interne, 5),
    });
  } catch (err) {
    console.error("acquisitionPage error:", err);
    res.status(500).send("Erreur serveur.");
  }
};

exports.natureDuChemin = natureDuChemin; // exporté pour les tests
// Exporté pour le tableau de bord, qui a besoin de la MÊME définition de
// « page produit » : deux listes séparées finiraient par diverger et les deux
// pages annonceraient des nombres de visiteurs différents.
exports.CHEMINS_ACQUISITION = CHEMINS_ACQUISITION;
