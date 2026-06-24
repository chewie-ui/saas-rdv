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
      default: 30, // en minutes — borne basse si durationMax est défini
    },
    // Durée approximative ("30-40 min") — borne haute optionnelle. Si
    // définie, le calcul réel des créneaux (chevauchements, blocage du
    // planning) utilise TOUJOURS cette valeur pour ne jamais sur-réserver
    // un pro qui aurait sous-estimé un soin ; seul l'affichage montre la
    // fourchette "duration-durationMax min" au client.
    durationMax: {
      type: Number,
      default: null,
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
    // Dates ponctuelles ("ateliers") — utilisé quand recurring.enabled === false
    // sur un service "group" : chaque entrée est une occurrence indépendante
    // avec sa propre date + plage horaire, au lieu d'une récurrence
    // hebdomadaire fixe (ex: un atelier le 1/7 19h-20h, un autre le 5/7
    // 12h-13h, pas forcément le même jour de semaine ni la même heure).
    // La capacité reste PARTAGÉE (capacity ci-dessus) entre toutes les
    // occurrences — pas de surcharge par date, pour garder l'admin simple.
    sessions: [
      {
        date: { type: Date, required: true },
        startTime: { type: String, required: true }, // "HH:MM"
        endTime: { type: String, required: true }, // "HH:MM"
      },
    ],
    // Lieu spécifique à ce service (utilisé pour les cours collectifs, ex: un
    // studio loué pour l'occasion) — vide = adresse par défaut du compte
    // (User.location), résolue côté contrôleur au moment de l'affichage.
    location: {
      type: String,
      default: "",
      trim: true,
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
    // Limite ce service à l'une des deux réponses de la "question préalable"
    // du compte (Company.bookingQuestion) — "all" (par défaut) = toujours
    // affiché, peu importe la réponse (ou si la question est désactivée).
    answerVisibility: {
      type: String,
      enum: ["all", "new", "existing"],
      default: "all",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Service", serviceSchema);
