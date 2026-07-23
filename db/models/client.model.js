const mongoose = require("mongoose");
const schema = mongoose.Schema;

const clientSchema = schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
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
      default: "",
    },
    googleId: {
      type: String,
      default: "",
    },
    phone: {
      type: String,
      default: "",
    },
    profilePicture: {
      type: String,
      default: "/images/no-user.webp",
    },
    location: {
      type: String,
      default: "",
      trim: true,
    },
    // Infos personnelles (facultatives) — affichées dans l'espace client.
    birthDate: {
      type: String,
      default: "",
      trim: true,
    },
    gender: {
      type: String,
      default: "",
      trim: true,
    },
    address: {
      type: String,
      default: "",
      trim: true,
    },
    postalCode: {
      type: String,
      default: "",
      trim: true,
    },
    city: {
      type: String,
      default: "",
      trim: true,
    },
    country: {
      type: String,
      default: "",
      trim: true,
    },
    languages: {
      type: [String],
      default: [],
    },
    emailNotifications: {
      type: Boolean,
      default: true,
    },
    preferredLang: {
      type: String,
      enum: ["fr", "en", "nl", "de", "es", "it"],
      default: "fr",
    },
  },
  { timestamps: true },
);

const Client = mongoose.model("Client", clientSchema);
module.exports = Client;
