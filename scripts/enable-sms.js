/**
 * Active (ou désactive) le feature flag "sms_notifications".
 * Usage :
 *   node scripts/enable-sms.js            → active
 *   node scripts/enable-sms.js off        → désactive (status: disabled)
 *
 * Sans effet réel tant que Spryng n'est pas configuré (SPRYNG_API_TOKEN /
 * SPRYNG_ORIGINATOR) : les envois retombent sur l'email.
 */
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const mongoose = require("mongoose");
const FeatureFlag = require("../db/models/featureFlag.model");

const disable = process.argv[2] === "off";
const status = disable ? "disabled" : "active";

(async () => {
  try {
    await mongoose.connect(env.dbUri);
    const doc = await FeatureFlag.findOneAndUpdate(
      { key: "sms_notifications" },
      { $set: { key: "sms_notifications", label: "Rappels & confirmations SMS", status } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`✅ Feature flag "sms_notifications" → status="${doc.status}"`);
  } catch (err) {
    console.error("❌ Erreur:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
