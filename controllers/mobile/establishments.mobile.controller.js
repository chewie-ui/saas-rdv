// ── API mobile : gestion des établissements (choisir / créer / rejoindre) ─
//   GET    /establishments                        mes établissements + invitations + demandes
//   POST   /establishments                        créer un établissement
//   GET    /establishments/search?q=              chercher un établissement à rejoindre
//   POST   /establishments/:id/join               demander à rejoindre
//   DELETE /establishments/:id/join               annuler sa demande en attente
//   PATCH  /establishments/invitations/:id        accepter / refuser une invitation
//
// Ces routes concernent le COMPTE, pas un établissement actif : on choisit ou
// on crée un établissement, on n'agit pas DANS l'un d'eux. Elles sont donc
// montées AVANT `mobileCompany` et travaillent sur `req.mobileUser`.
//
// Logique répliquée depuis le web :
//   - controllers/establishment.controller.js : listMyEstablishments,
//     createEstablishment (mêmes horaires par défaut, même règle de forfait)
//   - controllers/account.controller.js : requestJoinCompany, respondToInvitation
//   - routes/api.js : /joinable-companies (seuls les établissements dont le
//     PROPRIÉTAIRE est en forfait Business peuvent être rejoints)
const User = require("../../db/models/user.model");
const Company = require("../../db/models/company/company.model");
const CompanyMembership = require("../../db/models/company/companyMembership.model");
const { getCompanyPlan, canCreateEstablishment } = require("../../utils/planLimits");
const { identityFor } = require("../../utils/establishmentIdentity");
const { logActivity } = require("../../utils/activityLog");

const OBJECT_ID = /^[a-f0-9]{24}$/i;

// Message EXACT du web quand la règle de forfait bloque la création.
const CANNOT_CREATE_MESSAGE =
  "Pour créer un nouvel établissement, vos établissements existants doivent être sur un forfait payant (Pro minimum). Passez au Pro, ou supprimez un établissement gratuit.";

