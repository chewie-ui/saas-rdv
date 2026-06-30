const mongoose = require("mongoose");
const schema = mongoose.Schema;

// Grade = ensemble de permissions nommé, défini par le patron pour son
// établissement (ex. "Manager", "Réceptionniste", "Thérapeute senior").
// Le patron lui-même n'a jamais de grade — il n'a pas de CompanyMembership
// pour sa propre Company, son accès est toujours total (cf. utils/permissions.js
// OWNER_PERMISSIONS). La création/édition des grades reste réservée au
// patron (cf. controllers/grade.controller.js) : déléguer ça permettrait à
// un collaborateur de s'auto-attribuer un grade tout-puissant.
const boolField = { type: Boolean, default: false };

const companyGradeSchema = schema(
  {
    company: { type: schema.Types.ObjectId, ref: "Company", required: true },
    name: { type: String, required: true, trim: true },

    // Grades "Manager"/"Staff" créés automatiquement à la migration —
    // simple indicateur d'origine, n'empêche ni la modification ni la
    // suppression (juste un repère visuel possible côté UI).
    isBuiltIn: { type: Boolean, default: false },

    permissions: {
      appointments: {
        view: boolField,
        manage: boolField,
        cancelDelete: boolField,
      },
      clients: {
        view: boolField,
        manage: boolField,
      },
      services: {
        view: boolField,
        manage: boolField,
      },
      groupSessions: {
        view: boolField,
        manage: boolField,
      },
      availability: {
        manageShared: boolField,
        manageOwnSchedule: boolField,
        manageOthersSchedule: boolField,
        manageOwnTimeOff: boolField,
        manageOthersTimeOff: boolField,
      },
      forms: {
        manage: boolField,
      },
      customization: {
        manage: boolField,
      },
      settings: {
        manage: boolField,
      },
      // Permet d'inviter/virer/suspendre un collaborateur et de lui assigner
      // un grade EXISTANT — jamais de créer/modifier un grade lui-même
      // (cf. controllers/grade.controller.js, toujours owner-only).
      collaborators: {
        view: boolField,
        manage: boolField,
      },
      grades: {
        view: boolField,
        manage: boolField,
      },
      logs: {
        view: boolField,
      },
      billing: {
        manage: boolField,
      },
      establishment: {
        manage: boolField,
        delete: boolField,
      },
    },
  },
  { timestamps: true }
);

companyGradeSchema.index({ company: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("CompanyGrade", companyGradeSchema);
