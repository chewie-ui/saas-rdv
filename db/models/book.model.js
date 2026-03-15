const mongoose = require("mongoose");
const schema = mongoose.Schema;
const crypto = require("crypto");

const bookingSchema = new schema(
  {
    user: {
      type: schema.Types.ObjectId,
      ref: "User",
      required: false,
    },

    surname: String,
    name: String,
    email: String,
    phone: String,
    message: String,

    company: {
      type: schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    date: {
      type: Date,
      required: true,
    },
    startTime: {
      type: String,
      required: true,
    },

    endTime: {
      type: String,
      required: true,
    },

    slotTime: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["canceled", "confirmed"],
      required: true,
    },

    cancelToken: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(32).toString("hex"),
    },
  },
  { timestamps: true },
);

bookingSchema.index({ date: 1, startTime: 1 }, { unique: true });

const Booking = mongoose.model("Booking", bookingSchema);

module.exports = Booking;
