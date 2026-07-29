const _env = require(`../environment/${process.env.NODE_ENV || "development"}`);

// ── Fournisseur SMS : Spryng (API REST HTTP, orienté BENELUX) ────────────────
// Configuration via .env :
//   SPRYNG_API_TOKEN   → clé API (Bearer) depuis le dashboard Spryng
//   SPRYNG_ORIGINATOR  → expéditeur affiché (nom alphanumérique ≤ 11 car., ou un numéro)
//   SPRYNG_DEFAULT_CC  → indicatif pays par défaut pour les numéros locaux (défaut "32" = Belgique)
// Hôte API Spryng. NB : `rest.spryng.eu` (ancien) est injoignable (timeout) —
// le bon hôte est `api.spryngsms.com`. Surchargable via SPRYNG_ENDPOINT.
const SPRYNG_ENDPOINT   = _env.spryngEndpoint || process.env.SPRYNG_ENDPOINT || "https://api.spryngsms.com/v1/messages";
const SPRYNG_TOKEN      = _env.spryngApiToken   || process.env.SPRYNG_API_TOKEN   || "";
const SPRYNG_ORIGINATOR = _env.spryngOriginator || process.env.SPRYNG_ORIGINATOR || "BranShee";
const SPRYNG_DEFAULT_CC = _env.spryngDefaultCC  || process.env.SPRYNG_DEFAULT_CC  || "32";

/**
 * Normalise un numéro en MSISDN international sans "+" (format attendu par Spryng).
 *   +32470123456  → 32470123456
 *   0032470123456 → 32470123456
 *   0470123456    → 32470123456   (préfixe pays par défaut)
 *   32470123456   → 32470123456   (déjà international)
 */
function normalizeMsisdn(phone, defaultCC) {
  let p = String(phone || "").replace(/[^\d+]/g, "");
  if (!p) return "";
  if (p.startsWith("+"))  return p.slice(1);
  if (p.startsWith("00")) return p.slice(2);
  if (p.startsWith("0"))  return (defaultCC || SPRYNG_DEFAULT_CC) + p.slice(1);
  return p;
}

/**
 * Envoie un SMS via Spryng. Ne lève jamais d'exception et retourne null
 * (sans bloquer le flux) si le fournisseur n'est pas configuré ou en cas
 * d'erreur. Retourne l'identifiant du message (ou "sent") en cas de succès.
 */
async function sendSms(to, body) {
  if (!SPRYNG_TOKEN) {
    console.log("[sms] Spryng non configuré — SMS non envoyé:", to, body);
    return null;
  }
  const recipient = normalizeMsisdn(to, SPRYNG_DEFAULT_CC);
  if (!recipient) return null;

  try {
    // Timeout dur : l'appel externe ne doit jamais faire traîner la requête
    // appelante (réservation). 8 s max, sinon on abandonne (repli email).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      res = await fetch(SPRYNG_ENDPOINT, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          Authorization: "Bearer " + SPRYNG_TOKEN,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          encoding: "auto",
          body: String(body || ""),
          originator: SPRYNG_ORIGINATOR,
          recipients: [recipient],
          route: "business", // route qualité (délivrabilité) pour le transactionnel
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[sms] Spryng erreur:", res.status, txt.slice(0, 300));
      return null;
    }
    const data = await res.json().catch(() => ({}));
    return (data && (data.id || (data.data && data.data.id))) || "sent";
  } catch (err) {
    console.error("sendSms error:", err.message);
    return null;
  }
}

// Prix de vente d'un SMS au-delà du quota inclus, en centimes (débité du solde
// prépayé). ~2x le coût réel Twilio pour couvrir marge + frais Stripe.
const SMS_PRICE_CENTS = 12;

let _stripe = null;
function stripe() {
  if (!_stripe && _env.stripeSecretKey) {
    _stripe = require("stripe")(_env.stripeSecretKey);
  }
  return _stripe;
}

/**
 * Recharge automatique off-session : prélève amountCents sur la carte
 * enregistrée du client et crédite le solde SMS. Protégée par un verrou
 * (smsAutoRecharge.inProgress) contre les doubles prélèvements. En cas d'échec
 * (pas de carte, authentification requise, refus…), ne crédite rien et marque
 * lastFailureAt — l'appelant bascule alors sur l'email.
 * Retourne le solde (en centimes) après tentative.
 */