// Horaires par défaut : lundi→vendredi 9h-18h, week-end fermé. Identique à
// l'inscription (controllers/mobile/accountCreation.js) et au web.
function defaultSchedule() {
  return [
    { weekdayIndex: 1, workingHours: [{ start: "09:00", end: "18:00" }] },
    { weekdayIndex: 2, workingHours: [{ start: "09:00", end: "18:00" }] },
    { weekdayIndex: 3, workingHours: [{ start: "09:00", end: "18:00" }] },
    { weekdayIndex: 4, workingHours: [{ start: "09:00", end: "18:00" }] },
    { weekdayIndex: 5, workingHours: [{ start: "09:00", end: "18:00" }] },
    { weekdayIndex: 6, dayOff: true },
    { weekdayIndex: 0, dayOff: true },
  ];
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Nom/type/photo vivent sur la Company depuis le multi-établissements, avec
// repli sur le compte propriétaire pour les établissements créés avant
// (cf. formatCompanyForList du web).
function companyName(company, owner) {
  return (
    (company && company.name) ||
    (owner && (owner.businessName || owner.fullName)) ||
    "Établissement sans nom"
  );
}

function companyPhoto(company, owner) {
  return (company && company.photo) || (owner && owner.businessPicture) || "/images/no-user.webp";
}

function companyType(company, owner) {
  return (company && company.businessType) || (owner && owner.businessType) || "";
}

// Ville de l'ÉTABLISSEMENT (repli sur le compte réservé à celui d'origine).
// `owner.city` reste un dernier recours : champ hérité de vieux comptes.
function cityOf(company, owner) {
  const loc = identityFor(company, owner).location;
  return (loc && typeof loc === "object" && loc.city) || (owner && owner.city) || "";
}

// Forme commune envoyée à l'app pour un établissement, quel que soit le lien
// (possédé, rejoint, invitation, demande).
function serializeEstablishment(company, owner, extra = {}) {
  return {
    id: String(company._id),
    name: companyName(company, owner),
    businessType: companyType(company, owner),
    photo: companyPhoto(company, owner),
    isPaused: !!company.isPaused,
    createdAt: company.createdAt || null,
    ...extra,
  };
}

// `company` : l'établissement D'ORIGINE du compte, seul à hériter de son
// adresse tant que la migration d'identité n'a pas tourné (establishmentIdentity).
const OWNER_FIELDS = "company businessName fullName businessType businessPicture city location subscription isPremium manualPremium";

// ── GET /api/v1/establishments ────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const user = req.mobileUser;

    const owned = await Company.find({ owner: user._id, isDeleted: { $ne: true } })
      .sort({ createdAt: 1 })
      .lean();

    const memberships = await CompanyMembership.find({
      user: user._id,
      status: { $in: ["accepted", "pending", "rejected"] },
    })
      .populate({ path: "company", populate: { path: "owner", select: OWNER_FIELDS } })
      .populate("grade", "name")
      .sort({ createdAt: 1 })
      .lean();

    // Un établissement supprimé (suppression douce) disparaît de toutes les listes.
    const live = memberships.filter((m) => m.company && !m.company.isDeleted);

    const ownedList = owned.map((c) =>
      serializeEstablishment(c, user, {
        isOwner: true,
        role: "Propriétaire",
        // Accès toujours actif pour le patron : seule la pause de
        // l'établissement peut le mettre en sommeil.
        isActive: true,
        plan: getCompanyPlan(c, user),
      }),
    );

    const memberOf = live
      .filter((m) => m.status === "accepted")
      .map((m) =>
        serializeEstablishment(m.company, m.company.owner, {
          isOwner: false,
          role: (m.grade && m.grade.name) || "Collaborateur",
          isActive: m.isActive !== false,
          membershipId: String(m._id),
          since: m.acceptedAt || m.createdAt,
        }),
      );

    // Invitations reçues du patron (le collaborateur doit accepter/refuser).
    const invitations = live
      .filter((m) => m.status === "pending" && m.invitedByOwner)
      .map((m) =>
        serializeEstablishment(m.company, m.company.owner, {
          isOwner: false,
          role: (m.grade && m.grade.name) || "Collaborateur",
          isActive: false,
          membershipId: String(m._id),
          invitedAt: m.createdAt,
        }),
      );

    // Demandes envoyées par l'utilisateur (le patron doit approuver), en
    // attente ou refusées.
    const requests = live
      .filter((m) => !m.invitedByOwner && (m.status === "pending" || m.status === "rejected"))
      .map((m) =>
        serializeEstablishment(m.company, m.company.owner, {
          isOwner: false,
          role: "",
          isActive: false,
          membershipId: String(m._id),
          status: m.status,
          requestedAt: m.createdAt,
        }),
      );

    const info = canCreateEstablishment(owned, user);

    return res.json({
      owned: ownedList,
      memberOf,
      invitations,
      requests,
      canCreate: {
        canCreate: info.canCreate,
        reason: info.canCreate ? "" : CANNOT_CREATE_MESSAGE,
        freeCount: info.freeCount,
        businessCount: info.businessCount,
        allowedFree: info.allowedFree,
      },
    });
  } catch (err) {
    console.error("[mobile] establishments.list", err);
    return res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── POST /api/v1/establishments ───────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const user = req.mobileUser;

    const owned = await Company.find({ owner: user._id, isDeleted: { $ne: true } }).lean();
    if (!canCreateEstablishment(owned, user).canCreate) {
      return res.status(403).json({ error: "plan_limit", message: CANNOT_CREATE_MESSAGE });
    }

    const name = String(req.body.name || "").trim();
    const businessType = String(req.body.businessType || "").trim();
    if (!name) {
      return res.status(400).json({ error: "missing_name", message: "Indiquez un nom pour votre établissement." });
    }

    // Toujours renseignée explicitement, comme sur le web : sans ça le repli
    // sur la photo du compte affichait la même image sur tous les
    // établissements (impression d'une photo « copiée »).
    const company = await Company.create({
      owner: user._id,
      name,
      businessType,
      photo: "/images/no-user.webp",
      schedule: defaultSchedule(),
    });

    // Trace côté User qu'il possède au moins un établissement (jamais remis à
    // null ensuite) — même écriture que le web.
    await User.updateOne({ _id: user._id }, { $set: { company: company._id, accountIntent: "pro" } });

    logActivity({
      company: company._id,
      user,
      role: "owner",
      action: "establishment.create",
      description: `a créé l'établissement "${name}"`,
    });

    return res.status(201).json({
      establishment: serializeEstablishment(company.toObject(), user, {
        isOwner: true,
        role: "Propriétaire",
        isActive: true,
        plan: getCompanyPlan(company, user),
      }),
    });
  } catch (err) {
    console.error("[mobile] establishments.create", err);
    return res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── GET /api/v1/establishments/search?q= ──────────────────────────────────
// Seuls les établissements dont le PROPRIÉTAIRE est en forfait Business sont
// rejoignables (même règle que /api/joinable-companies et requestJoinCompany).
exports.search = async (req, res) => {
  try {
    const user = req.mobileUser;
    const q = String(req.query.q || "").trim();
    const isSuggestion = q.length < 2;
    const limit = isSuggestion ? 10 : 20;

    // Exclusions : ce que je possède + tout lien existant (accepté, en
    // attente, refusé) — inutile de reproposer un établissement déjà demandé.
    const [ownedIds, linkedIds] = await Promise.all([
      Company.find({ owner: user._id }).select("_id").lean(),
      CompanyMembership.find({ user: user._id }).select("company").lean(),
    ]);
    const excluded = [
      ...ownedIds.map((c) => c._id),
      ...linkedIds.map((m) => m.company),
    ];

    const filter = {
      isDeleted: { $ne: true },
      isPaused: { $ne: true },
      owner: { $ne: user._id },
    };
    if (excluded.length) filter._id = { $nin: excluded };

    if (!isSuggestion) {
      const regex = new RegExp(escapeRegex(q), "i");
      // Le nom et le métier peuvent vivre sur la Company (multi-établissements)
      // OU sur le compte propriétaire (établissements historiques) : on
      // cherche des deux côtés.
      const matchingOwners = await User.find({
        isDisabled: { $ne: true },
        $or: [{ businessName: regex }, { fullName: regex }, { businessType: regex }],
      })
        .select("_id")
        .limit(200)
        .lean();

      filter.$or = [{ name: regex }, { businessType: regex }];
      if (matchingOwners.length) {
        filter.$or.push({ owner: { $in: matchingOwners.map((u) => u._id) } });
      }
    }

    // On ratisse large puis on filtre sur le forfait de l'ÉTABLISSEMENT
    // (company.plan, repli sur le compte owner — cf. getCompanyPlan).
    const candidates = await Company.find(filter)
      .populate("owner", OWNER_FIELDS)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    const joinable = candidates
      .filter((c) => c.owner && getCompanyPlan(c, c.owner) === "business")
      .slice(0, limit);

    // Nombre de collaborateurs actifs, en une seule requête pour toute la page.
    let counts = {};
    if (joinable.length) {
      const rows = await CompanyMembership.aggregate([
        {
          $match: {
            company: { $in: joinable.map((c) => c._id) },
            status: "accepted",
            isActive: { $ne: false },
          },
        },
        { $group: { _id: "$company", n: { $sum: 1 } } },
      ]);
      rows.forEach((r) => {
        counts[String(r._id)] = r.n;
      });
    }

    const results = joinable.map((c) =>
      serializeEstablishment(c, c.owner, {
        // Ville de l'ÉTABLISSEMENT : prise sur le compte, elle affichait la
        // ville du premier établissement du patron sur tous les autres.
        city: cityOf(c, c.owner),
        // Le patron compte comme membre de son propre établissement.
        collaboratorsCount: counts[String(c._id)] || 0,
      }),
    );

    return res.json({ query: q, suggestions: isSuggestion, count: results.length, establishments: results });
  } catch (err) {
    console.error("[mobile] establishments.search", err);
    return res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── POST /api/v1/establishments/:id/join ──────────────────────────────────
exports.requestJoin = async (req, res) => {
  try {
    const user = req.mobileUser;
    const id = String(req.params.id || "");
    if (!OBJECT_ID.test(id)) {
      return res.status(400).json({ error: "invalid_id", message: "Établissement introuvable." });
    }

    const company = await Company.findOne({ _id: id, isDeleted: { $ne: true } })
      .populate("owner", "subscription isPremium manualPremium")
      .lean();

    // Même message que le web : on ne révèle pas le forfait de l'autre.
    if (!company || !company.owner || getCompanyPlan(company, company.owner) !== "business" || company.isPaused) {
      return res.status(400).json({
        error: "not_joinable",
        message: "Cet établissement n'est plus disponible pour être rejoint.",
      });
    }

    if (String(company.owner._id) === String(user._id)) {
      return res.status(400).json({ error: "own_company", message: "Cet établissement vous appartient déjà." });
    }

    const existing = await CompanyMembership.findOne({ company: company._id, user: user._id });
    if (existing && existing.status === "accepted") {
      return res.status(409).json({
        error: "already_member",
        message: "Vous faites déjà partie de cet établissement.",
      });
    }
    if (existing && existing.status === "pending") {
      return res.status(409).json({
        error: "request_pending",
        message: existing.invitedByOwner
          ? "Vous avez déjà reçu une invitation pour cet établissement : acceptez-la depuis vos invitations."
          : "Votre demande est déjà en attente de réponse.",
      });
    }

    // Une demande refusée peut être renvoyée (le patron peut avoir changé d'avis).
    await CompanyMembership.findOneAndUpdate(
      { company: company._id, user: user._id },
      { $set: { status: "pending", invitedByOwner: false } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await User.updateOne({ _id: user._id }, { $set: { accountIntent: "pro" } });

    return res.json({
      ok: true,
      status: "pending",
      establishment: serializeEstablishment(company, company.owner, { status: "pending" }),
    });
  } catch (err) {
    console.error("[mobile] establishments.requestJoin", err);
    return res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── DELETE /api/v1/establishments/:id/join ────────────────────────────────
exports.cancelJoin = async (req, res) => {
  try {
    const user = req.mobileUser;
    const id = String(req.params.id || "");
    if (!OBJECT_ID.test(id)) {
      return res.status(400).json({ error: "invalid_id", message: "Établissement introuvable." });
    }

    // Filtré sur l'utilisateur ET l'établissement : jamais de suppression large.
    const deleted = await CompanyMembership.findOneAndDelete({
      company: id,
      user: user._id,
      status: "pending",
      invitedByOwner: false,
    });
    if (!deleted) {
      return res.status(404).json({ error: "request_not_found", message: "Aucune demande en attente pour cet établissement." });
    }

    return res.json({ ok: true, id });
  } catch (err) {
    console.error("[mobile] establishments.cancelJoin", err);
    return res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── PATCH /api/v1/establishments/invitations/:membershipId ────────────────
// Réplique account.controller.js#respondToInvitation.
exports.respondInvitation = async (req, res) => {
  try {
    const user = req.mobileUser;
    const membershipId = String(req.params.membershipId || "");
    if (!OBJECT_ID.test(membershipId)) {
      return res.status(400).json({ error: "invalid_id", message: "Invitation introuvable." });
    }

    const action = String(req.body.action || "");
    if (!["accept", "reject"].includes(action)) {
      return res.status(400).json({ error: "invalid_action", message: "Réponse invalide : « accept » ou « reject »." });
    }

    const membership = await CompanyMembership.findOne({
      _id: membershipId,
      user: user._id,
      status: "pending",
      invitedByOwner: true,
    });
    if (!membership) {
      return res.status(404).json({ error: "invitation_not_found", message: "Invitation introuvable ou déjà traitée." });
    }

    membership.status = action === "accept" ? "accepted" : "rejected";
    if (action === "accept") {
      membership.acceptedAt = new Date();
      membership.isActive = true;
    }
    await membership.save();

    return res.json({
      ok: true,
      membershipId,
      status: membership.status,
      companyId: String(membership.company),
    });
  } catch (err) {
    console.error("[mobile] establishments.respondInvitation", err);
    return res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
