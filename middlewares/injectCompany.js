const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const Booking = require("../db/models/book.model");
const User = require("../db/models/user.model");
const { getLimit } = require("../utils/planLimits");
const { getAdminFeaturesFlags } = require("./featureFlag");
const { clientWord } = require("../utils/terminology");
const { resolvePermissions, resolveCanManageOwnTimeOff } = require("../utils/permissions");
const { activeSupervisions } = require("../utils/supervisionState");

module.exports = async (req, res, next) => {
  try {
    // 1. Sécurité : Si l'utilisateur n'est pas connecté, on ne fait rien
    // (Ce middleware doit normalement passer APRES isAuth)
    if (!req.user) {
      return next();
    }

    // 2. On cherche les companies dont l'owner est l'id de l'user connecté —
    // un User peut désormais en posséder plusieurs (cf. "Gérer mes
    // établissements") — et aussi celles qu'il a rejointes comme collaborateur
    // (accepté + actif). On choisit celle "active" pour cette session
    // (req.session.activeCompanyId, posée par /account/switch-company/:id),
    // sinon la plus ancienne possédée, sinon la première adhésion.
    const ownedCompanies = await Company.find({
      owner: req.user._id,
      isDeleted: { $ne: true },
    }).sort({ createdAt: 1 }).lean();

    const memberships = await CompanyMembership.find({
      user: req.user._id,
      status: "accepted",
      isActive: { $ne: false },
    }).populate("grade").lean();
    // Par company : grade assigné (objet CompanyGrade ou null si pas encore
    // assigné) + l'override individuel de congés posé par le patron sur ce
    // membership précis (cf. utils/permissions.js resolveCanManageOwnTimeOff).
    const membershipByCompanyId = {};
    memberships.forEach((m) => {
      membershipByCompanyId[String(m.company)] = {
        grade: m.grade || null,
        canManageOwnTimeOff: m.canManageOwnTimeOff,
      };
    });
    const memberCompanies = memberships.length
      ? await Company.find({ _id: { $in: memberships.map((m) => m.company) }, isDeleted: { $ne: true } }).lean()
      : [];

    // Disponible côté vue pour le switcher d'établissement (sidebar.pug) —
    // propriétaire d'abord, puis établissements rejoints comme collaborateur.
    res.locals.myCompanies = [
      ...ownedCompanies.map((c) => ({ id: String(c._id), name: c.name || req.user.businessName || "Établissement", isOwner: true })),
      ...memberCompanies.map((c) => ({ id: String(c._id), name: c.name || "Établissement", isOwner: false })),
    ];

    const activeId = req.session && req.session.activeCompanyId;
    let currentCompany = null;

    if (activeId) {
      currentCompany = ownedCompanies.find((c) => String(c._id) === String(activeId))
        || memberCompanies.find((c) => String(c._id) === String(activeId))
        || null;
    }
    if (!currentCompany && ownedCompanies.length) {
      currentCompany = ownedCompanies[0];
    }
    if (!currentCompany && memberCompanies.length) {
      currentCompany = memberCompanies[0];
    }

    // Rôle/grade pour la company finalement retenue — calculé une seule
    // fois ici (cf. utils/permissions.js pour la résolution effective).
    const isOwner = !!currentCompany && ownedCompanies.some((c) => String(c._id) === String(currentCompany._id));
    const activeMembership = currentCompany ? membershipByCompanyId[String(currentCompany._id)] : null;
    // Libellé d'affichage uniquement (badges, logs) — "owner" pour le
    // patron, sinon le nom du grade assigné (jamais "manager"/"staff" en
    // dur désormais).
    const membershipRole = isOwner ? "owner" : (activeMembership?.grade?.name || null);

    // 3. Si l'utilisateur n'a ni établissement propre ni adhésion acceptée —
    // compte "client"/"undecided" (cf. inscription unifiée), demande pour
    // rejoindre encore en attente/refusée, ou pro qui n'a pas terminé sa
    // création — pas de système de "rôles" dans ce modèle User, c'est la
    // présence d'une Company (propriétaire ou membre) qui définit l'accès.
    // On le laisse uniquement atteindre /settings (où il peut créer/voir
    // l'état de sa demande, cf. carte "Votre établissement") ou /register.
    // Les autres pages admin supposent toutes une Company existante.
    if (!currentCompany) {
      if (req.path === "/settings" || req.path === "/register") return next();
      return res.redirect("/");
    }

    // 4. On injecte dans res.locals
    // Ces variables seront accessibles direct dans tes fichiers .pug
    res.locals.currentCompany = currentCompany;
    res.locals.membershipRole = membershipRole;
    res.locals.isImpersonating = (req.session && req.session.isImpersonating) || null;
    res.locals.isBeingSupervised = activeSupervisions.has(String(req.user._id));

    // Demandes en attente (badge sidebar "Collaborateurs") — uniquement pour
    // le patron, les collaborateurs ne gèrent pas les demandes d'adhésion.
    res.locals.pendingMembershipsCount = 0;
    if (isOwner && currentCompany) {
      res.locals.pendingMembershipsCount = await CompanyMembership.countDocuments({
        company: currentCompany._id,
        status: "pending",
      });
    }

    // Système de grades/permissions — le patron a toujours tout ;
    // un collaborateur sans grade assigné (rare, juste après une migration
    // ratée ou un bug) n'a aucun accès plutôt qu'un accès par défaut.
    res.locals.permissions = resolvePermissions({ isOwner, grade: activeMembership?.grade || null });
    res.locals.canManageOwnTimeOff = resolveCanManageOwnTimeOff({
      isOwner,
      grade: activeMembership?.grade || null,
      membershipOverride: activeMembership?.canManageOwnTimeOff,
    });
    res.locals.user = req.user;

    // 4c. Le plan/abonnement appartient à l'ÉTABLISSEMENT (donc à son owner),
    // jamais au compte actuellement connecté — un collaborateur d'un
    // établissement Business doit voir/bénéficier du plan Business, pas de
    // son propre statut perso. `res.locals.billingUser` est la source à
    // utiliser pour toute vérification de plan/limite dans ce contexte
    // d'établissement (cf. utils/planLimits.js getPlan/getLimit/atLeast).
    // `injectSubscription` (middleware global, tourne AVANT celui-ci) a déjà
    // posé isPro/currentPlan/... à partir de req.user — on les recalcule ici
    // à partir de l'owner quand ce n'est pas lui qui est connecté.
    // Le forfait appartient à l'ÉTABLISSEMENT. On résout le plan EFFECTIF de
    // `currentCompany` (`company.plan` s'il est défini/actif, sinon hérité du
    // forfait de l'owner — cf. getCompanyPlan) et on expose un `billingUser`
    // « shim » qui porte ce plan. Ainsi TOUTES les vérifs getLimit/atLeast/
    // getPlan en aval deviennent per-établissement sans toucher aux ~30 appels.
    const { getCompanyPlan, atLeast: _atLeast, PLANS: _PLANS } = require("../utils/planLimits");
    let ownerUser;
    if (isOwner) {
      ownerUser = req.user;
    } else {
      ownerUser = await User.findById(currentCompany.owner)
        .select("subscription isPremium manualPremium manualPremiumExpiry addons")
        .lean();
      if (ownerUser) {
        const { resolveSubscriptionState } = require("./injectSubscription");
        Object.assign(res.locals, await resolveSubscriptionState(ownerUser));
      }
    }

    const effectivePlan = getCompanyPlan(currentCompany, ownerUser || req.user);
    // Shim lu par getPlan() : subscription.plan/status + isPremium/manualPremium.
    // On garde les `addons` de l'owner (customUrl, sièges collaborateurs).
    res.locals.billingUser = {
      _id:           (ownerUser && ownerUser._id) || req.user._id,
      addons:        (ownerUser && ownerUser.addons) || req.user.addons || {},
      isPremium:     false,
      manualPremium: false,
      subscription:  { plan: effectivePlan, status: effectivePlan === "basic" ? "inactive" : "active" },
    };
    // Refléter le plan de l'établissement dans les locals lus par les vues.
    res.locals.currentPlan = effectivePlan;
    res.locals.isPro       = _atLeast(res.locals.billingUser, "pro");

    // 4a. Vocabulaire "client" vs "patient" selon le métier (kiné, dentiste,
    // psy... → patient ; coiffeur, coach... → client) — dispo dans TOUTES
    // les pages admin sans avoir à le repasser depuis chaque contrôleur.
    res.locals.clientTerm           = clientWord(req.user.businessType);
    res.locals.clientTermPlural     = clientWord(req.user.businessType, { plural: true });
    res.locals.clientTermCap        = clientWord(req.user.businessType, { capitalize: true });
    res.locals.clientTermCapPlural  = clientWord(req.user.businessType, { capitalize: true, plural: true });

    // 4b. Fonctionnalités admin activables/désactivables depuis le superadmin
    // (ex: Cours collectifs, Temps tampon) — utilisées pour cacher des
    // sections du sidebar/pages quand désactivées (test/rollout progressif).
    res.locals.adminFeatures = await getAdminFeaturesFlags();

    // 5. Limite mensuelle de RDV (plan Starter/basic) : on calcule si elle est
    // atteinte pour pouvoir afficher une bannière persistante sur TOUTES les
    // pages admin ("vos clients ne peuvent plus réserver !").
    res.locals.monthlyLimitReached = false;
    res.locals.monthlyBookingsCount = 0;
    res.locals.monthlyBookingsLimit = Infinity;
    if (currentCompany) {
      const monthlyLimit = getLimit("monthlyBookings", res.locals.billingUser);
      res.locals.monthlyBookingsLimit = monthlyLimit;
      if (monthlyLimit !== Infinity) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthlyCount = await Booking.countDocuments({
          company: currentCompany._id,
          date:    { $gte: startOfMonth },
          status:  { $ne: "canceled" },
        });
        res.locals.monthlyBookingsCount = monthlyCount;
        res.locals.monthlyLimitReached = monthlyCount >= monthlyLimit;
      }
    }

    next();
  } catch (err) {
    console.error("Erreur injectCompany:", err);
    res.status(500).send("Erreur interne du serveur");
  }
};
