const mongoose = require("mongoose");
const schema = mongoose.Schema;

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
    time: {
      type: String,
      required: true,
    },
  },
  { timestamps: true },
);

bookingSchema.index({ date: 1, time: 1 }, { unique: true });

const Booking = mongoose.model("Booking", bookingSchema);

module.exports = Booking;
