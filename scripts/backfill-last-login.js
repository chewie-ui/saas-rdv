/* Renseigne User.lastLoginAt à partir de l'historique LoginEvent.
   À lancer une fois : le champ n'existait pas, seul l'historique des
   connexions était enregistré.
   Usage : node scripts/backfill-last-login.js */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../db/models/user.model");
const LoginEvent = require("../db/models/loginEvent.model");

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGO_URI_LOCAL;
  await mongoose.connect(uri);

  const dernieres = await LoginEvent.aggregate([
    { $group: { _id: "$user", date: { $max: "$createdAt" } } },
  ]);

  let maj = 0;
  for (const l of dernieres) {
    const r = await User.updateOne({ _id: l._id }, { $set: { lastLoginAt: l.date } });
    if (r.modifiedCount) maj++;
  }

  console.log(`${dernieres.length} comptes avec un historique · ${maj} mis à jour`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error("Erreur :", e.message);
  process.exit(1);
});
