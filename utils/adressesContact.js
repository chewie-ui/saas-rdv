/**
 * Les adresses e-mail publiques de BranShee, en un seul endroit.
 *
 * Elles étaient écrites en dur à quatre endroits — dont deux fois une adresse
 * Gmail personnelle affichée aux professionnels sur la page Support. Changer
 * de boîte demandait de repasser dans le code ; et la page Contact annonçait
 * déjà `support@branshee.com`, une boîte qui n'existait pas, donc tout ce qui
 * y était envoyé rebondissait.
 *
 * Tout se règle désormais par variables d'environnement, avec des replis en
 * cascade : une variable oubliée ne fait jamais disparaître une adresse, elle
 * retombe sur la précédente.
 */

/** Boîte qui reçoit les messages internes (contact, signalements, parrainage). */
function adminEmail() {
  return process.env.ADMIN_EMAIL || process.env.SUPPORT_EMAIL || "info@branshee.com";
}

/** Adresse AFFICHÉE aux professionnels (page Support, page Contact). */
function supportEmail() {
  return process.env.SUPPORT_EMAIL || process.env.ADMIN_EMAIL || "info@branshee.com";
}

/**
 * Expéditeur des e-mails transactionnels. Distinct des deux précédentes :
 * c'est un domaine signé (SPF/DKIM) côté Brevo, en changer sans refaire la
 * configuration DNS enverrait tous les messages en indésirables.
 */
function expediteur() {
  return {
    email: process.env.MAIL_FROM || "noreply@branshee.com",
    name: process.env.MAIL_FROM_NAME || "BranShee",
  };
}

module.exports = { adminEmail, supportEmail, expediteur };
