const Booking  = require("../db/models/book.model");
const Service  = require("../db/models/company/service.model");
const Employee = require("../db/models/company/employee.model");
const { getLimit } = require("../utils/planLimits");
const { nextAvailableColor } = require("../utils/serviceColors");

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function sanitizeWeekdays(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(Number).filter((d) => WEEKDAYS.includes(d)))].sort();
}

// Garde-fou anti-abus (pas une limite de plan) — un cours en dates ponctuelles
// n'a aucune raison dépasser ça en usage réel.
const MAX_SESSIONS = 200;

// ── Dates ponctuelles ("ateliers") : valide chaque {date,startTime,endTime} ──
// Retourne null si la liste est invalide (rejet complet — on ne sauvegarde
// jamais une liste partiellement valide, sinon l'admin perd silencieusement
// des dates qu'il pensait avoir ajoutées).
function sanitizeSessions(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const s of raw) {
    if (!s || !TIME_RE.test(s.startTime || "") || !TIME_RE.test(s.endTime || "")) return null;
    if (s.startTime === s.endTime) return null;
    const d = new Date(s.date);
    if (isNaN(d.getTime())) return null;
    out.push({ date: d, startTime: s.startTime, endTime: s.endTime });
  }
  return out
    .slice(0, MAX_SESSIONS)
    .sort((a, b) => a.date - b.date || a.startTime.localeCompare(b.startTime));
}

