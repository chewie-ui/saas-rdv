// ── API mobile : agenda / réservations ────────────────────────────────────
//   GET /api/v1/bookings?date=YYYY-MM-DD[&employee=<userId>]  → RDV du jour
//   GET /api/v1/bookings/upcoming?limit=20                    → prochains RDV
//   GET /api/v1/bookings/:id                                  → détail
const { dayRange, rangeBounds, serializeBooking, Booking } = require("./_helpers");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Identifiant Mongo mal formé → CastError → 500 inutile. On répond proprement.
const OBJECT_ID = /^[a-f0-9]{24}$/i;

// GET /api/v1/bookings — RDV d'un jour (`?date=`) ou d'une plage (`?from=&to=`,
// bornes incluses) pour la vue semaine. Inclut les blocs d'indisponibilité
// (comme le calendrier admin) ; exclut les annulations.
exports.dayAgenda = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;

    const { from, to } = req.query;
    const isRange = ISO_DATE.test(String(from || "")) && ISO_DATE.test(String(to || ""));
    const { start, end } = isRange ? rangeBounds(String(from), String(to)) : dayRange(req.query.date);

    const query = {
      company: companyId,
      status: { $ne: "canceled" },
      date: { $gte: start, $lt: end },
    };
    if (req.query.employee && req.query.employee !== "all") {
      if (!OBJECT_ID.test(String(req.query.employee))) {
        return res.status(400).json({ error: "invalid_id", message: "Praticien invalide." });
      }
      query.employee = req.query.employee;
    }

    const bookings = await Booking.find(query)
      // Sur une plage, trier d'abord par date : la vue semaine s'appuie dessus.
      .sort(isRange ? { date: 1, startTime: 1 } : { startTime: 1 })
      .populate("employee", "fullName profilePicture")
      .populate("clientRef", "fullName email profilePicture")
      .lean();

    res.json({
      ...(isRange
        ? { from: String(from), to: String(to) }
        : { date: req.query.date || new Date().toISOString().slice(0, 10) }),
      count: bookings.filter((b) => !b.isBlock).length,
      bookings: bookings.map(serializeBooking),
    });
  } catch (err) {
    console.error("[mobile dayAgenda]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// GET /api/v1/bookings/upcoming — prochains RDV confirmés à partir de maintenant.
exports.upcoming = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    const bookings = await Booking.find({
      company: companyId,
      status: "confirmed",
      isBlock: { $ne: true },
      date: { $gte: todayStart },
    })
      .sort({ date: 1, startTime: 1 })
      .limit(limit)
      .populate("employee", "fullName profilePicture")
      .populate("clientRef", "fullName email profilePicture")
      .lean();

    res.json({ bookings: bookings.map(serializeBooking) });
  } catch (err) {
    console.error("[mobile upcoming]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// GET /api/v1/bookings/:id — détail d'un RDV (scopé à l'établissement actif).
exports.detail = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    if (!OBJECT_ID.test(String(req.params.id))) {
      return res.status(404).json({ error: "not_found", message: "RDV introuvable." });
    }
    const booking = await Booking.findOne({ _id: req.params.id, company: companyId })
      .populate("employee", "fullName profilePicture")
      .populate("clientRef", "fullName email profilePicture phone")
      .lean();
    if (!booking) return res.status(404).json({ error: "not_found", message: "RDV introuvable." });

    const out = serializeBooking(booking);
    out.formAnswers = (booking.formAnswers || []).map((a) => ({ question: a.question, answer: a.answer }));
    res.json({ booking: out });
  } catch (err) {
    console.error("[mobile booking detail]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