async function tryAutoRecharge(userId, user) {
  const User = require("../db/models/user.model");
  const ar = user.smsAutoRecharge || {};
  const stripeClient = stripe();
  if (!stripeClient) return user.smsBalanceCents || 0;

  // Verrou atomique : une seule recharge à la fois.
  const locked = await User.findOneAndUpdate(
    { _id: userId, "smsAutoRecharge.inProgress": { $ne: true } },
    { $set: { "smsAutoRecharge.inProgress": true } },
    { new: true }
  );
  if (!locked) {
    const cur = await User.findById(userId).select("smsBalanceCents").lean();
    return (cur && cur.smsBalanceCents) || 0;
  }

  const currentBalance = locked.smsBalanceCents || 0;
  try {
    const customerId = user.subscription && user.subscription.stripeCustomerId;
    if (!customerId) throw new Error("no_stripe_customer");

    const customer = await stripeClient.customers.retrieve(customerId);
    let pmId = customer.invoice_settings && customer.invoice_settings.default_payment_method;
    if (!pmId) {
      const pms = await stripeClient.paymentMethods.list({ customer: customerId, type: "card" });
      pmId = pms.data[0] && pms.data[0].id;
    }
    if (!pmId) throw new Error("no_payment_method");

    const amount = ar.amountCents || 2000;
    const pi = await stripeClient.paymentIntents.create({
      amount,
      currency: "eur",
      customer: customerId,
      payment_method: pmId,
      off_session: true,
      confirm: true,
      description: "BranShee — recharge automatique crédits SMS",
      metadata: { type: "sms_autorecharge", userId: String(userId) },
    });

    if (pi.status === "succeeded") {
      const upd = await User.findByIdAndUpdate(
        userId,
        {
          $inc: { smsBalanceCents: amount },
          // `smsLowBalanceAlertLevel` réarmé : ce crédit sort le solde de la
          // zone basse, une future rechute en-dessous doit pouvoir réalerter.
          $set: { "smsAutoRecharge.inProgress": false, "smsAutoRecharge.lastFailureAt": null, smsLowBalanceAlertLevel: "" },
        },
        { new: true }
      );
      console.log(`[sms] recharge auto +${amount}c pour user ${userId}`);
      return (upd && upd.smsBalanceCents) || currentBalance + amount;
    }
    throw new Error("payment_status_" + pi.status);
  } catch (err) {
    console.error("[sms] recharge auto échouée:", err.message);
    await User.findByIdAndUpdate(userId, {
      $set: { "smsAutoRecharge.inProgress": false, "smsAutoRecharge.lastFailureAt": new Date() },
    }).catch(() => {});
    return currentBalance;
  }
}

// "" < "info" < "warning" — une alerte ne s'envoie que si elle FAIT MONTER le
// niveau (escalade), jamais deux fois pour le même niveau, jamais en
// redescendant (avertir "épuisé" puis reharceler avec "ça s'épuise" n'a pas
// de sens tant qu'il n'y a pas eu de recharge entre-temps).
const ALERT_RANK = { "": 0, info: 1, warning: 2 };

/**
 * Alerte "solde SMS bas" — crée un AdminMessage (même système que le popup +
 * la cloche de notifications, cf. controllers/account.controller.js) dès que
 * le solde prépayé passe sous le seuil de recharge. Idempotent PAR NIVEAU :
 * `smsLowBalanceAlertLevel` empêche de renvoyer deux fois la même alerte,
 * mais laisse passer une escalade info→warning. Remis à "" dès que le solde
 * est crédité, cf. `resetLowBalanceAlert`.
 *
 * `empty` distingue deux gravités : le solde est encore là mais s'épuise
 * (info) vs il vient de manquer et l'envoi est retombé sur l'email (warning).
 */
