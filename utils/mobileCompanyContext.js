// ── Contexte établissement pour l'API mobile (équivalent stateless de
// middlewares/injectCompany.js) ───────────────────────────────────────────
// À partir d'un User authentifié et d'un companyId optionnel (choisi par
// l'app), résout l'établissement actif, le rôle (owner/collaborateur) et les
// permissions résolues. Réutilise EXACTEMENT les mêmes règles que l'app web :
//   - établissements possédés : Company.owner === user._id
//   - + établissements rejoints : CompanyMembership accepté & actif
//   - permissions via resolvePermissions({ isOwner, grade })
const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const User = require("../db/models/user.model");
const { resolvePermissions } = require("./permissions");
const { billingUserFor } = require("./planLimits");

// Reconstruit le « billingUser » de l'app web (middlewares/injectCompany.js) :
// un objet minimal lu par getPlan()/getLimit(), portant le plan de
// L'ÉTABLISSEMENT et non celui du compte connecté. Ainsi un collaborateur d'un
// établissement Business bénéficie bien des limites Business.
async function buildBillingUser(company, currentUser) {
  const isOwner = String(company.owner) === String(currentUser._id);
  const ownerUser = isOwner
    ? currentUser
    : await User.findById(company.owner)
        .select("subscription isPremium manualPremium manualPremiumExpiry addons")
        .lean();

  // Repli sur `currentUser` si l'owner a été supprimé : `billingUserFor`
  // renverrait `_id: null`, or l'appelant s'en sert comme identité de
  // facturation (addons, crédits SMS).
  return billingUserFor(company, ownerUser || currentUser);
}

// Retourne la liste des établissements accessibles à ce user, chacun avec son
// rôle. Sert au sélecteur d'établissement dans l'app.
async function listCompanies(user) {
  const owned = await Company.find({ owner: user._id, isDeleted: { $ne: true } })
    .sort({ createdAt: 1 })
    .lean();

  const memberships = await CompanyMembership.find({
    user: user._id,
    status: "accepted",
    isActive: { $ne: false },
  })
    .populate("grade")
    .lean();

  const membershipByCompanyId = {};
  memberships.forEach((m) => {
    membershipByCompanyId[String(m.company)] = { grade: m.grade || null };
  });

  const memberCompanies = memberships.length
    ? await Company.find({
        _id: { $in: memberships.map((m) => m.company) },
        isDeleted: { $ne: true },
      }).lean()
    : [];

  const list = [
    ...owned.map((c) => ({ company: c, isOwner: true, grade: null })),
    ...memberCompanies.map((c) => ({
      company: c,
      isOwner: false,
      grade: membershipByCompanyId[String(c._id)]?.grade || null,
    })),
  ];

  return { list, membershipByCompanyId };
}

// Résout l'établissement ACTIF (celui demandé par l'app, sinon le premier
// accessible) + permissions. Renvoie null si le user n'a accès à aucun.
// `options.strict` : refuse (au lieu de retomber sur le premier établissement)
// quand l'identifiant demandé n'est pas accessible. Sans cela, un en-tête
// X-Company-Id périmé ou perdu faisait travailler l'utilisateur sur
// l'établissement A alors que son écran affichait le B — donc des écritures au
// mauvais endroit, sans le moindre signal. Le repli reste actif quand aucun
// identifiant n'est demandé, et pour /auth/me (qui doit pouvoir répondre le
// contexte réel afin que l'app se resynchronise).
async function resolveCompanyContext(user, requestedCompanyId, options = {}) {
  const { list } = await listCompanies(user);
  if (!list.length) return null;

  let active = null;
  if (requestedCompanyId) {
    active = list.find((c) => String(c.company._id) === String(requestedCompanyId)) || null;
    if (!active && options.strict) return { notAccessible: true };
  }
  if (!active) active = list[0]; // par défaut : la plus ancienne possédée, sinon 1re adhésion

  const permissions = resolvePermissions({ isOwner: active.isOwner, grade: active.grade });
  const billingUser = await buildBillingUser(active.company, user);

  return {
    currentCompany: active.company, // document Company (lean)
    billingUser, // porte le plan de l'établissement (limites, gates Pro/Business)
    plan: billingUser.subscription.plan,
    isOwner: active.isOwner,
    role: active.isOwner ? "owner" : active.grade?.name || null,
    permissions,
    companies: list.map((c) => ({
      id: String(c.company._id),
      name: c.company.name || "Établissement",
      // La photo suit l'établissement partout dans l'app (sélecteur, profil,
      // liste) : sans elle, seul l'écran « Mes établissements » l'affichait.
      photo: c.company.photo || "",
      isOwner: c.isOwner,
      role: c.isOwner ? "owner" : c.grade?.name || null,
    })),
  };
}

module.exports = { listCompanies, resolveCompanyContext };
