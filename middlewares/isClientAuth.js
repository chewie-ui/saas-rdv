const Client = require("../db/models/client.model");

module.exports = async (req, res, next) => {
  const clientId = req.session?.clientId;
  if (!clientId) return res.redirect("/client/login");

  try {
    const client = await Client.findById(clientId).lean();
    if (!client) {
      req.session.clientId = null;
      return res.redirect("/client/login");
    }
    req.client = client;
    res.locals.client = client;
    return next();
  } catch (err) {
    return res.redirect("/client/login");
  }
};
