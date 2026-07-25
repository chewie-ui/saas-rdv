// ── API mobile : cours collectifs ─────────────────────────────────────────
//   GET    /group-sessions                              séances à venir + cours
//   GET    /group-sessions/:serviceId/participants      qui est inscrit
//   POST   /group-sessions/:serviceId/sessions          ajouter une date
//   DELETE /group-sessions/:serviceId/sessions/:index   retirer une date
//   PATCH  /group-sessions/:serviceId/recurring         régler la récurrence
//   PATCH  /group-sessions/participants/:id/remove      désinscrire quelqu'un
//
// Même modèle que le web (controllers/groupSession.controller.js + la liste
// publique booking.controller.js#getGroupSessions) : un « cours collectif »
// est un Service { type: "group" } planifié soit en récurrence hebdomadaire
// (recurring.weekdays + startTime), soit en dates ponctuelles (sessions[]).
// Il n'existe AUCUN document « séance » : les occurrences sont calculées ici,
// et les places occupées viennent des Booking confirmés sur (service, date,
// startTime).
const Booking = require("../../db/models/book.model");
const Service = require("../../db/models/company/service.model");
const { cancelBookingSideEffects } = require("./_helpers");
const { logActivity } = require("../../utils/activityLog");

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Mêmes garde-fous que le web (groupSession.controller.js).
const MAX_SESSIONS = 200;
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function sanitizeWeekdays(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(Number).filter((d) => WEEKDAYS.includes(d)))].sort((a, b) => a - b);
}

function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

// Les dates de séance sont stockées à minuit UTC (new Date("YYYY-MM-DD")) :
// leur journée se relit donc en UTC, jamais en heure locale du serveur.
function ymdUTC(date) {
  return new Date(date).toISOString().split("T")[0];
}

// Journée courante du serveur, en composants locaux — c'est déjà la référence
// utilisée par `list` pour décider ce qui est « à venir ».
function todayYmd() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function sortSessions(list) {
  return list.sort(
    (a, b) => new Date(a.date) - new Date(b.date) || a.startTime.localeCompare(b.startTime),
  );
}

// Un cours tel que l'app le pilote : son planning complet, avec l'index de
// chaque date ponctuelle (il n'existe aucun identifiant de séance en base —
// c'est la position dans le tableau `sessions`, que l'on garde TOUJOURS trié
// pour que cet index soit reproductible d'une requête à l'autre).
function serializeCourse(c) {
  const today = todayYmd();
  return {
    serviceId: String(c._id),
    name: c.name || "Cours",
    color: c.color || null,
    active: c.active !== false,
    capacity: c.capacity || null,
    duration: c.duration || 60,
    recurring: {
      enabled: Boolean(c.recurring?.enabled),
      weekdays: [...(c.recurring?.weekdays || [])].sort((a, b) => a - b),
      startTime: c.recurring?.startTime || "",
    },
    sessions: (c.sessions || []).map((s, index) => ({
      index,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      past: ymdUTC(s.date) < today,
    })),
  };
}

// Charge un cours du SEUL établissement courant. Toute écriture passe par ici :
// un identifiant venu du client ne suffit jamais à désigner un document.
async function loadCourse(companyId, serviceId) {
  if (!OBJECT_ID.test(String(serviceId || ""))) return null;
  return Service.findOne({ _id: serviceId, company: companyId, type: "group" });
}

// Horizon de génération des occurrences récurrentes — mêmes valeurs que la
// liste publique (booking.controller.js), par cours.
const MAX_OCCURRENCES = 12;
const HORIZON_DAYS = 90;

