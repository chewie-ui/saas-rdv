const mongoose = require("mongoose");
const schema = mongoose.Schema;

// "Rejoindre un établissement" — un User (sans établissement à lui) demande
// à rejoindre la Company d'un autre (uniquement plan Business, cf. plan
// d'unification des comptes). Le propriétaire doit approuver — tant que ce
// n'est pas "accepted", le demandeur n'a aucun accès au dashboard de cette
// Company (cf. middlewares/injectCompany.js).
const companyMembershipSchema = schema(
  {
    company: { type: schema.Types.ObjectId, ref: "Company", required: true },
    user:    { type: schema.Types.ObjectId, ref: "User",    required: true },
    status:  { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },

    // true = invitation envoyée par le patron (collaborateur doit accepter/refuser)
    // false = demande envoyée par le collaborateur (patron doit approuver)
    invitedByOwner: { type: Boolean, default: false },

    // Grade du collaborateur au sein de l'établissement (cf. système de
    // grades/permissions — db/models/company/companyGrade.model.js) — le
    // "patron" reste toujours Company.owner (jamais une ligne ici, accès
    // total implicite). Le propriétaire est seul à pouvoir créer des grades
    // et à en assigner un ici (cf. controllers/grade.controller.js).
    grade: { type: schema.Types.ObjectId, ref: "CompanyGrade", default: null },

    // Override individuel, indépendant du grade : permet au patron
    // d'autoriser/interdire à CE collaborateur précis de poser ses propres
    // congés, même si son grade dit autre chose. `null` = hérite du grade
    // (cf. utils/permissions.js resolveCanManageOwnTimeOff).
    canManageOwnTimeOff: { type: Boolean, default: null },

    // Horaire hebdomadaire propre à ce collaborateur — seulement consulté
    // quand Company.scheduleMode === "perEmployee" (sinon dormant). Même
    // forme que Company.schedule. Vide = pas encore configuré → retombe
    // sur Company.schedule.
    schedule: {
      type: [
        {
          weekdayIndex: { type: Number, required: true, min: 0, max: 6 },
          dayOff: { type: Boolean, default: false },
          workingHours: { type: [{ start: String, end: String }], default: [] },
        },
      ],
      default: [],
    },

    // Horodatage de l'acceptation (≠ createdAt, qui marque la date de la
    // DEMANDE/invitation) — affiché côté UI comme "membre depuis le ...".
    acceptedAt: { type: Date, default: null },

    // Le propriétaire peut suspendre l'accès d'un collaborateur sans le
    // retirer définitivement (réversible) — distinct de status:"rejected"
    // qui s'applique uniquement aux demandes en attente.
    isActive: { type: Boolean, default: true },

    // ── Profil "employé" public (cf. fusion Employé/Collaborateur) ─────────
    // Un collaborateur accepté apparaît par défaut sur la page de réservation
    // publique (comportement opt-out, pas opt-in) — le propriétaire doit
    // explicitement le masquer (toggle "Employé"/"Masqué" sur la page
    // Collaborateurs) s'il ne veut pas qu'il soit bookable (ex: un rôle
    // purement administratif). displayName/displayPhoto sont des surcharges
    // optionnelles (vide = on retombe sur le User).
    isEmployee:   { type: Boolean, default: true },
    displayName:  { type: String, default: "" },
    displayPhoto: { type: String, default: "" },
    description:  { type: String, default: "" },
    showRole:     { type: Boolean, default: false },
    customInfo: [
      {
        label: { type: String, default: "" },
        value: { type: String, default: "" },
      },
    ],
  },
  { timestamps: true }
);

companyMembershipSchema.index({ company: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("CompanyMembership", companyMembershipSchema);
