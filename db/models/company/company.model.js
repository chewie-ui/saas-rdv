const mongoose = require("mongoose");
const schema = mongoose.Schema;

const companySchema = schema(
  {
    owner: {
      type: schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ── Multi-établissements (cf. plan "gérer mes établissements") ───────────
    // Un même owner peut désormais posséder plusieurs Company. Name/businessType/
    // photo vivent ici (et plus seulement sur User) pour que chaque établissement
    // ait sa propre identité dans la liste — fallback sur owner.businessName/
    // businessType/businessPicture quand vide (établissements créés avant cette
    // fonctionnalité, à l'époque où un seul établissement par owner existait).
    name: {
      type: String,
      default: "",
      trim: true,
    },
    businessType: {
      type: String,
      default: "",
      trim: true,
    },
    photo: {
      type: String,
      default: "",
    },

    // Mis en pause par le pro lui-même (≠ isDisabled, qui est une action du
    // superadmin) — masque la page publique et /search, mais n'affecte ni la
    // connexion, ni l'abonnement Stripe, ni aucune donnée. Réversible.
    isPaused: {
      type: Boolean,
      default: false,
    },

    // ── Forfait porté par l'établissement (facturation par établissement) ──
    // Vide = hérite du forfait du compte owner (compat avant la facturation
    // par établissement). Une fois branché sur Stripe, chaque établissement a
    // son propre plan. `getCompanyPlan()` (utils/planLimits) résout l'effectif.
    plan: {
      type: String,
      enum: ["", "basic", "essentiel", "pro", "business"],
      default: "",
    },
    planStatus: {
      type: String,
      enum: ["active", "cancelled", "expired", "pending", "inactive"],
      default: "active",
    },
    stripeSubscriptionId: {
      type: String,
      default: "",
    },

    // Suppression douce (cf. "supprimer un établissement") : on ne détruit
    // jamais les données (services, employés, historique de RDV) — on masque
    // simplement l'établissement de toutes les listes/recherches.
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },

    // ── Profil "employé" public du propriétaire (cf. fusion Employé/
    // Collaborateur) — le patron n'a pas de CompanyMembership pour sa
    // propre société, donc son profil bookable vit ici. isEmployee par
    // défaut à true : dans un établissement solo (aucun collaborateur),
    // c'est lui l'unique personne bookable.
    ownerEmployeeProfile: {
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
      // Horaire individuel du patron — même rôle que CompanyMembership.schedule
      // pour les collaborateurs (cf. scheduleMode ci-dessous). Vide = retombe
      // sur le schedule commun.
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
    },

    // "shared"     = tous les employés bookables suivent le même `schedule`
    //                ci-dessous (comportement historique).
    // "perEmployee" = chaque employé (CompanyMembership.schedule ou
    //                ownerEmployeeProfile.schedule pour le patron) a son
    //                propre horaire hebdomadaire ; `schedule` ci-dessous
    //                reste le réglage "commun" éditable par
    //                availability.manageShared et sert de filet par défaut
    //                pour tout employé dont le schedule individuel est
    //                encore vide.
    scheduleMode: {
      type: String,
      enum: ["shared", "perEmployee"],
      default: "shared",
    },

    slug: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },

    slotTime: {
      type: Number,
      default: 30,
    },

    // Temps tampon (en minutes) à respecter avant ET après chaque RDV.
    // Conservé pour compatibilité — remplacé par bufferBefore/bufferAfter.
    bufferTime: {
      type: Number,
      default: 0,
    },

    // Temps tampon (en minutes) à respecter avant chaque RDV.
    bufferBefore: {
      type: Number,
      default: null,
    },

    // Temps tampon (en minutes) à respecter après chaque RDV.
    bufferAfter: {
      type: Number,
      default: null,
    },

    // "fixed"    = créneaux générés sur la durée du service/slot (ex: 9h00, 9h30, 10h00...)
    // "interval" = créneaux proposés toutes les `slotInterval` minutes,
    //              indépendamment de la durée de la prestation (ex: 9h00, 9h10, 9h20...)
    slotMode: {
      type: String,
      enum: ["fixed", "interval"],
      default: "fixed",
    },

    slotInterval: {
      type: Number,
      default: 30,
    },

    schedule: [
      {
        weekdayIndex: {
          type: Number,
          required: true,
          min: 0,
          max: 6,
        },
        dayOff: {
          type: Boolean,
          default: false,
        },
        workingHours: {
          type: [{ start: String, end: String }],
          default: [{ start: "08:00", end: "16:00" }],
        },
      },
    ],

    // ── Pré-paiement ─────────────────────────────────────────────────────────
    prepayment: {
      enabled:  { type: Boolean, default: false },
      required: { type: Boolean, default: false }, // false = client peut choisir
    },

    // ── Politique d'annulation ────────────────────────────────────────────────
    // "free"     = annulation toujours gratuite
    // "half_24h" = 50% si annulation < 24h avant
    // "full_12h" = 100% si < 12h, 50% si entre 12h et 24h
    cancellationPolicy: {
      rule: { type: String, enum: ["free", "half_24h", "full_12h"], default: "free" },
    },

    // ── Stripe Connect (paiement en ligne) ────────────────────────────────────
    stripeConnect: {
      accountId:    { type: String, default: "" },
      status:       { type: String, enum: ["not_connected", "pending", "active"], default: "not_connected" },
      accountEmail: { type: String, default: "" },
    },

    // ── Moyen préféré de l'admin pour recevoir ses reversements BranShee ──────
    payoutInfo: {
      method:      { type: String, enum: ["bank_transfer", "paypal", "cash", "other", ""], default: "" },
      iban:        { type: String, default: "" },
      bic:         { type: String, default: "" },
      paypalEmail: { type: String, default: "" },
      other:       { type: String, default: "" },
    },

    // ── Modes de paiement acceptés (affichés + proposés au client) ────────────
    acceptedPayments: {
      cash:       { type: Boolean, default: false },   // espèces sur place
      cardOnSite: { type: Boolean, default: false },   // CB/TPE sur place
      bankTransfer: {
        enabled:  { type: Boolean, default: false },
        iban:     { type: String,  default: "" },
        bic:      { type: String,  default: "" },
        bankName: { type: String,  default: "" },
        note:     { type: String,  default: "" },      // instructions libres
      },
      paypal: {
        enabled:  { type: Boolean, default: false },
        paypalMe: { type: String,  default: "" },      // ex: "username" ou "https://paypal.me/username"
      },
      qrCode: {
        enabled:  { type: Boolean, default: false },
        imageUrl: { type: String,  default: "" },      // photo du QR code (Payconiq, virement instantané, etc.)
        note:     { type: String,  default: "" },      // ex: "Scannez avec votre application bancaire"
      },
    },

    // ── Mise en avant (boost) ─────────────────────────────────────────────────
    // 0 = pas mis en avant, 1 = premier, 2 = deuxième, etc.
    boostPosition: { type: Number, default: 0 },

    // ── Notification "limite mensuelle de RDV atteinte" ───────────────────────
    // Stocke le mois ("YYYY-MM") où l'email d'alerte a déjà été envoyé à
    // l'admin, pour éviter de le renvoyer à chaque nouvelle réservation bloquée.
    limitReachedNotifiedMonth: { type: String, default: "" },

    // Distinct du précédent : marque le mois où on a déjà prévenu l'admin
    // qu'un CLIENT a essayé de réserver et s'est fait refuser (signal plus
    // urgent — perte de revenu concrète, pas juste "vous êtes plein").
    limitBlockedNotifiedMonth: { type: String, default: "" },

    // ── Regroupement des rendez-vous ──────────────────────────────────────────
    // Pour les indépendants qui démarrent avec peu de clients : évite qu'une
    // journée se retrouve "bloquée" par deux RDV isolés (ex: 9h et 18h) en
    // mettant en avant les créneaux proches d'un RDV déjà confirmé ce jour-là.
    // N'empêche jamais une réservation — uniquement une mise en avant côté
    // widget client (voir booking.controller.js#getBooking).
    smartGrouping: {
      enabled:     { type: Boolean, default: false },
      windowHours: { type: Number, default: 3 }, // fenêtre de regroupement autour d'un RDV existant
      // Jours de la semaine où le regroupement s'applique (0=dimanche…6=samedi,
      // cf. JS Date#getDay) — vide = tous les jours. Permet par ex. de ne
      // regrouper que le lundi/mardi si ce sont les jours les plus creux.
      weekdays:    { type: [Number], default: [] },
    },

    // ── Délai minimum de réservation ──────────────────────────────────────────
    // Empêche un client de réserver un créneau trop proche dans le temps
    // (ex: à 11h59 pour un RDV à 12h) si le pro a besoin de temps pour se
    // préparer. Stocké en minutes pour rester simple côté backend — l'admin
    // choisit la valeur + l'unité (minutes/heures/jours) côté UI.
    minBookingLeadTime: {
      enabled: { type: Boolean, default: false },
      minutes: { type: Number, default: 60 },
    },

    // ── Question préalable au choix du service ────────────────────────────────
    // Ex: "Est-ce la première fois que vous nous consultez ?" → 2 réponses
    // fixes (nouveau / déjà venu), dont le libellé exact reste personnalisable.
    // Posée AVANT l'étape "Service" sur la page de réservation publique ;
    // chaque service peut être limité à l'une des deux réponses
    // (Service.answerVisibility) — "all" (par défaut) = toujours affiché.
    bookingQuestion: {
      enabled:       { type: Boolean, default: false },
      question:      { type: String, default: "Est-ce la première fois que vous nous consultez ?" },
      newLabel:      { type: String, default: "Oui, je suis nouveau" },
      existingLabel: { type: String, default: "Non, j'ai déjà consulté" },
    },

    // ── Questionnaire de réservation (nouvelle version, multi-questions) ──────
    // Remplace `bookingQuestion` (une seule question oui/non) : une liste de
    // questions, chacune avec ses propres réponses. Chaque question et chaque
    // réponse a un _id stable, référencé par Service.questionRules pour cibler
    // les services selon les réponses du client. L'ancien `bookingQuestion` est
    // conservé pour la migration (cf. migrateQuestionnaire).
    serviceQuestionnaire: {
      enabled:   { type: Boolean, default: false },
      questions: [
        {
          question: { type: String, default: "", trim: true },
          options:  [{ label: { type: String, default: "", trim: true } }],
        },
      ],
    },
  },
  { timestamps: true },
);

const Company = mongoose.model("Company", companySchema);

module.exports = Company;
