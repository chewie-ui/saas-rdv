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
        enum: ["basic", "pro"],
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

    isPremium: {
      type: Boolean,
      default: false,
    },

    manualPremium: {
      type: Boolean,
      default: false,
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
    },

    googleCalendar: {
      connected: { type: Boolean, default: false },
      email: { type: String, default: "" },
      refreshToken: { type: String, default: "" },
      accessToken: { type: String, default: "" },
      scope: { type: String, default: "" },
      tokenType: { type: String, default: "" },
    },
  },

  { timestamps: true },
);

const User = mongoose.model("User", userSchema);

module.exports = User;