// ── Page admin : cours définis + sessions à venir avec participants ────────
exports.listGroupSessions = async (req, res) => {
  const currentCompany = res.locals.currentCompany;
  if (!currentCompany) {
    return res.redirect("/register");
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [courses, employees, sessions] = await Promise.all([
    // Pas de filtre "recurring.enabled" : remonte aussi les cours en mode
    // "dates ponctuelles" (recurring.enabled === false + sessions[]), ainsi
    // que tout service "group" orphelin créé sans planning depuis la page
    // Services générique — il devient ainsi complétable depuis cette page.
    Service.find({ company: currentCompany._id, type: "group" })
      .populate("employees", "firstName lastName profilePicture")
      .sort("-createdAt")
      .lean(),
    Employee.find({ company: currentCompany._id, active: true })
      .select("firstName lastName profilePicture")
      .lean(),
    Booking.aggregate([
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
    ]),
  ]);

  const maxServices = getLimit("services", req.user);

  res.render("admin/group-sessions", {
    pageName: "GroupSessions",
    title: "Cours collectifs",
    courses,
    employees,
    sessions,
    maxServices,
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

// ── API : créer un cours collectif (= un Service type "group" récurrent) ───
exports.createCourse = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const maxServices = getLimit("services", req.user);

    if (maxServices === 0) {
      return res.status(403).json({ error: "plan_limit", message: "Votre plan ne permet pas de créer des cours." });
    }
    const count = await Service.countDocuments({ company: companyId });
    if (count >= maxServices) {
      return res.status(403).json({ error: "plan_limit", message: `Limite de ${maxServices} services/cours atteinte.` });
    }

    const { name, description, price, duration, capacity, weekdays, startTime, employees, mode, sessions, location } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Le nom du cours est requis." });
    }

    // ── Mode de planification : "fixed" (dates ponctuelles) ou "recurring"
    // (hebdomadaire fixe, comportement historique — par défaut si absent). ──
    let recurringField, sessionsField;
    if (mode === "fixed") {
      const sanitizedSessions = sanitizeSessions(sessions);
      if (!sanitizedSessions || sanitizedSessions.length === 0) {
        return res.status(400).json({ error: "Ajoutez au moins une date." });
      }
      recurringField = { enabled: false, weekdays: [], startTime: "" };
      sessionsField = sanitizedSessions;
    } else {
      const sanitizedWeekdays = sanitizeWeekdays(weekdays);
      if (sanitizedWeekdays.length === 0) {
        return res.status(400).json({ error: "Choisissez au moins un jour de la semaine." });
      }
      if (!TIME_RE.test(startTime || "")) {
        return res.status(400).json({ error: "Heure invalide." });
      }
      recurringField = { enabled: true, weekdays: sanitizedWeekdays, startTime };
      sessionsField = [];
    }

    const existingColors = (await Service.find({ company: companyId }).select("color").lean())
      .map((s) => s.color).filter(Boolean);

    const course = await Service.create({
      company: companyId,
      name: name.trim(),
      description: (description || "").trim(),
      price: price !== undefined && price !== "" ? Number(price) : null,
      duration: duration ? Math.max(5, Number(duration)) : 60,
      order: count,
      type: "group",
      capacity: Math.max(1, Math.min(500, Number(capacity) || 1)),
      color: nextAvailableColor(existingColors),
      employees: Array.isArray(employees) ? employees : [],
      recurring: recurringField,
      sessions: sessionsField,
      location: (location || "").trim(),
    });

    const populated = await Service.findById(course._id).populate("employees", "firstName lastName profilePicture").lean();
    res.json({ success: true, course: populated });
  } catch (err) {
    console.error("createCourse error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── API : modifier un cours collectif ───────────────────────────────────────
exports.updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, duration, capacity, weekdays, startTime, employees, active, mode, sessions, location } = req.body;

    const update = {};
    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: "Le nom du cours est requis." });
      update.name = name.trim();
    }
    if (description !== undefined) update.description = description.trim();
    if (price !== undefined) update.price = price !== "" ? Number(price) : null;
    if (duration !== undefined) update.duration = Math.max(5, Number(duration) || 60);
    if (capacity !== undefined) update.capacity = Math.max(1, Math.min(500, Number(capacity) || 1));
    if (employees !== undefined) update.employees = Array.isArray(employees) ? employees : [];
    if (active !== undefined) update.active = !!active;
    if (location !== undefined) update.location = (location || "").trim();

    // ── Planning : l'UI envoie systématiquement "mode" à chaque sauvegarde
    // (création ET édition) — on bascule toujours PLEINEMENT d'un mode à
    // l'autre en nettoyant les données de l'ancien mode. Sans ça, repasser un
    // cours de "ponctuel" à "récurrent" laisserait des `sessions` fantômes
    // (toujours comptées par l'API de réservation), et inversement des
    // `weekdays` fantômes qui rebloqueraient des jours pour les employés. ──
    if (mode === "fixed") {
      const sanitizedSessions = sanitizeSessions(sessions);
      if (!sanitizedSessions || sanitizedSessions.length === 0) {
        return res.status(400).json({ error: "Ajoutez au moins une date." });
      }
      update.sessions = sanitizedSessions;
      update.recurring = { enabled: false, weekdays: [], startTime: "" };
    } else if (mode === "recurring" || weekdays !== undefined || startTime !== undefined) {
      const course = await Service.findOne({ _id: id, company: res.locals.currentCompany._id }).select("recurring").lean();
      if (!course) return res.status(404).json({ error: "Cours non trouvé." });

      const sanitizedWeekdays = weekdays !== undefined ? sanitizeWeekdays(weekdays) : (course.recurring?.weekdays || []);
      if (sanitizedWeekdays.length === 0) {
        return res.status(400).json({ error: "Choisissez au moins un jour de la semaine." });
      }
      const resolvedStartTime = startTime !== undefined ? startTime : course.recurring?.startTime;
      if (!TIME_RE.test(resolvedStartTime || "")) {
        return res.status(400).json({ error: "Heure invalide." });
      }
      update.recurring = { enabled: true, weekdays: sanitizedWeekdays, startTime: resolvedStartTime };
      update.sessions = [];
    }

    const course = await Service.findOneAndUpdate(
      { _id: id, company: res.locals.currentCompany._id, type: "group" },
      update,
      { new: true }
    ).populate("employees", "firstName lastName profilePicture");

    if (!course) return res.status(404).json({ error: "Cours non trouvé." });
    res.json({ success: true, course });
  } catch (err) {
    console.error("updateCourse error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── API : activer / désactiver un cours ─────────────────────────────────────
exports.toggleCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const course = await Service.findOne({ _id: id, company: res.locals.currentCompany._id, type: "group" });
    if (!course) return res.status(404).json({ error: "Cours non trouvé." });
    course.active = !course.active;
    await course.save();
    res.json({ success: true, active: course.active });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── API : supprimer un cours collectif ──────────────────────────────────────
exports.deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;
    await Service.findOneAndDelete({ _id: id, company: res.locals.currentCompany._id, type: "group" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur." });
  }
};
