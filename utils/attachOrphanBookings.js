const Booking = require("../db/models/book.model");

/**
 * Rattache à un compte client les réservations faites SANS compte.
 *
 * Le tableau de bord client filtre sur `clientRef`. Or une réservation prise
 * en invité — le cas de loin le plus fréquent : on remplit juste son email —
 * n'a pas de `clientRef`, seulement un `email`. Résultat : la personne créait
 * ensuite un compte avec ce même email, se connectait, et ne voyait AUCUN de
 * ses rendez-vous.
 *
 * On rattache donc les réservations orphelines portant exactement cet email.
 * Appelé aux moments où l'appartenance de l'email est établie (inscription,
 * connexion, connexion Google) plutôt qu'en filtrant par email à l'affichage :
 * `clientRef` reste la seule source de vérité, et une simple homonymie d'email
 * dans une requête de lecture ne peut pas exposer les RDV de quelqu'un d'autre.
 *
 * @param {object} client  document ClientUser (doit avoir _id et email)
 * @returns {Promise<number>} nombre de réservations rattachées
 */
async function attachOrphanBookings(client) {
  if (!client || !client._id || !client.email) return 0;

  const email = String(client.email).trim().toLowerCase();
  if (!email) return 0;

  const res = await Booking.updateMany(
    {
      // Uniquement les orphelines : on ne réattribue JAMAIS une réservation
      // déjà rattachée à un autre compte.
      $or: [{ clientRef: null }, { clientRef: { $exists: false } }],
      // Insensible à la casse : « Jean.Dupont@Gmail.com » à la réservation et
      // « jean.dupont@gmail.com » à l'inscription doivent se retrouver.
      email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    },
    { $set: { clientRef: client._id } }
  );

  return res.modifiedCount || 0;
}

module.exports = attachOrphanBookings;
