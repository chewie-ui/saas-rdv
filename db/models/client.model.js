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
      required: true,
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
    languages: {
      type: [String],
      default: [],
    },
    emailNotifications: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

const Client = mongoose.model("Client", clientSchema);
module.exports = Client;
