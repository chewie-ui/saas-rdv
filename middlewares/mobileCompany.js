// ── Résout l'établissement actif pour une requête API mobile ──────────────
// À placer après mobileAuth. Lit le companyId choisi par l'app (query
// ?companyId= ou en-tête X-Company-Id), résout le contexte (établissement +
// permissions) et l'attache sur req.companyCtx. 403 si le user n'a accès à
// aucun établissement.
const { resolveCompanyContext } = require("../utils/mobileCompanyContext");

module.exports = async function mobileCompany(req, res, next) {
  try {
    const requestedCompanyId = req.query.companyId || req.headers["x-company-id"];
    // `strict` : un identifiant demandé mais inaccessible doit échouer, jamais
    // basculer en silence sur un autre établissement (risque d'écriture au
    // mauvais endroit). /auth/me, lui, garde le repli pour permettre à l'app
    // de se resynchroniser sur l'établissement réellement actif.
    const ctx = await resolveCompanyContext(req.mobileUser, requestedCompanyId, { strict: true });
    if (ctx && ctx.notAccessible) {
      return res.status(403).json({
        error: "company_not_accessible",
        message: "Cet établissement n'est plus accessible avec ce compte. Rechargez la liste de vos établissements.",
      });
    }
    if (!ctx) {
      return res.status(403).json({
        error: "no_company",
        message: "Aucun établissement associé à ce compte.",
      });
    }
    req.companyCtx = ctx;
    next();
  } catch (err) {
    console.error("[mobileCompany]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// Fabrique un middleware qui exige une permission "zone.key" sur le contexte
// établissement courant. L'owner a tout ; sinon on lit req.companyCtx.permissions.
module.exports.requirePermission = function requirePermission(path) {
  const [zone, key] = path.split(".");
  return (req, res, next) => {
    const perms = req.companyCtx?.permissions;
    if (perms && perms[zone] && perms[zone][key]) return next();
    res.status(403).json({ error: "forbidden", message: "Vous n'avez pas la permission requise." });
  };
};
