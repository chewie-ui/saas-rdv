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
    companies: [
      {
        role: {
          type: String,
          enum: ["owner", "employee"],
          required: true,
        },
        company: {
          type: schema.Types.ObjectId,
          required: true,
          ref: "Company",
        },
        status: {
          type: String,
          enum: ["fired", "active"],
          default: "active",
        },
      },
    ],

    profilePicture: {
      type: String,
      default: "/images/no-user.webp",
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

    website: {
      type: String,
    },
  },
  { timestamps: true },
);

const User = mongoose.model("User", userSchema);

module.exports = User;
