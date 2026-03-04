const Booking = require("../db/models/book.model");

exports.getAppointments = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Booking.find({ date: { $gte: today } }).sort({
    date: 1,
  });
};

exports.GetAllAppointments = async (companyId) => {
  return await Booking.find({ company: companyId });
};
