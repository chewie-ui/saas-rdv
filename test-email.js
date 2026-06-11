require("dotenv").config();
const { sendEmail } = require("./utils/mailer");

const to = process.argv[2] || process.env.ADMIN_EMAIL;

console.log("MAIL_PASS commence par:", (process.env.MAIL_PASS || "") + "...");
console.log("Envoi d'un email de test à:", to);

sendEmail(to, "Test Branshee — vérification Brevo", "<p>Ceci est un email de test.</p>").then((ok) => {
  console.log("Résultat:", ok ? "✅ envoyé" : "❌ échec (voir erreur ci-dessus)");
  process.exit(ok ? 0 : 1);
});
