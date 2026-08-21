// ── Identité d'un dossier client ───────────────────────────────────────────
// Le dossier était identifié par (établissement, e-mail), l'e-mail étant
// obligatoire. Conséquence : un rendez-vous saisi par le pro avec seulement un
// nom — cas courant quand il note un client au téléphone — n'avait AUCUN
// dossier possible. Le bouton « Dossier client » disparaissait, sans
// explication, et il n'y avait aucun moyen d'en ouvrir un.
//
// La clé suit désormais exactement la précédence déjà utilisée par la liste
// clients (cf. clientsHubInit) : e-mail, sinon téléphone, sinon nom. Un même
// client est ainsi regroupé de la même façon dans la liste et dans son
// dossier — sans cette cohérence, la fiche et la ligne de liste pourraient
// désigner deux personnes différentes.
//
// Les préfixes (`mail:`, `tel:`, `nom:`) évitent qu'un numéro saisi dans le
// champ e-mail, ou un nom qui ressemble à un numéro, ne fusionne deux clients
// distincts.

function normaliserNom(prenom, nom) {
  return `${prenom || ""} ${nom || ""}`
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * @param {object} c { email, phone, firstName, lastName, fullName }
 * @returns {string} clé stable, ou "" si rien d'exploitable
 */
function dossierKey(c) {
  const email = String(c.email || "").trim().toLowerCase();
  if (email) return "mail:" + email;

  // Seuls les chiffres comptent : « 0477 44 39 88 » et « +32477443988 »
  // doivent désigner le même client.
  const tel = String(c.phone || "").replace(/[^\d]/g, "");
  if (tel) return "tel:" + tel;

  const nom = c.fullName
    ? String(c.fullName).trim().replace(/\s+/g, " ").toLowerCase()
    : normaliserNom(c.firstName, c.lastName);
  if (nom) return "nom:" + nom;

  return "";
}

module.exports = { dossierKey, normaliserNom };
