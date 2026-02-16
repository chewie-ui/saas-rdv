const Booking = require("../db/models/book.model");

exports.getAppointments = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  console.log(today);

  return Booking.find({ date: { $gte: today } }).sort({
    date: 1,
  });
};

exports.GetAllAppointments = () => {
  return Booking.find({});
};
