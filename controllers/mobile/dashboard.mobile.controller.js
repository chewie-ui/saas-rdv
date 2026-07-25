// ── API mobile : tableau de bord ──────────────────────────────────────────
//   GET /api/v1/dashboard  → stats du jour/mois + RDV du jour + prochains
// Reprend les mêmes agrégations que le dashboard web (admin.controller.js
// exports.panel) : bornes en heure locale serveur, base { company, isBlock:
// { $ne: true } } — les blocs d'indisponibilité ne comptent jamais.
const { serializeBooking, Booking } = require("./_helpers");

exports.dashboard = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 86400000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const base = { company: companyId, isBlock: { $ne: true } };

    const [
      todayConfirmed,
      monthConfirmed,
      lastMonthConfirmed,
      monthCanceled,
      todayBookings,
      upcoming,
      activeClients,
      revenueAgg,
    ] = await Promise.all([
      Booking.countDocuments({ ...base, status: "confirmed", date: { $gte: todayStart, $lt: todayEnd } }),
      Booking.countDocuments({ ...base, status: "confirmed", date: { $gte: monthStart } }),
      Booking.countDocuments({ ...base, status: "confirmed", date: { $gte: lastMonthStart, $lt: monthStart } }),
      Booking.countDocuments({ ...base, status: "canceled", date: { $gte: monthStart } }),
      Booking.find({ ...base, status: { $ne: "canceled" }, date: { $gte: todayStart, $lt: todayEnd } })
        .sort({ startTime: 1 })
        .populate("employee", "fullName profilePicture")
        .populate("clientRef", "fullName email profilePicture")
        .lean(),
      Booking.find({ ...base, status: "confirmed", date: { $gte: todayEnd } })
        .sort({ date: 1, startTime: 1 })
        .limit(5)
        .populate("employee", "fullName profilePicture")
        .populate("clientRef", "fullName email profilePicture")
        .lean(),
      Booking.distinct("clientRef", {
        ...base,
        status: "confirmed",
        date: { $gte: monthStart },
        clientRef: { $ne: null },
      }),
      // CA encaissé ce mois (paiements réellement capturés/prélevés).
      //
      // `payment.amount` est le prix TOTAL de la prestation : en cas de
      // pénalité seul `penaltyAmount` a été encaissé, en remboursement partiel
      // seul `keptAmount`. Sommer `amount` dans ces deux cas surévaluait le
      // chiffre d'affaires (3 no-shows facturés 50 % sur 80 € annonçaient
      // 240 € au lieu de 120 €). La borne haute évite en plus qu'un RDV déjà
      // payé pour un mois futur ne gonfle le total du mois courant.
      Booking.aggregate([
        {
          $match: {
            ...base,
            date: { $gte: monthStart, $lt: nextMonthStart },
            "payment.status": { $in: ["paid", "penalty", "partial"] },
          },
        },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $switch: {
                  branches: [
                    {
                      case: { $eq: ["$payment.status", "penalty"] },
                      then: { $ifNull: ["$payment.penaltyAmount", 0] },
                    },
                    {
                      case: { $eq: ["$payment.status", "partial"] },
                      then: { $ifNull: ["$payment.keptAmount", 0] },
                    },
                  ],
                  default: { $ifNull: ["$payment.amount", 0] },
                },
              },
            },
          },
        },
      ]),
    ]);

    const pctDelta = (cur, prev) => {
      if (!prev) return cur ? 100 : 0;
      return Math.round(((cur - prev) / prev) * 100);
    };

    res.json({
      company: {
        id: String(companyId),
        // Jamais `req.mobileUser.businessName` : un collaborateur verrait le
        // nom de sa propre activité au lieu de celui de l'établissement.
        name: req.companyCtx.currentCompany.name || "Établissement",
        role: req.companyCtx.role,
        isOwner: req.companyCtx.isOwner,
      },
      stats: {
        todayCount: todayConfirmed,
        monthCount: monthConfirmed,
        monthDeltaPct: pctDelta(monthConfirmed, lastMonthConfirmed),
        monthCanceled,
        activeClients: activeClients.length,
        monthRevenue: revenueAgg[0]?.total || 0,
      },
      todayBookings: todayBookings.map(serializeBooking),
      upcoming: upcoming.map(serializeBooking),
    });
  } catch (err) {
    console.error("[mobile dashboard]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
