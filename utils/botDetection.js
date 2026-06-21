// Détection des bots/scripts par leur user-agent. Utilisée en filtre de
// secours — la vraie protection contre les bots vient du fait que le compteur
// de vues n'est déclenché que par du JavaScript exécuté dans un navigateur
// (voir public/js/pageview-beacon.js), ce qu'aucun script (curl, requests,
// scanners...) ne fait.
const BOT_UA_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|ahrefs|semrush|mj12bot|dotbot|petalbot|yandex|baiduspider|curl|wget|python-requests|headlesschrome|phantomjs|scrapy|go-http-client|libredtail|java\/|okhttp|axios|node-fetch|postman|insomnia|importer|msie [1-8]\./i;

function isBotUserAgent(ua) {
  return !ua || BOT_UA_RE.test(ua);
}

module.exports = { isBotUserAgent };
