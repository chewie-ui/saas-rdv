const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");

/**
 * Source de vérité unique pour "qui est bookable sur le calendrier public
 * de cet établissement" (cf. fusion Employé/Collaborateur). Remplace les
 * anciens appels à Employee.find({company, active:true}) — l'identité d'un
 * membre de l'équipe est désormais toujours un User._id (le patron compris),
 * jamais un Employee._id séparé.
 *
 * Retourne une liste normalisée :
 *   { id, firstName, lastName, photo, description, role, showRole, customInfo }
 * - Le patron apparaît en premier si Company.ownerEmployeeProfile.isEmployee.
 * - Chaque collaborateur accepté + actif + isEmployee apparaît ensuite.
 */
async function getBookableTeam(companyId) {
  const company = await Company.findById(companyId).populate("owner", "fullName profilePicture").lean();
  if (!company) return [];

  const team = [];

  const ownerProfile = company.ownerEmployeeProfile || {};
  if (ownerProfile.isEmployee !== false && company.owner) {
    const ownerId = String(company.owner._id);
    const [firstName, ...rest] = (ownerProfile.displayName || company.owner.fullName || "").trim().split(" ");
    const photo = ownerProfile.displayPhoto || company.owner.profilePicture || "";
    team.push({
      id: ownerId,
      _id: ownerId, // alias — beaucoup de vues/anciens contrôleurs lisent `_id`
      firstName: firstName || "",
      lastName: rest.join(" ") || "",
      photo,
      profilePicture: photo, // alias — idem
      description: ownerProfile.description || "",
      role: "owner",
      showRole: !!ownerProfile.showRole,
      customInfo: ownerProfile.customInfo || [],
    });
  }

  const memberships = await CompanyMembership.find({
    company: companyId,
    status: "accepted",
    isActive: { $ne: false },
    isEmployee: true,
  })
    .populate("user", "fullName profilePicture")
    .populate("grade", "name")
    .lean();

  memberships.forEach((m) => {
    if (!m.user) return;
    const userId = String(m.user._id);
    const [firstName, ...rest] = (m.displayName || m.user.fullName || "").trim().split(" ");
    const photo = m.displayPhoto || m.user.profilePicture || "";
    team.push({
      id: userId,
      _id: userId, // alias — beaucoup de vues/anciens contrôleurs lisent `_id`
      firstName: firstName || "",
      lastName: rest.join(" ") || "",
      photo,
      profilePicture: photo, // alias — idem
      description: m.description || "",
      role: m.grade?.name || "",
      showRole: !!m.showRole,
      customInfo: m.customInfo || [],
    });
  });

  return team;
}

module.exports = { getBookableTeam };
