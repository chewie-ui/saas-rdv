const SibApiV3Sdk = require("sib-api-v3-sdk");
const cheerio = require("cheerio");

const client = SibApiV3Sdk.ApiClient.instance;
const apiKey = client.authentications["api-key"];
apiKey.apiKey = process.env.MAIL_PASS;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// Version texte de l'email. Un message HTML seul, sans partie text/plain, est
// un signal de spam classique chez Gmail et Outlook — et il est illisible pour
// qui lit ses mails en texte. Les URL sont conservées entre parenthèses, sinon
// un « Annuler le rendez-vous » cliquable devient un mot mort.
function versionTexte(html) {
  try {
    const $ = cheerio.load(html);
    $("style, script, head").remove();
    $("a").each((_, el) => {
      const lien = ($(el).attr("href") || "").trim();
      const libelle = $(el).text().trim();
      if (lien && !lien.startsWith("mailto:") && libelle && !libelle.includes(lien)) {
        $(el).text(`${libelle} (${lien})`);
      }
    });
    $("br").replaceWith("\n");
    $("p, div, tr, h1, h2, h3, li").append("\n");
    return $("body").text()
      .replace(/[ \t]+/g, " ")
      .split("\n").map((l) => l.trim()).join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch (e) {
    // Jamais bloquant : mieux vaut un email sans partie texte que pas d'email.
    return "";
  }
}

/* ── Transporteurs ─────────────────────────────────────────────────────────
   Deux transporteurs, un seul point d'entrée (sendEmail).

   Brevo (historique) envoie depuis un pool d'IP partagées entre tous ses
   comptes gratuits — et Microsoft (Hotmail/Outlook) classe ce pool en
   indésirables pour toute boîte qui ne connaît pas encore l'expéditeur.
   Vérifié sur une boîte Outlook vierge : trois adresses d'envoi différentes,
   contenu propre, même résultat. Ce n'est ni le contenu ni l'adresse.

   Resend (MAIL_PROVIDER=resend) sert de transporteur principal quand il est
   configuré, sur un pool mieux noté. Brevo reste en SECOURS : si Resend
   refuse ou ne répond pas, le mail part quand même par Brevo. Un rappel de
   rendez-vous en indésirables vaut mieux qu'un rappel jamais envoyé.

   Le choix se fait par variable d'environnement, sans redéploiement de
   code : MAIL_PROVIDER=brevo remet l'ancien comportement à l'identique. */

function expediteurEtReponse(options) {
  const base = require("./adressesContact").expediteur();
  const sender = options.senderName
    ? { email: base.email, name: String(options.senderName).slice(0, 70) }
    : base;
  const replyTo = options.replyTo && options.replyTo.email
    ? { email: options.replyTo.email, ...(options.replyTo.name ? { name: options.replyTo.name } : {}) }
    : null;
  return { sender, replyTo };
}

// « Nom <adresse> » — la forme qu'attendent Resend et la plupart des API.
function adresseNommee(a) {
  return a.name ? `${a.name.replace(/[<>"]/g, "")} <${a.email}>` : a.email;
}

async function envoyerParBrevo({ to, subject, html, texte, sender, replyTo }) {
  await apiInstance.sendTransacEmail({
    // Réglable par MAIL_FROM / MAIL_FROM_NAME, mais à ne pas changer à la
    // légère : ce domaine est signé (SPF/DKIM) côté Brevo. Expédier depuis
    // une adresse non signée envoie tout en indésirables.
    sender,
    to: [{ email: to }],
    ...(replyTo ? { replyTo } : {}),
    subject,
    htmlContent: html,
    ...(texte ? { textContent: texte } : {}),
    tags: ["transactional"], // 👈
    headers: {
      "X-Mailin-no-track-link": "1", // 👈
    },
  });
}

async function envoyerParResend({ to, subject, html, texte, sender, replyTo }) {
  const cle = process.env.RESEND_API_KEY;
  if (!cle) throw new Error("RESEND_API_KEY absent");
  // Délai court et explicite : un transporteur qui ne répond pas ne doit pas
  // retenir un rappel de rendez-vous — on bascule sur Brevo.
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: adresseNommee(sender),
        to: [to],
        ...(replyTo ? { reply_to: adresseNommee(replyTo) } : {}),
        subject,
        html,
        ...(texte ? { text: texte } : {}),
        tags: [{ name: "type", value: "transactional" }],
      }),
    });
    if (!r.ok) {
      const corps = await r.text().catch(() => "");
      throw new Error(`Resend HTTP ${r.status} ${corps.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(minuteur);
  }
}

function transporteurPrincipal() {
  const voulu = String(process.env.MAIL_PROVIDER || "").toLowerCase();
  if (voulu === "resend" && process.env.RESEND_API_KEY) return "resend";
  return "brevo";
}

/**
 * @param {object} [options]
 * @param {string} [options.senderName]  Nom AFFICHÉ de l'expéditeur, ex.
 *   « Cabinet Dupont via BranShee ». L'adresse, elle, ne change jamais : c'est
 *   elle qui est signée (SPF/DKIM).
 * @param {{email:string,name?:string}} [options.replyTo]  Boîte qui reçoit
 *   les réponses — en pratique celle du professionnel.
 *
 * Pourquoi ces deux options : les clients Outlook/Hotmail se plaignaient de
 * ne rien recevoir. Brevo, lui, marquait tout « delivered » — Microsoft
 * acceptait bien les messages, puis les classait en indésirables. Deux signaux
 * connus y contribuent, et ils étaient tous deux contre nous : un expéditeur
 * « noreply » sans Reply-To (personne ne peut répondre = boîte de masse), et
 * un nom d'expéditeur générique que le client ne reconnaît pas — il a pris
 * rendez-vous chez « Morgane Forzée », pas chez « BranShee ».
 */
const sendEmail = async (to, subject, html, options = {}) => {
  const texte = versionTexte(html);
  const { sender, replyTo } = expediteurEtReponse(options);
  const message = { to, subject, html, texte, sender, replyTo };
  const principal = transporteurPrincipal();

  if (principal === "resend") {
    try {
      await envoyerParResend(message);
      console.log(`${to} (resend)`);
      return true;
    } catch (err) {
      // Repli : on le dit clairement dans les logs, pour qu'un Resend en panne
      // se voie — sinon on croirait que tout part sur le bon pool d'IP.
      console.error("Resend a échoué, repli sur Brevo ⚠️", err.message);
    }
  }

  try {
    await envoyerParBrevo(message);
    console.log(`${to} (brevo)`);
    return true;
  } catch (err) {
    console.error("Erreur email ❌", err);
    return false;
  }
};

module.exports = { sendEmail, versionTexte, transporteurPrincipal };
