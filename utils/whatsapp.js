const _env = require(`../environment/${process.env.NODE_ENV || "development"}`);

// ── Fournisseur WhatsApp : Meta Cloud API (Graph API officielle) ─────────────
// Un SEUL numéro WhatsApp Business partagé (comme l'originator SMS « BranShee »).
// Tous les rappels/confirmations partent de ce numéro. Config via .env :
//   WHATSAPP_TOKEN               → jeton d'accès permanent (System User token Meta)
//   WHATSAPP_PHONE_NUMBER_ID     → ID du numéro expéditeur (≠ le numéro lui-même)
//   WHATSAPP_API_VERSION         → version Graph API (défaut "v22.0")
//   WHATSAPP_TEMPLATE_LANG       → code langue des templates (défaut "fr")
//   WHATSAPP_REMINDER_TEMPLATE   → nom du template de rappel validé par Meta
//   WHATSAPP_CONFIRMATION_TEMPLATE → nom du template de confirmation validé
// Les identifiants n'ont pas à figurer dans environment/*.js : on lit d'abord
// _env (si un jour ajouté) puis process.env en repli, comme utils/sms.js.
const WA_TOKEN    = _env.whatsappToken          || process.env.WHATSAPP_TOKEN           || "";
const WA_PHONE_ID = _env.whatsappPhoneNumberId  || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WA_VERSION  = _env.whatsappApiVersion     || process.env.WHATSAPP_API_VERSION     || "v22.0";
const WA_LANG     = _env.whatsappTemplateLang   || process.env.WHATSAPP_TEMPLATE_LANG   || "fr";
const WA_TPL_REMINDER     = _env.whatsappReminderTemplate     || process.env.WHATSAPP_REMINDER_TEMPLATE     || "rdv_rappel";
const WA_TPL_CONFIRMATION = _env.whatsappConfirmationTemplate || process.env.WHATSAPP_CONFIRMATION_TEMPLATE || "rdv_confirmation";
// Langue PROPRE à chaque template : Meta fige la langue à la création, et rien
// n'oblige rappel et confirmation à partager la même. Défaut = WA_LANG pour les
// deux ; surchargeable indépendamment (ex. confirmation créée en anglais →
// WHATSAPP_CONFIRMATION_LANG=en). Utilisé quand l'appelant ne passe pas de lang.
const WA_TPL_REMINDER_LANG     = _env.whatsappReminderLang     || process.env.WHATSAPP_REMINDER_LANG     || WA_LANG;
const WA_TPL_CONFIRMATION_LANG = _env.whatsappConfirmationLang || process.env.WHATSAPP_CONFIRMATION_LANG || WA_LANG;

// Prix de vente d'un message WhatsApp au-delà du quota inclus, en centimes.
// Un message « utility » Meta coûte ~0,03–0,05 € en Europe (souvent gratuit
// dans la fenêtre de 24h) : bien moins cher que le SMS (12c). On facture 5c —
// même pot de crédits que le SMS, prix moindre (cf. utils/sms.js chargeAndSend).
const WHATSAPP_PRICE_CENTS = 5;

/**
 * WhatsApp est-il configuré côté serveur ? (jeton + phone number id présents)
 * Sert de garde partout : sans config, on n'essaie même pas d'envoyer et on
 * bascule proprement sur le SMS/email.
 */
function isWhatsappConfigured() {
  return !!(WA_TOKEN && WA_PHONE_ID);
}

/**
 * Normalise un numéro en MSISDN international sans « + » (format attendu par
 * l'API WhatsApp, identique à Spryng).
 *   +32470123456  → 32470123456
 *   0032470123456 → 32470123456
 *   0470123456    → 32470123456   (préfixe pays par défaut, Belgique)
 *   32470123456   → 32470123456   (déjà international)
 */
function normalizeMsisdn(phone, defaultCC) {
  const cc = defaultCC || _env.spryngDefaultCC || process.env.SPRYNG_DEFAULT_CC || "32";
  let p = String(phone || "").replace(/[^\d+]/g, "");
  if (!p) return "";
  if (p.startsWith("+"))  return p.slice(1);
  if (p.startsWith("00")) return p.slice(2);
  if (p.startsWith("0"))  return cc + p.slice(1);
  return p;
}

