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
          $set: { "smsAutoRecharge.inProgress": false, "smsAutoRecharge.lastFailureAt": null },
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

/**
 * Envoie un SMS de rappel selon la logique :
 *   1) quota inclus du plan (gratuit) → envoi, compteur du mois incrémenté.
 *   2) sinon, solde prépayé → débit atomique de SMS_PRICE_CENTS puis envoi
 *      (recharge auto déclenchée si le solde passe sous le seuil configuré).
 *   3) sinon (solde vide / recharge impossible) → { sent:false } : l'appelant
 *      bascule sur l'email de rappel (gratuit). Jamais d'impayé : on ne débite
 *      jamais après coup, on ne dépense le solde que s'il est déjà provisionné.
 * Ne lève jamais d'exception.
 */
async function sendReminderSmsIfAllowed(owner, to, body) {
  const { getSmsQuota } = require("./planLimits");
  const User = require("../db/models/user.model");

  if (!owner || !to) return { sent: false, reason: "missing_owner_or_phone" };

  const monthKey = new Date().toISOString().slice(0, 7); // "2026-07"
  const quota = getSmsQuota(owner);

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
    const sid = await sendSms(to, body);
    if (!sid) return { sent: false, reason: "twilio_error" };
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
    { _id: owner._id, smsBalanceCents: { $gte: SMS_PRICE_CENTS } },
    { $inc: { smsBalanceCents: -SMS_PRICE_CENTS } },
    { new: true }
  );
  if (!debited) return { sent: false, reason: "no_balance" }; // → repli email

  const sid = await sendSms(to, body);
  if (!sid) {
    // Envoi échoué → on rembourse le débit.
    await User.findByIdAndUpdate(owner._id, { $inc: { smsBalanceCents: SMS_PRICE_CENTS } }).catch(() => {});
    return { sent: false, reason: "twilio_error" };
  }

  return { sent: true, mode: "balance", balanceCents: debited.smsBalanceCents };
}

// La logique de facturation (quota inclus → solde prépayé → repli email) est
// identique pour un rappel ou une confirmation : on expose un alias sémantique
// pour que les appels de confirmation soient explicites côté controllers.
const sendBillableSmsIfAllowed = sendReminderSmsIfAllowed;

module.exports = { sendSms, sendReminderSmsIfAllowed, sendBillableSmsIfAllowed, tryAutoRecharge, SMS_PRICE_CENTS };
