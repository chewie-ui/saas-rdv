const Booking = require("../db/models/book.model");

exports.createBooking = async (req, res) => {
  try {
    const { date, time } = req.body;

    await Booking.create({
      date: new Date(date),
      time,
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: "this booking is unavailable" });
  }
};

exports.getBooking = async (req, res) => {
  const { date } = req.query;

  const bookings = await Booking.find({
    date: new Date(date),
  }).select("time -_id");

  res.json({
    bookedTimes: bookings.map((b) => b.time),
  });
};
