// const nodemailer = require("nodemailer");

// const transporter = nodemailer.createTransport({
//   host: process.env.MAIL_HOST,
//   port: process.env.MAIL_PORT,
//   auth: {
//     user: process.env.MAIL_USER,
//     pass: process.env.MAIL_PASS,
//   },
// });

const SibApiV3Sdk = require("sib-api-v3-sdk");

const client = SibApiV3Sdk.ApiClient.instance;
const apiKey = client.authentications["api-key"];
apiKey.apiKey = process.env.MAIL_PASS;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

const sendEmail = async (to, subject, html) => {
  try {
    await apiInstance.sendTransacEmail({
      sender: {
        email: "noreply@gymio.be",
        name: "Gymio",
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
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

module.exports = { sendEmail };
