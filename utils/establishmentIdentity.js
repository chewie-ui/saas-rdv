// ── Identité publique d'un établissement ────────────────────────────────────
//
// Adresse, coordonnées, réseaux sociaux et description vivaient uniquement sur
// le COMPTE propriétaire. Un patron possédant deux établissements voyait donc
// l'adresse et les réseaux du premier s'afficher sur la page publique du
// second, qu'il venait pourtant de créer vide.
//
// Ces champs vivent désormais sur la Company. Ce module est le SEUL endroit qui
// décide d'où vient chaque valeur — ne lisez jamais `owner.location` ni
// `company.location` en direct ailleurs.
//
// ── Le repli, et pourquoi il ne fuit pas ────────────────────────────────────
// L'établissement HISTORIQUE (celui que `User.company` désigne, créé à
// l'époque où un compte n'en avait qu'un) retombe sur les valeurs du compte
// tant qu'il n'a pas les siennes. C'est ce qui évite de vider les pages
// publiques existantes entre le déploiement et la migration.
//
// TOUS les autres établissements n'ont AUCUN repli : un établissement
// nouvellement créé démarre vide, point. C'est exactement la fuite qu'on
// corrige, et cette asymétrie la rend impossible — sans dépendre de l'ordre
// dans lequel le code et la migration sont déployés.

const FIELDS = [
  "location",
  "emailPro",
  "phonePro",
  "instagramLink",
  "facebookLink",
  "whatsappLink",
  "website",
  "description",
  "aboutHtml",
];

// L'établissement est-il celui d'origine du compte ?
function isPrimary(company, owner) {
  if (!company || !owner || !owner.company) return false;
  return String(owner.company) === String(company._id);
}

/**
 * Identité effective d'un établissement.
 * @param {object} company  document Company (ou objet lean)
 * @param {object} owner    document User propriétaire (ou objet lean)
 * @returns {object} les 9 champs, toujours définis (chaîne vide si absent)
 */
// `location` est un OBJET : un `{}` vide est truthy et masquerait le repli.
// On ne le considère renseigné que s'il porte au moins une valeur utile.
function hasLocation(loc) {
  if (!loc || typeof loc !== "object") return false;
  return !!(loc.address || loc.city || loc.zip || loc.gmapUrl || loc.iframeUrl || loc.lat);
}

function identityFor(company, owner) {
  const primary = isPrimary(company, owner);
  const out = {};
  for (const f of FIELDS) {
    const own = company ? company[f] : null;
    // `phonePro` a un repli supplémentaire côté compte : le téléphone perso
    // servait d'adresse de repli avant l'existence d'un téléphone pro.
    const legacy = primary && owner ? owner[f] || (f === "phonePro" ? owner.phone : "") || "" : "";

    if (f === "location") {
      out[f] = hasLocation(own) ? own : (primary && owner ? owner.location || null : null);
      continue;
    }
    out[f] = own || legacy || "";
  }
  return out;
}

module.exports = { identityFor, isPrimary, IDENTITY_FIELDS: FIELDS };
