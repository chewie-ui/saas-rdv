const Subscription = require("../db/models/subscription.model");
const User = require("../db/models/user.model");
const { getPlan } = require("../utils/planLimits");

/**
 * Révoque isPremium en DB + en mémoire si nécessaire.
 * Appelé quand l'abonnement est expiré ou inexistant.
 */
async function revokePremium(user, readOnly) {
  // Ne jamais révoquer un accès accordé manuellement (bêta testeurs)
  if (user && user.manualPremium) return;
  // Ne pas révoquer si l'utilisateur a un plan payant dans son User doc
  // (protège contre la désynchronisation entre Subscription collection et User doc)
  const embeddedPlan = user?.subscription?.plan;
  if (["essentiel", "pro", "business"].includes(embeddedPlan)) return;
  if (user && user.isPremium) {
    user.isPremium = false;
    if (!readOnly) await User.findByIdAndUpdate(user._id, { isPremium: false });
  }
}

/**
 * Calcule isPro/currentPlan/daysLeft/... pour UN user donné (effets de bord DB
 * inclus — sync du doc Subscription, révocation si expiré). Pris en paramètre
 * plutôt que de fermer sur req.user pour pouvoir être réutilisé avec l'owner
 * d'un établissement quand l'utilisateur connecté n'est qu'un collaborateur
 * (cf. middlewares/injectCompany.js — le plan suit l'établissement, pas le
 * compte connecté).
 *
 * `options.readOnly` : calcule les mêmes locals SANS aucune écriture en base.
 * Indispensable quand on résout l'état d'un compte qui n'est pas celui du
 * visiteur (un collaborateur ne doit pas déclencher de révocation/upsert sur
 * le compte de son patron simplement en ouvrant une page admin).
 */
