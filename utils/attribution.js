// ── Attribution du trafic (d'où vient un visiteur, puis un inscrit) ─────────
//
// Deux usages distincts, à ne pas confondre :
//
//   1. PAR VISITE  → alimente `PageView` (tableau de bord trafic superadmin).
//      C'est la source de CETTE page vue : on veut voir "google-ads" le jour
//      du clic, pas pendant les 90 jours suivants.
//
//   2. FIRST-TOUCH → cookie `bs_attr`, recopié sur `User.acquisition` à
//      l'inscription. C'est ce qui permet de répondre à la seule question qui
//      compte : « ce client qui paie, quelle campagne me l'a amené ? ».
//      Posé UNE fois (premier contact) et jamais écrasé : quelqu'un qui clique
//      une pub puis revient en direct une semaine plus tard reste attribué à
//      la pub, sinon toute la valeur des campagnes est volée par le "direct".
//
// Les valeurs viennent de l'URL, donc de l'extérieur : elles sont tronquées et
// nettoyées avant stockage (elles finissent affichées dans le superadmin).

const MAX_LEN = 120;
const COOKIE_NAME = "bs_attr";
// 90 jours : au-delà, rattacher une inscription à un clic devient du bruit.
const COOKIE_MAX_AGE = 90 * 24 * 60 * 60 * 1000;

// Retire les caractères de contrôle et borne la longueur — un `utm_campaign`
// est saisi librement dans l'URL par n'importe qui.
function clean(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, MAX_LEN);
}

// Domaine du referrer ("google.com"), ou "" si absent/interne/illisible.
function referrerHost(referrerUrl, ownHostname) {
  if (!referrerUrl) return "";
  try {
    const host = new URL(referrerUrl).hostname.replace(/^www\./, "");
    if (host === String(ownHostname || "").replace(/^www\./, "")) return "";
    return host;
  } catch (_) {
    return "";
  }
}

/**
 * Construit l'attribution à partir des paramètres d'URL + du referrer.
 *
 * @param query      objet des paramètres d'URL (req.query, ou parsé du beacon)
 * @param referrer   document.referrer / en-tête Referer
 * @param ownHost    hôte du site, pour ignorer la navigation interne
 * @returns {{source,medium,campaign,term,content,gclid,referrer}} — `source`
 *          vaut "direct" si rien n'a pu être déterminé.
 */
function parseAttribution(query, referrer, ownHost) {
  const q = query || {};
  const gclid = clean(q.gclid || q.wbraid || q.gbraid);
  const utmSource = clean(q.utm_source);
  const utmMedium = clean(q.utm_medium);
  const host = referrerHost(referrer, ownHost);

  let source = utmSource;
  let medium = utmMedium;

  // Un `gclid` est la signature d'un clic Google Ads payant : il fait foi même
  // sans utm_source, car l'auto-tagging Google ne pose souvent QUE ce
  // paramètre. C'est précisément le cas qui tombait en "direct" jusqu'ici.
  if (!source && gclid) {
    source = "google-ads";
    medium = medium || "cpc";
  }
  // Sinon on retombe sur le referrer (SEO, réseaux sociaux, annuaires...).
  if (!source && host) {
    source = host;
    medium = medium || "referral";
  }

  return {
    source:   source || "direct",
    medium:   medium || "",
    campaign: clean(q.utm_campaign),
    term:     clean(q.utm_term),
    content:  clean(q.utm_content),
    gclid,
    referrer: host,
  };
}

// Une attribution ne vaut la peine d'être mémorisée que si elle dit d'où vient
// vraiment la personne. "direct" sans referrer n'apprend rien : on ne pose pas
// le cookie, pour laisser sa chance à une vraie source plus tard.
function isMeaningful(attr) {
  return !!(attr && (attr.gclid || attr.campaign || (attr.source && attr.source !== "direct")));
}

/**
 * Pose le cookie first-touch s'il n'existe pas déjà. Ne l'écrase JAMAIS.
 * Best-effort : ne doit jamais faire échouer une requête.
 */
function rememberFirstTouch(req, res, attr) {
  try {
    if (!isMeaningful(attr)) return;
    if (req.cookies && req.cookies[COOKIE_NAME]) return; // premier contact déjà enregistré

    const payload = {
      s: attr.source,
      m: attr.medium,
      c: attr.campaign,
      t: attr.term,
      o: attr.content,
      g: attr.gclid,
      r: attr.referrer,
      l: clean(req.path || ""), // page d'atterrissage
      d: new Date().toISOString().slice(0, 10),
    };
    // Champs vides retirés : le cookie doit rester petit (limite ~4 Ko).
    Object.keys(payload).forEach((k) => { if (!payload[k]) delete payload[k]; });

    res.cookie(COOKIE_NAME, JSON.stringify(payload), {
      maxAge: COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  } catch (_) {
    // L'attribution ne doit jamais casser une page.
  }
}

/**
 * Relit le cookie first-touch, au format `User.acquisition`.
 * Retourne null si absent ou illisible.
 */
function readFirstTouch(req) {
  try {
    const raw = req.cookies && req.cookies[COOKIE_NAME];
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    return {
      source:     clean(p.s) || "direct",
      medium:     clean(p.m),
      campaign:   clean(p.c),
      term:       clean(p.t),
      content:    clean(p.o),
      gclid:      clean(p.g),
      referrer:   clean(p.r),
      landing:    clean(p.l),
      capturedAt: p.d ? new Date(p.d) : null,
    };
  } catch (_) {
    return null;
  }
}

module.exports = {
  parseAttribution,
  rememberFirstTouch,
  readFirstTouch,
  isMeaningful,
  COOKIE_NAME,
};
