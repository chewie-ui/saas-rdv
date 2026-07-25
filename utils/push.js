// ── Notifications push (app pro Branshee) ─────────────────────────────────
// Passe par le service Expo Push : on envoie les jetons "ExponentPushToken[…]"
// à l'API d'Expo, qui relaie vers APNs (iOS) et FCM (Android). Aucun certificat
// à gérer côté serveur.
//
// Règle : l'envoi ne doit JAMAIS faire échouer l'action qui l'a déclenché
// (une réservation reste valide même si la notification part en erreur).
const PushToken = require("../db/models/pushToken.model");

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

function isValidExpoToken(token) {
  return typeof token === "string" && EXPO_TOKEN_RE.test(token.trim());
}

// Expo accepte 100 messages par requête.
function chunk(arr, size = 100) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Envoie une notification à TOUS les appareils d'un utilisateur.
// `data` est le contenu transmis à l'app (ex: { type: "booking", bookingId }),
// utilisé pour ouvrir directement le bon écran au tap.
async function sendPushToUser(userId, { title, body, data = {} }) {
  try {
    const devices = await PushToken.find({ user: userId }).select("token").lean();
    if (!devices.length) return { sent: 0 };

    const messages = devices
      .map((d) => d.token)
      .filter(isValidExpoToken)
      .map((to) => ({
        to,
        title,
        body,
        data,
        sound: "default",
        priority: "high",
        // Regroupe les notifications d'un même sujet sur Android.
        channelId: "default",
      }));

    if (!messages.length) return { sent: 0 };

    let sent = 0;
    for (const batch of chunk(messages)) {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.error("[push] Expo a répondu", res.status);
        continue;
      }
      const json = await res.json();
      const tickets = json?.data || [];
      sent += tickets.filter((t) => t.status === "ok").length;

      // Un appareil désinstallé renvoie DeviceNotRegistered : on purge le jeton
      // pour ne pas réessayer indéfiniment.
      const dead = [];
      tickets.forEach((t, i) => {
        if (t.status === "error" && t.details?.error === "DeviceNotRegistered") {
          dead.push(batch[i].to);
        }
      });
      if (dead.length) {
        await PushToken.deleteMany({ token: { $in: dead } }).catch(() => {});
      }
    }
    return { sent };
  } catch (err) {
    console.error("[push] envoi impossible:", err.message);
    return { sent: 0, error: err.message };
  }
}

// Notifie le propriétaire d'un établissement (celui qui reçoit déjà les emails).
async function notifyCompanyOwner(companyOwnerId, payload) {
  if (!companyOwnerId) return { sent: 0 };
  return sendPushToUser(companyOwnerId, payload);
}

module.exports = { sendPushToUser, notifyCompanyOwner, isValidExpoToken };
