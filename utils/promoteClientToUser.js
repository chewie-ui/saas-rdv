/**
 * Promotion d'un compte Client legacy en compte User, à la volée.
 *
 * POURQUOI. `Company.owner` référence un **User**. Un `Client` (ancien compte
 * séparé de l'espace client) ne peut donc posséder aucun établissement. La
 * barre latérale testait `!user` — vrai pour un Client connecté — et le
 * renvoyait vers `/register?intent=pro`, c'est-à-dire l'inscription COMPLÈTE :
 * on lui redemandait nom, email et mot de passe alors qu'il avait déjà un
 * compte. Plutôt que de lui faire créer un doublon, on promeut son compte.
 *
 * C'est la version « un compte à la fois » de scripts/migrate-merge-client-into-user.js,
 * dont elle reprend `promoteOne()` et `repointRefs()`. Les deux peuvent
 * coexister : la migration globale ignore les Clients déjà disparus.
 *
 * SÉCURITÉ. On ne connecte JAMAIS automatiquement quelqu'un à un `User`
 * préexistant qui porterait le même email : ce serait une prise de contrôle de
 * compte si le Client avait été créé avec une adresse qui ne lui appartient
 * pas. Ce cas renvoie `{ conflit: true }` et l'appelant redirige vers la
 * connexion. En pratique il ne devrait plus survenir (l'inscription Client
 * refuse un email déjà porté par un User, cf. controllers/client.controller.js),
 * mais d'anciennes données peuvent encore contenir la collision.
 */
const User = require("../db/models/user.model");
const Client = require("../db/models/client.model");
const Booking = require("../db/models/book.model");
const Review = require("../db/models/review.model");
const ClientDossier = require("../db/models/clientDossier.model");

async function repointRefs(fromId, toId) {
  await Booking.updateMany({ clientRef: fromId }, { clientRef: toId });
  await Review.updateMany({ client: fromId }, { client: toId });
  await ClientDossier.updateMany({ clientRef: fromId }, { clientRef: toId });
}

/**
 * @param {string} clientId
 * @returns {Promise<{user?: object, conflit?: boolean, introuvable?: boolean}>}
 */
async function promoteClientToUser(clientId) {
  const client = await Client.findById(clientId).lean();
  if (!client) return { introuvable: true };

  const email = String(client.email || "").toLowerCase().trim();
  const existant = email ? await User.findOne({ email }).lean() : null;
  if (existant) return { conflit: true, email };

  // `accountIntent: "pro"` — contrairement à la migration globale (qui promeut
  // en "client"), on est ici précisément dans le geste « je crée mon
  // établissement ».
  const user = await User.create({
    fullName: client.fullName,
    email,
    password: client.password,
    googleId: client.googleId || null,
    phone: client.phone || "",
    profilePicture: client.profilePicture || undefined,
    preferredLang: client.preferredLang || "fr",
    accountIntent: "pro",
  });

  // Historique de réservations, avis et dossiers : repointés pour que l'espace
  // client reste identique après la bascule.
  await repointRefs(client._id, user._id);
  await Client.findByIdAndDelete(client._id);

  return { user };
}

module.exports = { promoteClientToUser, repointRefs };
