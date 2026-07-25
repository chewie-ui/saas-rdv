// Génère un code de parrainage unique de la forme PRENOM-XXXXXX.
// Extrait de controllers/auth.controller.js pour être partagé avec l'API
// mobile (controllers/mobile/auth.mobile.controller.js) — les deux chemins
// d'inscription doivent produire exactement le même format de code.
const crypto = require("crypto");
const User = require("../db/models/user.model");

async function generateReferralCode(fullName) {
  const base = (fullName || "USER").trim().split(" ")[0]
    .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
  for (let i = 0; i < 10; i++) {
    const code = `${base}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  return `USER-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

module.exports = { generateReferralCode };
