const Client = require("../db/models/client.model");

/**
 * Variante de isClientAuth qui accepte AUSSI un User connecté (cf. plan
 * d'unification des comptes) — un compte "pro" ou "client" inscrit via le
 * formulaire unifié peut consulter ses propres réservations sans avoir de
 * compte Client séparé. Priorité à req.user ; repli sur l'ancien compte
 * Client (req.session.clientId) tant que tous les comptes n'ont pas été
 * fusionnés (cf. scripts/migrate-merge-client-into-user.js).
 *
 * ⚠️ Ne PAS utiliser ce middleware sur les routes qui écrivent dans le
 * modèle Client (ex: /espace-client/parametres/*) — req.client serait alors
 * un User, et un `Client.findByIdAndUpdate(req.client._id, ...)` échouerait
 * silencieusement (mauvaise collection). Ces routes restent sur isClientAuth.
 */
module.exports = async (req, res, next) => {
  if (req.user) {
    req.client = req.user;
    res.locals.client = req.user;
    return next();
  }

  const clientId = req.session?.clientId;
  if (!clientId) return res.redirect("/login");

  try {
    const client = await Client.findById(clientId).lean();
    if (!client) {
      req.session.clientId = null;
      return res.redirect("/login");
    }
    req.client = client;
    res.locals.client = client;
    return next();
  } catch (err) {
    return res.redirect("/login");
  }
};
