// ── API mobile : abonnement, crédits SMS/WhatsApp & parrainage ────────────
//   GET   /billing               forfait de l'établissement + usage du mois
//   GET   /billing/sms           quota SMS inclus, consommation, solde prépayé
//   PATCH /billing/sms-settings   bascules rappels/confirmations SMS & WhatsApp
//   GET   /billing/referral      code de parrainage, lien, filleuls, crédits
//
// LECTURE SEULE pour tout ce qui touche au PAIEMENT. Apple et Google prélèvent
// une commission sur tout achat de contenu numérique réalisé dans une app :
// l'app affiche donc l'information, mais changer de forfait ou recharger des
// SMS renvoie systématiquement vers le site (champ `manageUrl`). Aucun flux de
// paiement n'existe ici, et il ne faut pas en ajouter.
//
// Les logiques reprises :
//   - forfait effectif de l'établissement  → utils/planLimits.getCompanyPlan()
//     (déjà résolu par mobileCompany dans req.companyCtx.plan/billingUser)
//   - usage mensuel des RDV                → middlewares/injectCompany.js (§5)
//   - quota / solde / recharge auto SMS    → admin.controller.js smsPage
//   - bascules SMS & WhatsApp              → account.controller.js updateSmsSettings
//   - parrainage                            → admin.controller.js parrainage
const User = require("../../db/models/user.model");
const { Booking } = require("./_helpers");
const { getLimit, getSmsQuota } = require("../../utils/planLimits");
const { SMS_PRICE_CENTS } = require("../../utils/sms");
const { isWhatsappConfigured, WHATSAPP_PRICE_CENTS } = require("../../utils/whatsapp");
const { logActivity } = require("../../utils/activityLog");

const SITE = "https://www.branshee.com";
const SUBSCRIPTION_URL = `${SITE}/subscription`;
const SMS_URL = `${SITE}/sms`;
const REFERRAL_URL = `${SITE}/parrainage`;

const PLAN_LABELS = {
  basic: "Gratuit",
  essentiel: "Essentiel",
  pro: "Pro",
  business: "Business",
};

// Les réglages SMS/WhatsApp qui pilotent réellement les envois sont ceux du
// PROPRIÉTAIRE de l'établissement : utils/reminderScheduler.js et utils/sms.js
// lisent `owner.calendarSettings`, `owner.smsUsage` et `owner.smsBalanceCents`.
// Un collaborateur autorisé (customization.manage) agit donc sur ce document —
// jamais sur le sien, qui n'aurait aucun effet sur les rappels envoyés.
function ownerIdOf(req) {
  return req.companyCtx.currentCompany.owner;
}

// Le solde prépayé, la recharge automatique et ses échecs de prélèvement sont
// des données FINANCIÈRES du compte propriétaire : elles relèvent de la zone
// `billing`, pas de `customization` (qui ne sert ici qu'aux bascules d'envoi).
function canSeeMoney(req) {
  return !!(req.companyCtx.isOwner || req.companyCtx.permissions?.billing?.manage);
}

// Clé du mois courant, au format utilisé par `smsUsage.monthKey` ("YYYY-MM").
function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

// `Infinity` ne survit pas à JSON.stringify (il devient `null`) : on expose
// donc toujours le couple { limit, unlimited } plutôt qu'un nombre ambigu.
function serializeLimit(value) {
  return value === Infinity ? { limit: null, unlimited: true } : { limit: value, unlimited: false };
}