/**
 * Envoie un message WhatsApp basé sur un TEMPLATE pré-validé par Meta.
 * WhatsApp interdit le texte libre à l'initiative de l'entreprise hors fenêtre
 * de 24h : on passe donc obligatoirement par un template (catégorie « utility »
 * pour les rappels/confirmations de RDV).
 *
 * Ne lève jamais d'exception et retourne null (sans bloquer le flux appelant)
 * si WhatsApp n'est pas configuré ou en cas d'erreur. Retourne l'identifiant
 * du message (ou "sent") en cas de succès.
 *
 * @param to            Numéro du destinataire (format libre, normalisé ici)
 * @param opts.template Nom du template validé (défaut : template de rappel)
 * @param opts.lang     Code langue du template (défaut WA_LANG)
 * @param opts.params   Tableau de variables du corps ({{1}}, {{2}}, …), dans l'ordre
 */
async function sendWhatsappTemplate(to, { template, lang, params } = {}) {
  if (!isWhatsappConfigured()) {
    console.log("[whatsapp] non configuré — message non envoyé:", to);
    return null;
  }
  const recipient = normalizeMsisdn(to);
  if (!recipient) return null;

  const templateName = template || WA_TPL_REMINDER;
  // Langue : explicite (opts.lang) > langue propre au template connu > WA_LANG.
  const langCode = lang
    || (templateName === WA_TPL_CONFIRMATION ? WA_TPL_CONFIRMATION_LANG
      : templateName === WA_TPL_REMINDER     ? WA_TPL_REMINDER_LANG
      : WA_LANG);
  const components = Array.isArray(params) && params.length
    ? [{
        type: "body",
        parameters: params.map((v) => ({ type: "text", text: String(v == null ? "" : v) })),
      }]
    : [];

  const endpoint = `https://graph.facebook.com/${WA_VERSION}/${WA_PHONE_ID}/messages`;

  try {
    // Timeout dur : l'appel externe ne doit jamais faire traîner la requête
    // appelante (réservation). 8 s max, sinon on abandonne (repli SMS/email).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          Authorization: "Bearer " + WA_TOKEN,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "template",
          template: {
            name: templateName,
            language: { code: langCode },
            ...(components.length ? { components } : {}),
          },
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[whatsapp] Meta erreur:", res.status, txt.slice(0, 400));
      return null;
    }
    const data = await res.json().catch(() => ({}));
    const id = data && data.messages && data.messages[0] && data.messages[0].id;
    return id || "sent";
  } catch (err) {
    console.error("sendWhatsappTemplate error:", err.message);
    return null;
  }
}

/**
 * Envoie un rappel/confirmation WhatsApp via le cœur de facturation PARTAGÉ
 * avec le SMS (`chargeAndSend` de utils/sms.js) : même quota mensuel, même
 * solde prépayé, même toggle de dépassement — seul le prix diffère
 * (WHATSAPP_PRICE_CENTS). Retourne { sent, mode } ; { sent:false } déclenche le
 * repli SMS/email côté appelant. Ne lève jamais d'exception.
 *
 * @param owner    Propriétaire (facturé)
 * @param to       Numéro du client
 * @param opts     { template, lang, params } passés à sendWhatsappTemplate,
 *                 + `plan` : forfait de l'ÉTABLISSEMENT émetteur, qui porte le
 *                 quota inclus (cf. chargeAndSend).
 */
async function sendWhatsappIfAllowed(owner, to, opts = {}) {
  if (!owner || !to) return { sent: false, reason: "missing_owner_or_phone" };
  if (!isWhatsappConfigured()) return { sent: false, reason: "whatsapp_not_configured" };
  const { chargeAndSend } = require("./sms");
  return chargeAndSend(owner, {
    priceCents: WHATSAPP_PRICE_CENTS,
    send: () => sendWhatsappTemplate(to, opts),
    plan: opts.plan,
  });
}

module.exports = {
  sendWhatsappTemplate,
  sendWhatsappIfAllowed,
  isWhatsappConfigured,
  normalizeMsisdn,
  WHATSAPP_PRICE_CENTS,
  WA_TPL_REMINDER,
  WA_TPL_CONFIRMATION,
  WA_LANG,
  WA_TPL_REMINDER_LANG,
  WA_TPL_CONFIRMATION_LANG,
};
