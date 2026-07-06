const mongoose = require("mongoose");
const schema = mongoose.Schema;

const userSchema = schema(
  {
    fullName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: false,
    },

    googleId: {
      type: String,
      default: null,
    },
    // Intention déclarée à l'inscription — affichage seulement (quel CTA
    // montrer dans Paramètres), n'affecte jamais l'accès aux données. La
    // présence d'un Company doc (owner = ce User) reste l'unique source de
    // vérité pour "est-ce un compte pro" (cf. middlewares/injectCompany.js).
    accountIntent: {
      type: String,
      enum: ["pro", "client", "undecided"],
      default: "undecided",
    },
    // Optionnel depuis l'unification des comptes (pro ET client s'inscrivent
    // au même endroit) — un User peut exister sans établissement. Une fois
    // créé, ce champ n'est jamais réassigné à null (cf. plan "mettre en
    // pause" : on ne supprime jamais le Company, on le masque seulement).
    company: {
      type: schema.Types.ObjectId,
      required: false,
    },
    profilePicture: {
      type: String,
      default: "/images/no-user.webp",
    },

    description: {
      type: String,
      maxlength: [230, "La description ne peut pas dépasser 230 caractères."],
    },

    // ── « À propos » enrichi (mini éditeur : gras, italique, taille de texte) ──
    // Stocke un fragment HTML "sûr" (nettoyé côté serveur — voir sanitizeAboutHtml)
    // affiché tel quel dans la section "À propos" de la page publique.
    aboutHtml: {
      type: String,
      default: "",
      maxlength: [4000, "Le texte « À propos » ne peut pas dépasser 4000 caractères."],
    },

    phone: {
      type: String,
    },

    instagramLink: {
      type: String,
    },

    facebookLink: {
      type: String,
    },

    bio: String,
    location: String,
    calendarColor: String,

    whatsappLink: {
      type: String,
    },

    emailPro: String,
    phonePro: String,

    website: {
      type: String,
    },

    subscription: {
      plan: {
        type: String,
        enum: ["basic", "pro", "business"],
        default: "basic",
      },

      stripeCustomerId: String,

      stripeSubscriptionId: String,

      status: {
        type: String,
        enum: ["active", "inactive", "cancelled"],
        default: "inactive",
      },
    },

    // Add-ons récurrents (facturés en plus sur l'abonnement Stripe)
    addons: {
      customUrl: { type: Boolean, default: false },
      extraCollaboratorSeats: { type: Number, default: 0 }, // +1 collaborateur / siège
    },

    // Rappels SMS — solde prépayé (en centimes) consommé au-delà du quota inclus
    // du plan. Rechargeable manuellement, avec recharge automatique optionnelle.
    smsBalanceCents: { type: Number, default: 0 },
    // Sessions de recharge déjà créditées (idempotence webhook ↔ page de retour).
    smsTopupSessions: { type: [String], default: [] },
    smsAutoRecharge: {
      enabled:       { type: Boolean, default: false },
      thresholdCents:{ type: Number, default: 500 },  // recharge quand solde < 5€
      amountCents:   { type: Number, default: 2000 }, // recharge de 20€
      inProgress:    { type: Boolean, default: false }, // verrou anti-double-recharge
      lastFailureAt: { type: Date },                    // dernière recharge auto échouée
    },
    // Compteur d'usage du mois courant (réinitialisé automatiquement au
    // changement de mois via la clé "YYYY-MM"). Sert au quota inclus du plan.
    smsUsage: {
      monthKey: { type: String, default: "" }, // "2026-07"
      count: { type: Number, default: 0 },
    },

    isPremium: {
      type: Boolean,
      default: false,
    },

    manualPremium: {
      type: Boolean,
      default: false,
    },

    manualPremiumExpiry: {
      type: Date,
      default: null,
    },

    location: {
      address: String,
      city: String,
      country: String,
      zip: Number,
      iframeUrl: String,
      lat: String,
      lon: String,
      serviceType: {
        type: String,
        enum: ["sur_place", "en_ligne"],
        default: "sur_place",
      },
    },

    businessType: {
      type: String,
      default: "",
    },

    businessPicture: {
      type: String,
      default: "",
    },

    businessName: {
      type: String,
      default: "",
    },

    calendarSettings: {
      pageBg:      { type: String,  default: '#f3f4f6' },
      calBg:       { type: String,  default: '#ffffff' },
      accentColor: { type: String,  default: '#22c55e' },
      accentText:  { type: String,  default: '#ffffff' },
      dayBg:       { type: String,  default: '#ffffff' },
      // ── Couleurs du calendrier selon la disponibilité du jour ────────────
      dayAvailableColor: { type: String, default: '#16a34a' }, // jour avec des créneaux libres
      dayBusyColor:      { type: String, default: '#ea580c' }, // jour bien rempli (≥50%)
      dayFullColor:      { type: String, default: '#ef4444' }, // jour complet / indisponible
      // ── États jour sélectionné / survol — vide = suit accentColor/accentText
      // (ou la teinte de dispo. en survol) automatiquement, sans rien stocker ──
      daySelectedBg:   { type: String, default: '' },
      daySelectedText: { type: String, default: '' },
      dayHoverBg:      { type: String, default: '' },
      btnHoverBg:      { type: String, default: '' }, // vide = juste un assombrissement (opacity)
      // ── Textes du parcours de réservation — vide = texte par défaut (FR) ──
      textCalendarHelp: { type: String, default: '' },
      textSlotHeading:  { type: String, default: '' },
      textTimezone:     { type: String, default: '' },
      lang:        { type: String,  default: 'fr' },
      font:         { type: String,  default: 'Inter' },
      customFontUrl:    { type: String, default: '' }, // URL d'une police perso (Google Fonts ou @font-face CSS) pour le calendrier
      customFontFamily: { type: String, default: '' }, // nom de la famille de police perso à appliquer au calendrier
      borderRadius: { type: String,  default: 'md'     }, // none | sm | md | lg
      borderStyle:  { type: String,  default: 'subtle' }, // none | subtle | medium | strong
      shadowStyle:  { type: String,  default: 'subtle' }, // none | subtle | medium | strong
      showInfo:       { type: Boolean, default: true },
      showSocials:    { type: Boolean, default: true },
      showEmailPro:   { type: Boolean, default: true },
      showPhonePro:   { type: Boolean, default: true },
      showInstagram:  { type: Boolean, default: true },
      showWhatsapp:   { type: Boolean, default: true },
      showFacebook:   { type: Boolean, default: true },
      showWebsite:    { type: Boolean, default: true },
      layoutStyle:    { type: String,  default: 'classic' },
      pageBgType:  { type: String,  default: 'color' },
      pageBgImage: { type: String,  default: '' },
      showSectionAbout:      { type: Boolean, default: true  },
      showSectionServices:   { type: Boolean, default: false },
      showSectionTeam:       { type: Boolean, default: false },
      showSectionReviews:    { type: Boolean, default: false },
      showSectionAmenities:  { type: Boolean, default: false },
      showSectionFaq:        { type: Boolean, default: false },
      showSectionGallery:    { type: Boolean, default: false },
      // Format d'affichage de la galerie sur la page publique — l'utilisateur
      // peut choisir entre une grille classique ou un carrousel défilant
      galleryLayout:         { type: String,  default: 'grid' }, // 'grid' | 'carousel'
      showSectionMap:        { type: Boolean, default: true  },
      showSectionHours:      { type: Boolean, default: true  },
      // Ordre d'affichage des sections sur la page publique
      // "booking" est toujours premier (implicite, non stocké)
      sectionOrder: { type: [String], default: ['about', 'location', 'hours', 'gallery', 'reviews'] },
      // ── Rappels email ────────────────────────────────────────────────────
      reminderDelayHours: { type: Number, default: 24 }, // 6 | 12 | 24 | 48 | 72
      reminderMessage:    { type: String, default: '' }, // message perso affiché dans le rappel
      reminderPaymentMethods: { type: [String], default: [] }, // 'carte' | 'especes' | 'qr_code' | 'virement'
      reminderPaymentNote:    { type: String, default: '' }, // précisions libres sur le paiement (ex: lien QR code)
      // ── Rappels SMS (Pro & Business, quota mensuel puis email en repli) ────
      smsRemindersEnabled: { type: Boolean, default: false },
      // Au-delà du quota inclus : true = continuer en SMS en dépensant le solde
      // prépayé ; false (défaut) = passer à l'email, ne jamais dépenser le solde.
      smsAllowOverage: { type: Boolean, default: false },
      gallery:     { type: [String], default: [] },
      equipment:   { type: [String], default: [] },
      categories:  { type: [{ name: String, icon: { type: String, default: '' }, _id: false }], default: [] },
      bookingCategoryStyle: { type: String, default: 'pills' }, // 'pills' | 'accordion' | 'grid'
      amenities: {
        cleanliness: { type: [String], default: [] },
        comfort:     { type: [String], default: [] },
        practical:   { type: [String], default: [] },
      },
      faq:    { type: [mongoose.Schema.Types.Mixed], default: [] },
      badges: { type: [String], default: [] },

      // ── Intégration iframe ───────────────────────────────────────────────
      embedTitle:      { type: String, default: '' }, // titre affiché au-dessus du calendrier en mode embed
      embedFontUrl:    { type: String, default: '' }, // URL d'une police perso (Google Fonts ou @font-face CSS)
      embedFontFamily: { type: String, default: '' }, // nom de la famille de police à appliquer
    },

    // ── Parrainage ────────────────────────────────────────────────────────────
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
    },
    referredBy: {
      type: schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Empêche de compter un même filleul plusieurs fois dans totalPaying
    // (ex: désabonnement puis réabonnement ne doit pas re-déclencher le bonus).
    referralPaidCounted: {
      type: Boolean,
      default: false,
    },
    referral: {
      totalInvited:  { type: Number, default: 0 }, // nb de filleuls inscrits
      totalPaying:   { type: Number, default: 0 }, // nb de filleuls devenus payants (1ère fois)
      creditMonths:  { type: Number, default: 0 }, // mois gratuits déjà réclamés (déduits du calcul du solde disponible)
    },

    // ── Notifications email ───────────────────────────────────────────────────
    notifications: {
      newBooking:   { type: Boolean, default: true }, // recevoir un email à chaque nouvelle réservation
      cancellation: { type: Boolean, default: true }, // recevoir un email à chaque annulation
    },

    googleCalendar: {
      connected: { type: Boolean, default: false },
      email: { type: String, default: "" },
      refreshToken: { type: String, default: "" },
      accessToken: { type: String, default: "" },
      scope: { type: String, default: "" },
      tokenType: { type: String, default: "" },
    },

    preferredLang: {
      type: String,
      enum: ["fr", "en", "nl", "de", "es", "it"],
      default: "fr",
    },

    twoFA: {
      enabled:    { type: Boolean, default: false },
      secret:     { type: String,  default: "" },
      tempSecret: { type: String,  default: "" },
    },

    // Token secret pour le flux iCal d'abonnement agenda (webcal://)
    calendarFeedToken: {
      type: String,
      default: null,
    },

    // Compte désactivé par le superadmin (masqué de /search + URL bloquée)
    isDisabled: {
      type: Boolean,
      default: false,
    },
  },

  { timestamps: true },
);

const User = mongoose.model("User", userSchema);

module.exports = User;
