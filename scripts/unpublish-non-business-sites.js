/**
 * "Mon Site" (mini-site vitrine, /mon-site) devient réservé au plan Business
 * (cf. utils/planLimits.js LIMITS.mySite). Avant ce changement, n'importe
 * quel plan pouvait publier un site — ce script dépublie les sites déjà en
 * ligne appartenant à un établissement dont le propriétaire n'est pas
 * Business, pour que la règle s'applique aussi à l'existant.
 *
 * Idempotent : ne touche que les Site avec isPublished:true, sans effet si
 * relancé. Le contenu du site n'est jamais supprimé — seulement dépublié
 * (l'utilisateur peut repasser Business et le republier tel quel).
 *
 * Usage : node scripts/unpublish-non-business-sites.js
 * (à relancer une fois en production au moment du déploiement)
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const Site = require("../db/models/site.model");
const Company = require("../db/models/company/company.model");
const User = require("../db/models/user.model");
const { getPlan } = require("../utils/planLimits");

async function run() {
  await mongoose.connect(env.dbUri);

  const publishedSites = await Site.find({ isPublished: true }).select("_id company slug").lean();
  console.log(`Sites publiés trouvés : ${publishedSites.length}`);

  let unpublished = 0;
  for (const site of publishedSites) {
    const company = await Company.findById(site.company).select("owner slug").lean();
    if (!company) continue;
    const owner = await User.findById(company.owner)
      .select("subscription isPremium manualPremium fullName email")
      .lean();
    const plan = getPlan(owner);
    if (plan !== "business") {
      await Site.findByIdAndUpdate(site._id, { isPublished: false });
      unpublished++;
      console.log(`  ❌ Dépublié : ${site.slug} (établissement /${company.slug || company._id}, plan "${plan}", owner ${owner?.email || "?"})`);
    }
  }

  console.log(`\nTerminé : ${unpublished} site(s) dépublié(s) sur ${publishedSites.length} publié(s).`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Erreur migration:", err);
  process.exit(1);
});
