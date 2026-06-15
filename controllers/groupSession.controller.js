const Booking  = require("../db/models/book.model");
const Service  = require("../db/models/company/service.model");

// ── Liste des sessions collectives à venir, avec nombre de participants ────
exports.listGroupSessions = async (req, res) => {
  const currentCompany = res.locals.currentCompany;
  if (!currentCompany) {
    return res.redirect("/register");
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const sessions = await Booking.aggregate([
    {
      $match: {
        company: currentCompany._id,
        isGroup: true,
        status: "confirmed",
        date: { $gte: startOfToday },
      },
    },
    {
      $group: {
        _id: { service: "$service", date: "$date", startTime: "$startTime" },
        count: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: "services",
        localField: "_id.service",
        foreignField: "_id",
        as: "service",
      },
    },
    { $unwind: "$service" },
    {
      $project: {
        _id: 0,
        serviceId: "$_id.service",
        serviceName: "$service.name",
        capacity: "$service.capacity",
        date: "$_id.date",
        startTime: "$_id.startTime",
        count: 1,
      },
    },
    { $sort: { date: 1, startTime: 1 } },
  ]);

  res.render("admin/group-sessions", {
    pageName: "GroupSessions",
    title: "Cours collectifs",
    sessions,
  });
};

// ── Liste des participants d'une session donnée (pour la modale admin) ─────
exports.getSessionParticipants = async (req, res) => {
  const currentCompany = res.locals.currentCompany;
  if (!currentCompany) {
    return res.status(401).json({ success: false, error: "unauthorized" });
  }

  const { serviceId, date, startTime } = req.query;
  if (!serviceId || !date || !startTime) {
    return res.status(400).json({ success: false, error: "missing_params" });
  }

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const bookings = await Booking.find({
    company: currentCompany._id,
    service: serviceId,
    startTime,
    status: "confirmed",
    isGroup: true,
    date: { $gte: dayStart, $lt: dayEnd },
  })
    .select("name surname email phone formAnswers")
    .lean();

  res.json({ success: true, participants: bookings });
};