// GET /api/v1/billing
exports.overview = async (req, res) => {
  try {
    const { currentCompany, billingUser, plan, isOwner } = req.companyCtx;

    // Bornes en heure locale serveur : même construction que le compteur du
    // web (middlewares/injectCompany.js) et que le dashboard mobile, pour que
    // les trois surfaces affichent exactement le même nombre.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const monthlyLimit = getLimit("monthlyBookings", billingUser);
    // Toujours compté, même sur un forfait illimité : l'app affiche le volume
    // du mois comme information, et seule la jauge dépend de la limite.
    const monthlyCount = await Booking.countDocuments({
      company: currentCompany._id,
      date: { $gte: monthStart },
      status: { $ne: "canceled" },
    });

    res.json({
      company: {
        id: String(currentCompany._id),
        name: currentCompany.name || "Établissement",
        isOwner: !!isOwner,
      },
      plan,
      planLabel: PLAN_LABELS[plan] || plan,
      // Statut du forfait porté par l'établissement. Vide/absent = hérité du
      // compte propriétaire (compat avant la facturation par établissement).
      status: currentCompany.planStatus || (plan === "basic" ? "inactive" : "active"),
      isPaid: plan !== "basic",
      usage: {
        monthlyBookings: {
          used: monthlyCount,
          ...serializeLimit(monthlyLimit),
          reached: monthlyLimit !== Infinity && monthlyCount >= monthlyLimit,
          monthKey: currentMonthKey(),
        },
      },
      // Repères du forfait affichés à titre indicatif sur la fiche.
      limits: {
        services: serializeLimit(getLimit("services", billingUser)),
        employees: serializeLimit(getLimit("employees", billingUser)),
        collaborators: serializeLimit(getLimit("collaborators", billingUser)),
        smsIncluded: getSmsQuota(billingUser),
      },
      // Tout changement de forfait se fait sur le site (voir en-tête).
      manageUrl: SUBSCRIPTION_URL,
    });
  } catch (err) {
    console.error("[mobile billing overview]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// GET /api/v1/billing/sms
exports.sms = async (req, res) => {
  try {
    const { billingUser } = req.companyCtx;

    const owner = await User.findById(ownerIdOf(req))
      .select("calendarSettings smsUsage smsBalanceCents smsAutoRecharge")
      .lean();
    if (!owner) {
      return res.status(404).json({ error: "owner_not_found", message: "Propriétaire de l'établissement introuvable." });
    }

    const cs = owner.calendarSettings || {};
    const usage = owner.smsUsage || {};
    const ar = owner.smsAutoRecharge || {};
    const monthKey = currentMonthKey();
    const used = usage.monthKey === monthKey ? usage.count || 0 : 0;
    const quota = getSmsQuota(billingUser);
    const balanceCents = owner.smsBalanceCents || 0;

    res.json({
      // Quota inclus dans le forfait de l'établissement, remis à zéro chaque mois.
      quota: {
        included: quota,
        used,
        remaining: Math.max(0, quota - used),
        monthKey,
      },
      // Solde prépayé, dépensé uniquement au-delà du quota et seulement si
      // « smsAllowOverage » est activé (sinon repli automatique sur l'email).
      // `null` pour qui n'a pas le droit `billing` : le quota et les bascules
      // suffisent à piloter les envois, le solde du patron ne les regarde pas.
      balance: canSeeMoney(req)
        ? {
            cents: balanceCents,
            smsPriceCents: SMS_PRICE_CENTS,
            whatsappPriceCents: WHATSAPP_PRICE_CENTS,
            // Nombre d'envois encore payables avec le solde, par canal.
            smsLeft: Math.floor(balanceCents / SMS_PRICE_CENTS),
            whatsappLeft: Math.floor(balanceCents / WHATSAPP_PRICE_CENTS),
          }
        : null,
      settings: {
        smsRemindersEnabled: !!cs.smsRemindersEnabled,
        smsConfirmationEnabled: !!cs.smsConfirmationEnabled,
        whatsappRemindersEnabled: !!cs.whatsappRemindersEnabled,
        whatsappConfirmationEnabled: !!cs.whatsappConfirmationEnabled,
        smsAllowOverage: !!cs.smsAllowOverage,
      },
      // WhatsApp n'est proposé que si le serveur est bien relié à Meta.
      whatsappConfigured: isWhatsappConfigured(),
      // Les rappels payants démarrent au forfait Pro (cf. planLimits).
      availableOnPlan: quota > 0,
      // Réglage de recharge automatique + dernier échec de prélèvement :
      // information financière, même règle que `balance`.
      autoRecharge: canSeeMoney(req)
        ? {
            enabled: !!ar.enabled,
            thresholdEuros: Math.round((ar.thresholdCents || 500) / 100),
            amountEuros: Math.round((ar.amountCents || 2000) / 100),
            lastFailureAt: ar.lastFailureAt || null,
          }
        : null,
      // Recharger le solde ou changer la recharge auto = paiement → site.
      manageUrl: SMS_URL,
    });
  } catch (err) {
    console.error("[mobile billing sms]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PATCH /api/v1/billing/sms-settings
// Mêmes clés et même règle que le web (account.controller.js
// updateSmsSettings) : on n'écrit QUE les clés présentes dans le corps, pour
// qu'un écran qui n'affiche que les réglages WhatsApp n'efface pas ceux du SMS.
// La recharge auto n'est PAS modifiable ici : elle déclenche un paiement.
const SMS_SETTING_KEYS = [
  "smsRemindersEnabled",
  "smsConfirmationEnabled",
  "whatsappRemindersEnabled",
  "whatsappConfirmationEnabled",
  "smsAllowOverage",
];

exports.updateSmsSettings = async (req, res) => {
  try {
    // `smsAllowOverage` autorise la dépense du SOLDE PRÉPAYÉ du propriétaire —
    // de l'argent réel (0,12 €/SMS), et le déclenchement éventuel des recharges
    // automatiques. Ce n'est pas une bascule d'envoi comme les autres : elle
    // exige le droit `billing`, pas seulement `customization`.
    if (
      Object.prototype.hasOwnProperty.call(req.body, "smsAllowOverage") &&
      !canSeeMoney(req)
    ) {
      return res.status(403).json({
        error: "forbidden",
        message: "Autoriser la dépense du solde prépayé demande le droit de gérer la facturation.",
      });
    }

    const set = {};
    const changed = [];
    for (const key of SMS_SETTING_KEYS) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        set["calendarSettings." + key] = !!req.body[key];
        changed.push(key);
      }
    }

    if (!changed.length) {
      return res.status(400).json({
        error: "nothing_to_update",
        message: "Aucun réglage envoyé.",
      });
    }

    const ownerId = ownerIdOf(req);
    await User.updateOne({ _id: ownerId }, { $set: set });

    const owner = await User.findById(ownerId).select("calendarSettings").lean();
    const cs = (owner && owner.calendarSettings) || {};

    const LABELS = {
      smsRemindersEnabled: "rappels SMS",
      smsConfirmationEnabled: "confirmation SMS",
      whatsappRemindersEnabled: "rappels WhatsApp",
      whatsappConfirmationEnabled: "confirmation WhatsApp",
      smsAllowOverage: "utilisation du solde prépayé",
    };
    await logActivity({
      company: req.companyCtx.currentCompany._id,
      user: req.mobileUser,
      role: req.companyCtx.isOwner ? "owner" : req.companyCtx.role || "",
      action: "settings.sms",
      description:
        "Réglages SMS/WhatsApp modifiés : " +
        changed.map((k) => `${LABELS[k] || k} ${set["calendarSettings." + k] ? "activé" : "désactivé"}`).join(", "),
    });

    res.json({
      ok: true,
      settings: {
        smsRemindersEnabled: !!cs.smsRemindersEnabled,
        smsConfirmationEnabled: !!cs.smsConfirmationEnabled,
        whatsappRemindersEnabled: !!cs.whatsappRemindersEnabled,
        whatsappConfirmationEnabled: !!cs.whatsappConfirmationEnabled,
        smsAllowOverage: !!cs.smsAllowOverage,
      },
    });
  } catch (err) {
    console.error("[mobile billing sms-settings]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// GET /api/v1/billing/referral
// Le parrainage appartient au COMPTE connecté (et non à l'établissement) :
// on lit et on écrit toujours sur req.mobileUser, comme la page web.
exports.referral = async (req, res) => {
  try {
    const user = req.mobileUser;

    // Même filet que le web (admin.controller.js settingsInit) : un compte créé
    // avant l'arrivée du parrainage n'a pas encore de code, on le génère à la
    // première consultation.
    let code = user.referralCode || "";
    if (!code) {
      const { generateReferralCode } = require("../../utils/referralCode");
      code = await generateReferralCode(user.fullName);
      await User.updateOne({ _id: user._id }, { $set: { referralCode: code } });
    }

    const filleuls = await User.find({ referredBy: user._id })
      .select("fullName createdAt isPremium subscription")
      .sort({ createdAt: -1 })
      .lean();

    const referral = user.referral || {};
    const totalInvited = referral.totalInvited || filleuls.length;
    const totalPaying = referral.totalPaying || 0;
    const creditMonths = referral.creditMonths || 0;
    // Même barème que le web (parrainageClaim) : 3 filleuls payants = 2 mois.
    const claimableMonths = Math.max(0, Math.floor(totalPaying / 3) * 2 - creditMonths);

    res.json({
      code,
      link: `${SITE}/register?ref=${code}`,
      stats: {
        totalInvited,
        totalPaying,
        creditMonths,
        claimableMonths,
        // Filleuls payants restants avant la prochaine tranche de 2 mois.
        untilNextReward: totalPaying % 3 === 0 && totalPaying > 0 ? 3 : 3 - (totalPaying % 3),
      },
      // Prénom + initiale seulement : on n'expose pas les emails des filleuls.
      filleuls: filleuls.slice(0, 50).map((f) => ({
        name: (f.fullName || "Filleul").trim().split(" ")[0],
        joinedAt: f.createdAt,
        isPaying: !!(f.isPremium || (f.subscription && f.subscription.status === "active")),
      })),
      // Réclamer les mois offerts touche à l'abonnement Stripe → site.
      manageUrl: REFERRAL_URL,
    });
  } catch (err) {
    console.error("[mobile billing referral]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
