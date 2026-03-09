const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

exports.sendEmail = async (to, subject, htmlContent) => {
  console.log(process.env.MAIL_HOST);
  console.log(process.env.MAIL_PORT);
  console.log(process.env.MAIL_USER);
  console.log(process.env.MAIL_PASS);

  try {
    const info = await transporter.sendMail({
      from: '"Mon app" <noreply@monsite.com>',
      to,
      subject,
      html: htmlContent,
    });
    console.log(info);

    return info;
  } catch (error) {
    console.error(error);
    throw error;
  }
};