async function maybeAlertLowBalance(userId, balanceCentsAfter, thresholdCents, empty) {
  try {
    if (balanceCentsAfter >= thresholdCents) return;
    const User = require("../db/models/user.model");
    const desiredLevel = empty ? "warning" : "info";
    const lowerLevels = Object.keys(ALERT_RANK).filter((k) => ALERT_RANK[k] < ALERT_RANK[desiredLevel]);
    // Verrou atomique : ne fire que si le niveau actuel est STRICTEMENT plus
    // bas que celui qu'on s'apprête à envoyer. `$exists: false` est
    // nécessaire en plus du `$in` : sur tout compte créé avant l'ajout de ce
    // champ, il est absent (pas égal à ""), et `$in: [""]` ne matche jamais
    // un champ manquant — sans ce filet, l'alerte ne se déclenchait jamais.
    const locked = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { smsLowBalanceAlertLevel: { $in: lowerLevels } },
          { smsLowBalanceAlertLevel: { $exists: false } },
        ],
      },
      { $set: { smsLowBalanceAlertLevel: desiredLevel } },
    );
    if (!locked) return; // déjà alerté à ce niveau (ou plus haut) depuis la dernière recharge

    const AdminMessage = require("../db/models/adminMessage.model");
    const eur = (c) => (c / 100).toFixed(2).replace(/\.00$/, "");
    await AdminMessage.create({
      recipient: userId,
      broadcast: false,
      type: empty ? "warning" : "info",
      title: empty ? "Solde SMS épuisé" : "Solde SMS bientôt épuisé",
      body: empty
        ? `Votre solde de rappels SMS/WhatsApp est à 0 €. Les prochains rappels partent par email en attendant une recharge.`
        : `Il vous reste ${eur(balanceCentsAfter)} € de crédit SMS/WhatsApp — pensez à recharger pour ne pas interrompre vos rappels.`,
      ctaLabel: "Recharger mon solde",
      ctaUrl: "/sms",
    });

    try {
      const io = global.__branshee_io || null; // posé par app.js si le socket est prêt
      if (io) io.emit("adminMessage:new");
    } catch (_) {}
  } catch (err) {
    console.error("[sms] maybeAlertLowBalance erreur:", err.message);
  }
}

/**
 * Réarme l'alerte solde bas — à appeler partout où `smsBalanceCents` est
 * CRÉDITÉ (recharge manuelle Stripe, recharge auto réussie). Sans ça, un pro
 * qui recharge après avoir reçu l'alerte n'en recevrait plus jamais si son
 * solde repasse sous le seuil plus tard.
 */
async function resetLowBalanceAlert(userId) {
  try {
    const User = require("../db/models/user.model");
    await User.findByIdAndUpdate(userId, { $set: { smsLowBalanceAlertLevel: "" } });
  } catch (_) {}
}

/**
 * Cœur de facturation d'une notification payante, INDÉPENDANT du canal
 * (SMS Spryng ou WhatsApp Cloud API). Logique :
 *   1) quota inclus du plan (gratuit) → envoi, compteur du mois incrémenté.
 *   2) sinon, solde prépayé → débit atomique de `priceCents` puis envoi
 *      (recharge auto déclenchée si le solde passe sous le seuil configuré).
 *   3) sinon (solde vide / recharge impossible / dépassement non autorisé) →
 *      { sent:false } : l'appelant bascule sur l'email (gratuit). Jamais
 *      d'impayé : on ne débite jamais après coup, on ne dépense le solde que
 *      s'il est déjà provisionné, et on rembourse si l'envoi échoue.
 *
 * Le quota mensuel (`smsUsage`), le solde (`smsBalanceCents`) et le toggle de
 * dépassement (`smsAllowOverage`) sont PARTAGÉS entre les canaux : un rappel
 * WhatsApp et un rappel SMS puisent dans le même pot, seul le prix diffère.
 *
 * @param owner  Document/objet propriétaire (doit contenir _id et calendarSettings)
 * @param opts.priceCents  Prix à débiter du solde au-delà du quota (centimes)
 * @param opts.send        Fonction async d'envoi → identifiant (truthy) ou null
 * @param opts.plan        Forfait de l'ÉTABLISSEMENT concerné. Le quota inclus
 *   est une propriété du forfait, donc de l'établissement — pas du compte.
 *   Omis ⇒ repli sur le forfait du compte owner (comportement historique).
 * Ne lève jamais d'exception.
 */
