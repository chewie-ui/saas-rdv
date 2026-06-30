/**
 * Backfill : attribue un employé à tous les RDV qui n'en ont pas (employee: null).
 * Pour chaque booking sans employé, on prend le premier membre de l'équipe bookable
 * de l'établissement (patron si solo, sinon premier employé actif).
 *
 * Idempotent : seuls les bookings avec employee === null sont touchés.
 * Usage : node scripts/migrate-assign-booking-employees.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const Company      = require("../db/models/company/company.model");
const Booking      = require("../db/models/book.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const User         = require("../db/models/user.model");

mongoose.connect(env.db).then(async () => {
  console.log("✅ Connecté à MongoDB");

  // Tous les bookings sans employé (non annulés de préférence, mais on traite tous)
  const bookings = await Booking.find({ employee: null }).lean();
  console.log(`📋 ${bookings.length} RDV sans employé trouvés`);

  if (bookings.length === 0) {
    console.log("Rien à faire.");
    await mongoose.disconnect();
    return;
  }

  // Construire un cache company → équipe bookable pour éviter N requêtes par booking
  const teamCache = new Map();

  async function getTeamForCompany(companyId) {
    const key = String(companyId);
    if (teamCache.has(key)) return teamCache.get(key);

    const company = await Company.findById(companyId).select("owner").lean();
    if (!company) { teamCache.set(key, []); return []; }

    // Patron en premier
    const owner = await User.findById(company.owner).select("fullName").lean();
    const team = [];
    if (owner) {
      const [firstName, ...rest] = (owner.fullName || "").split(" ");
      team.push({ id: String(owner._id), firstName, lastName: rest.join(" ") });
    }

    // Employés actifs (acceptés, isEmployee:true)
    const members = await CompanyMembership.find({
      company: companyId,
      status: "accepted",
      isEmployee: true,
    }).populate("user", "fullName").lean();

    for (const m of members) {
      if (!m.user) continue;
      const [firstName, ...rest] = (m.displayName || m.user.fullName || "").split(" ");
      team.push({ id: String(m.user._id), firstName, lastName: rest.join(" ") });
    }

    teamCache.set(key, team);
    return team;
  }

  let updated = 0, skipped = 0;

  for (const booking of bookings) {
    const team = await getTeamForCompany(booking.company);
    if (team.length === 0) {
      console.log(`  ⚠️  Booking ${booking._id} — aucune équipe trouvée pour company ${booking.company}, ignoré`);
      skipped++;
      continue;
    }

    const assignee = team[0];
    const employeeName = `${assignee.firstName} ${assignee.lastName}`.trim();

    await Booking.updateOne(
      { _id: booking._id },
      { $set: { employee: assignee.id, employeeName } }
    );
    updated++;
  }

  console.log(`\n✅ Migration terminée : ${updated} RDV mis à jour, ${skipped} ignorés (pas d'équipe)`);
  await mongoose.disconnect();
}).catch((err) => {
  console.error("❌ Erreur :", err);
  process.exit(1);
});
