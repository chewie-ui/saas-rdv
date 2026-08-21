// ── Survie d'un client à la suppression de ses rendez-vous ─────────────────
// La liste clients se construit à partir des RENDEZ-VOUS (cf. clientsHubInit).
// Conséquence : supprimer le dernier rendez-vous d'une personne la faisait
// disparaître de la liste — avec ses coordonnées, son surnom et l'accès à son
// dossier. Un pro qui corrigeait une erreur de saisie perdait le client.
//
// On pose donc un dossier « témoin » AVANT la suppression, marqué
// `hadBookings`, qui garde la personne visible. S'il existe déjà (notes,
// blocage…), on se contente de lever le drapeau : aucune donnée n'est écrasée.
const ClientDossier = require("../db/models/clientDossier.model");
const { dossierKey } = require("./dossierKey");

/**
 * @param {ObjectId|string} companyId
 * @param {object} booking  le rendez-vous sur le point d'être supprimé
 * @returns {Promise<boolean>} true si un client a été préservé
 */
async function preserveClient(companyId, booking) {
  if (!booking) return false;
  // Une absence n'a pas de client : rien à préserver.
  if (booking.isBlock) return false;

  const fullName = `${booking.name || ""} ${booking.surname || ""}`.trim();
  const cle = dossierKey({
    email: booking.email,
    phone: booking.phone,
    fullName,
  });
  // Sans e-mail, téléphone NI nom, il n'y a rien pour reconnaître la personne
  // d'une fois sur l'autre — un dossier vide ne servirait à rien.
  if (!cle) return false;

  await ClientDossier.findOneAndUpdate(
    { company: companyId, clientKey: cle },
    {
      $set: { hadBookings: true },
      // Les coordonnées ne sont posées qu'à la CRÉATION : si un dossier existe
      // déjà, ses champs peuvent avoir été corrigés à la main par le pro et ne
      // doivent pas être remplacés par ceux, plus anciens, du rendez-vous.
      $setOnInsert: {
        company: companyId,
        email: (booking.email || "").trim().toLowerCase(),
        phone: booking.phone || "",
        fullName,
      },
    },
    { upsert: true, new: true },
  );
  return true;
}

module.exports = { preserveClient };
