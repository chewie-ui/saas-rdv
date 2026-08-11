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

const sendEmail = async (to, subject, html) => {
  try {
    const texte = versionTexte(html);

    await apiInstance.sendTransacEmail({
      // Réglable par MAIL_FROM / MAIL_FROM_NAME, mais à ne pas changer à la
      // légère : ce domaine est signé (SPF/DKIM) côté Brevo. Expédier depuis
      // une adresse non signée envoie tout en indésirables.
      sender: require("./adressesContact").expediteur(),
      to: [{ email: to }],
      subject,
      htmlContent: html,
      ...(texte ? { textContent: texte } : {}),
      tags: ["transactional"], // 👈
      headers: {
        "X-Mailin-no-track-link": "1", // 👈
      },
    });

    console.log(to);

    return true;
  } catch (err) {
    console.error("Erreur email ❌", err);
    return false;
  }
};

module.exports = { sendEmail, versionTexte };