function minutesToTimeStr(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// Clé de rapprochement occurrence ↔ réservations. Les dates de Booking d'un
// cours sont écrites avec new Date("YYYY-MM-DD") (minuit UTC) côté web comme
// côté mobile : la partie date de l'ISO est donc la bonne journée.
function occurrenceKey(serviceId, date, startTime) {
  return `${serviceId}|${new Date(date).toISOString().split("T")[0]}|${startTime}`;
}

// Occurrences futures d'un cours récurrent. Copie volontaire de
// booking.controller.js#generateRecurringOccurrences : le jour de semaine se
// calcule en heure locale (constructeur par composants), mais la date poussée
// repasse TOUJOURS par new Date("YYYY-MM-DD") = minuit UTC — sinon, sur un
// serveur en UTC+1/+2, la clé de comptage retombe sur la veille et aucune
// place occupée n'est retrouvée.
function generateRecurringOccurrences(recurring, duration) {
  const out = [];
  const now = new Date();
  const [h, m] = (recurring.startTime || "00:00").split(":").map(Number);
  const endTime = minutesToTimeStr(h * 60 + m + (duration || 60));
  for (let i = 0; i < HORIZON_DAYS && out.length < MAX_OCCURRENCES; i++) {
    const probe = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if ((recurring.weekdays || []).includes(probe.getDay())) {
      const ymd = `${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, "0")}-${String(probe.getDate()).padStart(2, "0")}`;
      out.push({ date: new Date(ymd), startTime: recurring.startTime, endTime });
    }
  }
  return out;
}

// GET /api/v1/group-sessions
exports.list = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;

    // Pas de filtre recurring.enabled ni active : on remonte aussi les cours
    // en dates ponctuelles et les cours désactivés (leurs inscrits existent
    // toujours) — l'app les signale au lieu de les faire disparaître.
    const courses = await Service.find({ company: companyId, type: "group" })
      .select("name color capacity duration active location recurring sessions employees")
      .populate("employees", "fullName")
      .lean();

    // `courses` accompagne toujours les séances : sans lui, un cours dont
    // toutes les dates sont passées (ou qui n'en a aucune) serait invisible
    // dans l'app, donc impossible à replanifier. Champ ajouté, jamais
    // substitué : `sessions` garde exactement la même forme qu'avant.
    const courseList = courses.map(serializeCourse);

    if (!courses.length) return res.json({ count: 0, sessions: [], courses: [] });

    // Journée en cours incluse : un cours du matin reste utile à l'admin
    // jusqu'au soir (il veut voir qui vient aujourd'hui).
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const occurrences = [];
    for (const c of courses) {
      const list = c.recurring?.enabled
        ? generateRecurringOccurrences(c.recurring, c.duration)
        : (c.sessions || [])
            .filter((s) => new Date(s.date) >= startOfToday)
            .map((s) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime }));

      for (const o of list) {
        occurrences.push({
          course: c,
          date: o.date,
          startTime: o.startTime,
          endTime: o.endTime,
        });
      }
    }

    if (!occurrences.length) return res.json({ count: 0, sessions: [], courses: courseList });

    // Un seul passage en base pour toutes les occurrences : on compte ensuite
    // en mémoire (volume négligeable pour un établissement).
    const minDate = new Date(Math.min(...occurrences.map((o) => new Date(o.date).getTime())));
    const bookings = await Booking.find({
      company: companyId,
      service: { $in: courses.map((c) => c._id) },
      status: "confirmed",
      date: { $gte: minDate },
    })
      .select("service date startTime")
      .lean();

    const counts = new Map();
    bookings.forEach((b) => {
      const key = occurrenceKey(b.service, b.date, b.startTime);
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const sessions = occurrences
      .map((o) => {
        const capacity = o.course.capacity || null;
        const booked = counts.get(occurrenceKey(o.course._id, o.date, o.startTime)) || 0;
        const remaining = capacity !== null ? Math.max(0, capacity - booked) : null;
        return {
          serviceId: String(o.course._id),
          serviceName: o.course.name || "Cours",
          serviceColor: o.course.color || null,
          serviceActive: o.course.active !== false,
          recurring: Boolean(o.course.recurring?.enabled),
          location: o.course.location || "",
          employeeNames: (o.course.employees || []).map((e) => e.fullName).filter(Boolean),
          date: o.date,
          startTime: o.startTime,
          endTime: o.endTime,
          capacity,
          booked,
          remaining,
          full: capacity !== null && remaining === 0,
        };
      })
      .sort(
        (a, b) =>
          new Date(a.date) - new Date(b.date) ||
          a.startTime.localeCompare(b.startTime) ||
          a.serviceName.localeCompare(b.serviceName),
      );

    res.json({ count: sessions.length, sessions, courses: courseList });
  } catch (err) {
    console.error("[mobile group sessions list]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// GET /api/v1/group-sessions/:serviceId/participants?date=&startTime=
exports.participants = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const { serviceId } = req.params;
    const { date, startTime } = req.query;

    if (!OBJECT_ID.test(serviceId || "")) {
      return res.status(404).json({ error: "not_found", message: "Cours introuvable." });
    }
    if (!date || !TIME_RE.test(String(startTime || ""))) {
      return res.status(400).json({ error: "missing_params", message: "Date ou heure manquante." });
    }
    const parsed = new Date(String(date));
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: "bad_date", message: "Date invalide." });
    }

    const course = await Service.findOne({ _id: serviceId, company: companyId, type: "group" })
      .select("name color capacity")
      .lean();
    if (!course) {
      return res.status(404).json({ error: "not_found", message: "Cours introuvable." });
    }

    // Même fenêtre que le web (groupSession.controller#getSessionParticipants) :
    // la journée locale qui contient l'instant stocké.
    const dayStart = new Date(parsed);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const bookings = await Booking.find({
      company: companyId,
      service: serviceId,
      startTime: String(startTime),
      status: "confirmed",
      date: { $gte: dayStart, $lt: dayEnd },
    })
      .select("name surname email phone")
      .sort({ createdAt: 1 })
      .lean();

    const participants = bookings.map((b) => ({
      bookingId: String(b._id),
      fullName: `${b.name || ""} ${b.surname || ""}`.trim() || b.email || "Participant",
      email: b.email || "",
      phone: b.phone || "",
    }));

    res.json({
      serviceName: course.name || "Cours",
      capacity: course.capacity || null,
      count: participants.length,
      participants,
    });
  } catch (err) {
    console.error("[mobile group session participants]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── POST /api/v1/group-sessions/:serviceId/sessions ───────────────────────
// Ajoute une date ponctuelle (« atelier ») au cours. Mêmes règles que le web
// (groupSession.controller#sanitizeSessions) : heures "HH:MM", fin après le
// début, date relue à minuit UTC, tableau maintenu trié et plafonné.
exports.addSession = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const date = String(req.body.date || "");
    const startTime = String(req.body.startTime || "");
    const endTime = String(req.body.endTime || "");

    if (!ISO_DATE.test(date)) {
      return res.status(400).json({ error: "invalid_date", message: "Date attendue au format AAAA-MM-JJ." });
    }
    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) {
      return res.status(400).json({ error: "invalid_time", message: "Heures attendues au format 09:00." });
    }
    if (hhmmToMinutes(endTime) <= hhmmToMinutes(startTime)) {
      return res.status(400).json({ error: "invalid_range", message: "L'heure de fin doit être après l'heure de début." });
    }
    // new Date("YYYY-MM-DD") = minuit UTC, comme partout ailleurs. Un
    // constructeur par composants décalerait la séance d'un jour dès qu'on
    // relit la date en UTC (le comptage des places la manquerait).
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: "invalid_date", message: "Date invalide." });
    }

    const course = await loadCourse(companyId, req.params.serviceId);
    if (!course) return res.status(404).json({ error: "not_found", message: "Cours introuvable." });

    // Un cours récurrent ignore purement et simplement `sessions` à la lecture
    // (côté app comme côté réservation) : accepter la date donnerait
    // l'illusion d'une séance planifiée qui n'existerait jamais.
    if (course.recurring?.enabled) {
      return res.status(409).json({
        error: "recurring_mode",
        message: "Ce cours suit un rythme hebdomadaire. Désactivez la récurrence pour ajouter des dates.",
      });
    }
    if ((course.sessions || []).length >= MAX_SESSIONS) {
      return res.status(400).json({ error: "too_many_sessions", message: `Ce cours a déjà ${MAX_SESSIONS} dates.` });
    }
    const exists = (course.sessions || []).some(
      (s) => ymdUTC(s.date) === date && s.startTime === startTime,
    );
    if (exists) {
      return res.status(409).json({ error: "duplicate_session", message: "Cette séance est déjà planifiée." });
    }

    course.sessions.push({ date: parsed, startTime, endTime });
    sortSessions(course.sessions);
    await course.save();

    logActivity({
      company: companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "groupSession.add",
      description: `a ajouté une séance de ${course.name || "cours"} le ${date} à ${startTime}`,
    });

    res.status(201).json({ course: serializeCourse(course.toObject()) });
  } catch (err) {
    console.error("[mobile group session add]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── DELETE /api/v1/group-sessions/:serviceId/sessions/:index ──────────────
// Retire une date ponctuelle. Les réservations déjà prises sur cette date ne
// sont PAS annulées (même comportement que le web, où l'admin réédite la liste
// des dates) : elles restent visibles dans l'agenda, à traiter une par une.
exports.removeSession = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) {
      return res.status(400).json({ error: "invalid_index", message: "Séance invalide." });
    }

    const course = await loadCourse(companyId, req.params.serviceId);
    if (!course) return res.status(404).json({ error: "not_found", message: "Cours introuvable." });
    if (index >= (course.sessions || []).length) {
      return res.status(404).json({ error: "session_not_found", message: "Cette séance n'existe plus." });
    }

    const [removed] = course.sessions.splice(index, 1);
    sortSessions(course.sessions);
    await course.save();

    logActivity({
      company: companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "groupSession.remove",
      description: `a supprimé la séance de ${course.name || "cours"} du ${ymdUTC(removed.date)} à ${removed.startTime}`,
    });

    res.json({ course: serializeCourse(course.toObject()) });
  } catch (err) {
    console.error("[mobile group session remove]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── PATCH /api/v1/group-sessions/:serviceId/recurring ─────────────────────
// Bascule le cours entre rythme hebdomadaire et dates ponctuelles. On nettoie
// TOUJOURS les données de l'autre mode, exactement comme le web
// (groupSession.controller#updateCourse) : sans ça, un cours repassé en
// récurrence garderait des dates fantômes toujours réservables, et
// inversement des `weekdays` qui continueraient de bloquer l'agenda.
exports.setRecurring = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const enabled = Boolean(req.body.enabled);

    const course = await loadCourse(companyId, req.params.serviceId);
    if (!course) return res.status(404).json({ error: "not_found", message: "Cours introuvable." });

    if (enabled) {
      const weekdays = sanitizeWeekdays(req.body.weekdays);
      if (!weekdays.length) {
        return res.status(400).json({ error: "no_weekday", message: "Choisissez au moins un jour de la semaine." });
      }
      const startTime = String(req.body.startTime || "");
      if (!TIME_RE.test(startTime)) {
        return res.status(400).json({ error: "invalid_time", message: "Heure attendue au format 09:00." });
      }
      course.recurring = { enabled: true, weekdays, startTime };
      course.sessions = [];
    } else {
      course.recurring = { enabled: false, weekdays: [], startTime: "" };
    }
    await course.save();

    logActivity({
      company: companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "groupSession.recurring",
      description: enabled
        ? `a réglé ${course.name || "un cours"} sur un rythme hebdomadaire à ${course.recurring.startTime}`
        : `a repassé ${course.name || "un cours"} en dates ponctuelles`,
    });

    res.json({ course: serializeCourse(course.toObject()) });
  } catch (err) {
    console.error("[mobile group session recurring]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── PATCH /api/v1/group-sessions/participants/:bookingId/remove ───────────
// Désinscrit un participant : c'est une annulation de sa réservation, avec
// exactement les mêmes effets que PATCH /bookings/:id/cancel (agenda Google,
// journal, email au client) — d'où l'helper partagé.
exports.removeParticipant = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const { bookingId } = req.params;
    if (!OBJECT_ID.test(String(bookingId || ""))) {
      return res.status(404).json({ error: "not_found", message: "Participant introuvable." });
    }

    // Filtre par établissement ET par nature : cette route ne doit jamais
    // servir à annuler un rendez-vous individuel (elle n'exige pas
    // `appointments.cancelDelete`). `status: "confirmed"` rend l'appel
    // idempotent — un double appui ne renvoie pas deux emails d'annulation.
    const booking = await Booking.findOneAndUpdate(
      { _id: bookingId, company: companyId, isGroup: true, status: "confirmed" },
      { status: "canceled" },
      { new: false },
    ).lean();
    if (!booking) {
      return res.status(404).json({ error: "not_found", message: "Participant introuvable." });
    }

    const who = `${booking.name || ""} ${booking.surname || ""}`.trim() || booking.email || "un participant";
    await cancelBookingSideEffects({
      booking,
      user: req.mobileUser,
      role: req.companyCtx.role,
      description: `a retiré ${who} du cours ${booking.serviceName || ""}`.trim(),
    });

    res.json({ ok: true, id: String(booking._id) });
  } catch (err) {
    console.error("[mobile group session remove participant]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
