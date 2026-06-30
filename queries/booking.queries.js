const Booking = require("../db/models/book.model");

exports.getAppointments = () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return Booking.find({ date: { $gte: today } }).sort({ date: 1 });
};

exports.GetAllAppointments = async (companyId, employeeFilter) => {
  const query = {
    company: companyId,
    status: { $ne: "canceled" },
  };

  // "all" or empty → no filter; anything else → filter by employee id
  if (employeeFilter && employeeFilter !== "all") {
    query.employee = employeeFilter;
  }

  return await Booking.find(query)
    .populate("employee", "fullName profilePicture")
    .sort({ date: 1, startTime: 1 });
};
