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
    company: {
      type: schema.Types.ObjectId,
      required: true,
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

    // Add-ons (purchased separately)
    addons: {
      customUrl: { type: Boolean, default: false },
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
      dayText:     { type: String,  default: '#111111' },
      btnBg:       { type: String,  default: '#111111' },
      btnText:     { type: String,  default: '#ffffff' },
      lang:        { type: String,  default: 'fr' },
      font:        { type: String,  default: 'Inter' },
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
    referral: {
      totalInvited:  { type: Number, default: 0 }, // nb de filleuls inscrits
      totalPaying:   { type: Number, default: 0 }, // nb de filleuls payants
      creditMonths:  { type: Number, default: 0 }, // mois gratuits gagnés (non encore utilisés)
    },

    // ── Notifications email ───────────────────────────────────────────────────
    notifications: {
      newBooking: { type: Boolean, default: true }, // recevoir un email à chaque nouvelle réservation
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
  },

  { timestamps: true },
);

const User = mongoose.model("User", userSchema);

module.exports = User;