async function resolveSubscriptionState(user, options = {}) {
  const readOnly = !!options.readOnly;
  const locals = {};
  if (!user) return locals;

  // ── Bypass manuel : bêta testeurs avec manualPremium=true (prod + dev)
  if (user.manualPremium) {
    const expiry = user.manualPremiumExpiry;
    const now    = new Date();

    // Si la durée de test est dépassée → révoquer automatiquement.
    //
    // `manualPremiumExpiry` est volontairement CONSERVÉ. C'est la seule trace
    // qu'un accès payant a existé sur ce compte, et utils/freeTrial.js s'en
    // sert pour refuser un deuxième mois offert. L'effacer ici — ce que le
    // code faisait — rendait le compte à nouveau éligible à l'essai gratuit
    // le jour même où son octroi se terminait : au lieu de lui demander de
    // payer, on lui offrait 30 jours de plus, indéfiniment.
    //
    // Aucune vue n'affiche cette date sans vérifier d'abord `manualPremium`
    // ou `isPremium` (cf. superadmin.controller.js), donc la garder ne fait
    // apparaître aucune échéance périmée côté pro.
    if (expiry && new Date(expiry) < now) {
      if (!readOnly) {
        await User.findByIdAndUpdate(user._id, {
          manualPremium: false,
          isPremium: false,
          "subscription.status": "inactive",
        });
      }
      user.manualPremium = false;
      user.isPremium     = false;
      // Fall through → sera traité comme free ci-dessous
    } else {
      if (!user.isPremium) {
        if (!readOnly) await User.findByIdAndUpdate(user._id, { isPremium: true });
        user.isPremium = true;
      }

      const diffMs    = expiry ? new Date(expiry) - now : null;
      const diffDays  = diffMs !== null ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : null;
      const diffHours = diffMs !== null ? Math.ceil(diffMs / (1000 * 60 * 60)) : null;

      locals.currentPlan   = (user.subscription && user.subscription.plan) || "pro";
      locals.isPro         = ["pro", "business"].includes(locals.currentPlan);
      locals.subscription  = null;
      locals.autoRenew     = false;
      locals.isExpired     = false;
      locals.isBetaAccess  = true;

      if (diffDays === null) {
        // Accès infini
        locals.daysLeft   = null;
        locals.hoursLeft  = null;
        locals.isExpiring = false;
      } else if (diffDays <= 1) {
        locals.daysLeft   = 0;
        locals.hoursLeft  = diffHours > 0 ? diffHours : 1;
        locals.isExpiring = true;
      } else {
        locals.daysLeft   = diffDays;
        locals.hoursLeft  = null;
        locals.isExpiring = diffDays <= 3;
      }

      // Date d'expiration (pour l'affichage) + avertissement de paiement.
      locals.trialExpiryDate = expiry ? new Date(expiry) : null;
      // On n'avertit QUE si l'accès expire bientôt ET que l'utilisateur n'a
      // pas de moyen de paiement par défaut (sinon il n'a rien à faire — le
      // prélèvement se fera tout seul le moment venu). Sans customer Stripe,
      // getUserPaymentMethods renvoie [] instantanément (aucun appel réseau).
      if (locals.isExpiring) {
        try {
          let hasDefaultPM = false;
          if (user.subscription && user.subscription.stripeCustomerId) {
            const { getUserPaymentMethods } = require("../controllers/admin.controller");
            const pms = await getUserPaymentMethods(user);
            hasDefaultPM = Array.isArray(pms) && pms.some((pm) => pm.isDefault);
          }
          locals.showTrialWarning = !hasDefaultPM;
        } catch (_) {
          // En cas d'erreur Stripe, on avertit par prudence (mieux vaut prévenir).
          locals.showTrialWarning = true;
        }
      }

      return locals;
    }
  }

  const subscription = await Subscription.findOne({
    user: user._id,
    status: "active",
  }).lean();

  if (subscription) {
    const now = new Date();
    const diffMs    = new Date(subscription.endDate) - now;
    const diffDays  = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));

    // ── Sync user so getLimit()/getPlan() see the correct plan ──
    // The embedded user.subscription may lag behind the Subscription collection
    // (e.g. webhook not yet written). Overwrite in-memory so all controllers
    // calling getPlan(user) get the right result for this request.
    if (user.subscription) {
      user.subscription.status = "active";
      user.subscription.plan   = subscription.plan || "pro";
    } else {
      user.subscription = { status: "active", plan: subscription.plan || "pro" };
    }

    locals.subscription = subscription;
    locals.autoRenew    = subscription.autoRenew;
    locals.currentPlan  = subscription.plan || "pro";

    if (diffMs <= 0) {
      // ── Abonnement expiré ──
      locals.isPro      = false;
      locals.currentPlan = "basic";
      locals.daysLeft   = 0;
      locals.hoursLeft  = 0;
      locals.isExpired  = true;
      locals.isExpiring = false;
      await revokePremium(user, readOnly); // DB + mémoire
    } else if (diffDays <= 1) {
      // ── Moins de 24h restantes ──
      locals.isPro      = true;
      locals.daysLeft   = 0;
      locals.hoursLeft  = diffHours > 0 ? diffHours : 1;
      locals.isExpired  = false;
      locals.isExpiring = true;
    } else {
      locals.isPro      = true;
      locals.daysLeft   = diffDays;
      locals.hoursLeft  = null;
      locals.isExpired  = false;
      locals.isExpiring = diffDays <= 3;
    }
  } else {
    // ── Pas de doc Subscription actif dans la collection ──
    // Fallback : si User doc a un plan payant (même si isPremium est faux à cause de revokePremium)
    // On vérifie subscription.status = "active" ET plan valide dans le User doc
    const embeddedPlan   = user.subscription?.plan;
    const embeddedStatus = user.subscription?.status;
    const validPlans     = ["essentiel", "pro", "business"];
    const hasPremiumUser = validPlans.includes(embeddedPlan) &&
      (embeddedStatus === "active" || user.isPremium ||
       user.subscription?.stripeSubscriptionId || user.subscription?.stripeCustomerId);

    if (hasPremiumUser) {
      // Source de vérité pour le compte à rebours : manualPremiumExpiry si
      // défini (octroi manuel via superadmin), sinon accès considéré illimité
      // tant qu'aucune date n'a été fixée — on n'invente jamais un "30" fixe.
      const manualExpiry = user.manualPremiumExpiry ? new Date(user.manualPremiumExpiry) : null;
      const endDate = manualExpiry || (() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return d;
      })();

      // Recréer/mettre à jour le doc Subscription manquant pour les prochaines
      // requêtes. upsert (pas create()) : un `create()` plantait silencieusement
      // sur l'index unique sparse de stripeSubscriptionId dès qu'un 2e utilisateur
      // sans Stripe (stripeSubscriptionId explicitement `null`) passait par ici —
      // Mongo traite `null` explicite comme une valeur indexée, pas comme "absent",
      // donc l'index sparse ne protégeait pas du duplicata. Résultat : le doc
      // n'était JAMAIS recréé après le premier utilisateur manuel, et ce fallback
      // (avec son daysLeft figé) tournait en boucle pour tout le monde après lui.
      const stripeSubId = user.subscription?.stripeSubscriptionId || undefined;
      try {
        if (!readOnly) await Subscription.findOneAndUpdate(
          { user: user._id, status: "active" },
          {
            user:     user._id,
            plan:     embeddedPlan,
            status:   "active",
            startDate: new Date(),
            endDate,
            stripeCustomerId:    user.subscription?.stripeCustomerId || null,
            ...(stripeSubId ? { stripeSubscriptionId: stripeSubId } : {}),
            amount:   0,
            currency: "eur",
            autoRenew: true,
          },
          { upsert: true, setDefaultsOnInsert: true }
        );
      } catch (createErr) {
        console.error(`[injectSubscription] Erreur recréation Subscription pour ${user._id}:`, createErr.message);
      }

      locals.isPro        = true;
      locals.currentPlan  = embeddedPlan;
      locals.subscription = null;
      locals.autoRenew    = true;
      locals.isExpired    = false;

      if (!manualExpiry) {
        // Pas de date fixée par le superadmin → accès illimité.
        locals.daysLeft   = null;
        locals.hoursLeft  = null;
        locals.isExpiring = false;
      } else {
        const now = new Date();
        const diffMs   = endDate - now;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
        if (diffMs <= 0) {
          locals.daysLeft   = 0;
          locals.hoursLeft  = 0;
          locals.isExpiring = true;
        } else if (diffDays <= 1) {
          locals.daysLeft   = 0;
          locals.hoursLeft  = diffHours > 0 ? diffHours : 1;
          locals.isExpiring = true;
        } else {
          locals.daysLeft   = diffDays;
          locals.hoursLeft  = null;
          locals.isExpiring = diffDays <= 3;
        }
      }
    } else {
      // Vraiment free — pas de plan premium
      locals.isPro        = false;
      locals.currentPlan  = "basic";
      locals.subscription = null;
      locals.autoRenew    = false;
      locals.daysLeft     = 0;
      locals.hoursLeft    = null;
      locals.isExpired    = false;
      locals.isExpiring   = false;
      await revokePremium(user, readOnly);
    }
  }

  // ── isPro = plan Pro OU Business uniquement ────────────────────────────────
  // "essentiel" est un plan PAYANT mais ce n'est PAS un plan Pro : il ne
  // débloque aucune fonctionnalité Pro (rappels, perso, formulaires, équipe…).
  // On recalcule isPro de façon centralisée pour ne dépendre d'aucune branche.
  locals.isPro = ["pro", "business"].includes(locals.currentPlan);

  return locals;
}

module.exports = async (req, res, next) => {
  try {
    if (!req.user) {
      return next();
    }
    const locals = await resolveSubscriptionState(req.user);
    Object.assign(res.locals, locals);
    next();
  } catch (error) {
    console.error("injectSubscription error:", error);
    next();
  }
};

module.exports.resolveSubscriptionState = resolveSubscriptionState;
