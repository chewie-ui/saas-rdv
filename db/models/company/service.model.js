const mongoose = require("mongoose");

const serviceSchema = new mongoose.Schema(
  {
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    price: {
      type: Number,
      default: null, // null = prix non défini
    },
    duration: {
      type: Number,
      default: 30, // en minutes
    },
    active: {
      type: Boolean,
      default: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    category: {
      type: String,
      default: '',
    },
    // "individual" = un client par créneau (comportement par défaut)
    // "group"      = plusieurs clients peuvent réserver le même créneau,
    //                jusqu'à `capacity` places.
    type: {
      type: String,
      enum: ["individual", "group"],
      default: "individual",
    },
    // Nombre de places disponibles par créneau (uniquement pour type === "group")
    capacity: {
      type: Number,
      default: null,
    },
    // Couleur du service (hex) — utilisée pour distinguer les RDV dans le calendrier admin
    color: {
      type: String,
      default: null,
    },
    employees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
      },
    ],
    // Planning récurrent fixe — transforme un service "group" en véritable
    // "cours collectif" (ex: Yoga tous les lundis et mercredis à 18h) au lieu
    // d'un simple créneau collectif réservable à n'importe quelle heure
    // ouverte. Tant que activé, ce service n'est proposé qu'à `startTime`,
    // les jours listés dans `weekdays` (0=dimanche…6=samedi, JS Date#getDay).
    // `employees` (champ déjà existant ci-dessus) définit qui anime le cours :
    // vide = bloque tout le monde sur ce créneau, sinon seuls ces employés
    // sont indisponibles pour d'autres RDV à ce moment-là.
    recurring: {
      enabled: { type: Boolean, default: false },
      weekdays: [{ type: Number, min: 0, max: 6 }],
      startTime: { type: String, default: "" },
    },
    // Frais d'annulation/no-show personnalisés pour ce service — remplace le
    // % de la politique d'annulation globale (ex: un soin à 100€ où le pro
    // préfère ne retenir que 30€ plutôt que 50% imposés par la politique).
    // Ne s'applique que quand la politique globale aurait déjà retenu des
    // frais (annulation tardive) ou en cas d'absence non excusée.
    cancellationFee: {
      enabled: { type: Boolean, default: false },
      type:    { type: String, enum: ["percent", "amount"], default: "percent" },
      value:   { type: Number, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Service", serviceSchema);
