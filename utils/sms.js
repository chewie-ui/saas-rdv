const _env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const accountSid  = _env.twilioAccountSid  || process.env.TWILIO_ACCOUNT_SID  || "";
const authToken   = _env.twilioAuthToken   || process.env.TWILIO_AUTH_TOKEN   || "";
const fromNumber  = _env.twilioFromNumber  || process.env.TWILIO_FROM_NUMBER  || "";

let client = null;
if (accountSid && authToken) {
  client = require("twilio")(accountSid, authToken);
}

/**
 * Envoie un SMS. Ne fait rien (silencieusement) si Twilio n'est pas configuré,
 * pour ne jamais bloquer le flux de réservation.
 */
async function sendSms(to, body) {
  if (!client || !fromNumber) {
    console.log("[sms] Twilio non configuré — SMS non envoyé:", to, body);
    return null;
  }
  if (!to) return null;

  try {
    const message = await client.messages.create({ to, from: fromNumber, body });
    return message.sid;
  } catch (err) {
    console.error("sendSms error:", err.message);
    return null;
  }
}

module.exports = { sendSms };
