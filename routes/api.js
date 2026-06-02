const router = require("express").Router();
const User   = require("../db/models/user.model");

router.get("/test", (req, res) => {
  res.send("test");
});

// Vérifier un code de parrainage (utilisé sur la page d'inscription)
router.get("/check-ref", async (req, res) => {
  const code = (req.query.code || "").trim().toUpperCase();
  if (!code) return res.json({ valid: false });
  try {
    const user = await User.findOne({ referralCode: code }).select("fullName").lean();
    if (!user) return res.json({ valid: false });
    // Retourner le prénom seulement (pas le nom complet pour la confidentialité)
    const firstName = (user.fullName || "").split(" ")[0];
    return res.json({ valid: true, name: firstName });
  } catch (_) {
    return res.json({ valid: false });
  }
});

module.exports = router;
