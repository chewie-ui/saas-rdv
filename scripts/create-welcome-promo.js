/**
 * Script ponctuel : crée le code promo "BIENVENUE" (1 mois d'essai gratuit, type trial)
 * pour appuyer le claim "1 mois offert" de la landing page Google Ads (/pro).
 *
 * Usage : node scripts/create-welcome-promo.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const PromoCode = require("../db/models/promoCode.model");

const CODE = "BIENVENUE";

(async () => {
  try {
    await mongoose.connect(env.dbUri);
    console.log("DB connectée:", mongoose.connection.name);

    const existing = await PromoCode.findOne({ code: CODE });
    if (existing) {
      console.log(`✓ Le code "${CODE}" existe déjà :`, {
        discountType: existing.discountType,
        trialDays: existing.trialDays,
        active: existing.active,
        usedCount: existing.usedCount,
      });
    } else {
      const promo = await PromoCode.create({
        code: CODE,
        discountType: "trial",
        discountValue: 0,
        trialDays: 30,
        maxUses: null,        // illimité
        expiresAt: null,      // pas d'expiration
        applicablePlan: "all",
        active: true,
      });
      console.log(`✓ Code promo "${CODE}" créé avec succès :`, {
        id: promo._id.toString(),
        discountType: promo.discountType,
        trialDays: promo.trialDays,
        active: promo.active,
      });
    }
  } catch (err) {
    console.error("✗ Erreur :", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
})();