async function chargeAndSend(owner, { priceCents, send, plan }) {
  const { getSmsQuota, LIMITS } = require("./planLimits");
  const User = require("../db/models/user.model");

  if (!owner) return { sent: false, reason: "missing_owner" };

  const monthKey = new Date().toISOString().slice(0, 7); // "2026-07"
  const quota = plan ? (LIMITS.smsReminders[plan] || 0) : getSmsQuota(owner);

  // État frais (l'objet owner du batch cron peut être périmé).
  const fresh = await User.findById(owner._id)
    .select("smsUsage smsBalanceCents smsAutoRecharge subscription isPremium manualPremium")
    .lean();
  if (!fresh) return { sent: false, reason: "user_not_found" };

  const used = fresh.smsUsage && fresh.smsUsage.monthKey === monthKey
    ? (fresh.smsUsage.count || 0)
    : 0;

  // ── 1) Quota inclus (gratuit) ─────────────────────────────────────────────
  if (quota > 0 && used < quota) {
    const sid = await send();
    if (!sid) return { sent: false, reason: "provider_error" };
    await User.findByIdAndUpdate(owner._id, {
      $set: { "smsUsage.monthKey": monthKey, "smsUsage.count": used + 1 },
    }).catch(() => {});
    return { sent: true, mode: "quota" };
  }

  // ── 2) Au-delà du quota : uniquement si le pro a autorisé le dépassement ──
  const allowOverage = !!(owner.calendarSettings && owner.calendarSettings.smsAllowOverage);
  if (!allowOverage) return { sent: false, reason: "overage_disabled" }; // → repli email

  // ── Solde prépayé ─────────────────────────────────────────────────────────
  let balance = fresh.smsBalanceCents || 0;
  const ar = fresh.smsAutoRecharge || {};
  const threshold = ar.thresholdCents || 500;

  // Recharge auto proactive : solde sous le seuil configuré.
  if (ar.enabled && balance < threshold) {
    balance = await tryAutoRecharge(owner._id, fresh);
  }

  // Débit atomique conditionnel (jamais de solde négatif, pas de double-dépense).
  const debited = await User.findOneAndUpdate(
    { _id: owner._id, smsBalanceCents: { $gte: priceCents } },
    { $inc: { smsBalanceCents: -priceCents } },
    { new: true }
  );
  if (!debited) {
    // Solde insuffisant pour CE message précis : il part par email à la
    // place. C'est le moment le plus parlant pour le pro — pas juste "ça
    // s'épuise", mais "ça vient de manquer".
    maybeAlertLowBalance(owner._id, balance, threshold, true);
    return { sent: false, reason: "no_balance" }; // → repli email
  }

  const sid = await send();
  if (!sid) {
    // Envoi échoué → on rembourse le débit.
    await User.findByIdAndUpdate(owner._id, { $inc: { smsBalanceCents: priceCents } }).catch(() => {});
    return { sent: false, reason: "provider_error" };
  }

  // Best-effort, ne doit jamais retarder ni faire échouer l'envoi qui vient
  // de réussir : l'alerte part en tâche de fond après le `return`.
  maybeAlertLowBalance(owner._id, debited.smsBalanceCents, threshold, false);

  return { sent: true, mode: "balance", balanceCents: debited.smsBalanceCents };
}

/**
 * Envoie un SMS (rappel ou confirmation) via le cœur de facturation partagé
 * `chargeAndSend`, au prix SMS_PRICE_CENTS. Ne lève jamais d'exception.
 */
// `opts.plan` : forfait de l'établissement émetteur (cf. chargeAndSend).
async function sendReminderSmsIfAllowed(owner, to, body, opts = {}) {
  if (!owner || !to) return { sent: false, reason: "missing_owner_or_phone" };
  return chargeAndSend(owner, {
    priceCents: SMS_PRICE_CENTS,
    send: () => sendSms(to, body),
    plan: opts.plan,
  });
}

// La logique de facturation (quota inclus → solde prépayé → repli email) est
// identique pour un rappel ou une confirmation : on expose un alias sémantique
// pour que les appels de confirmation soient explicites côté controllers.
const sendBillableSmsIfAllowed = sendReminderSmsIfAllowed;

module.exports = { sendSms, chargeAndSend, sendReminderSmsIfAllowed, sendBillableSmsIfAllowed, tryAutoRecharge, resetLowBalanceAlert, maybeAlertLowBalance, SMS_PRICE_CENTS };
