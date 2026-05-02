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
      required: true,
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
