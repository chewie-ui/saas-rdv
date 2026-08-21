const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const Stripe = require("stripe");
const getServices = require("../utils/services");
const { getLimit, atLeast, billingUserFor } = require("../utils/planLimits");
const { getCoursesForDate, courseRange, courseRangesFor } = require("../utils/recurringCourses");
const { identityFor } = require("../utils/establishmentIdentity");
const { getBookableTeam } = require("../utils/bookableTeam");

const stripe = new Stripe(env.stripeSecretKey);

const { getAppointments, GetAllAppointments } = require("../queries/booking.queries");
const { sendEmail } = require("../utils/mailer");
const { isFeatureEnabled } = require("../middlewares/featureFlag");
const { getOnboardingStatus } = require("../utils/onboardingStatus");

exports.panel = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const now = new Date();
    const hour = now.getHours();
    const greeting = hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";

    // ── Bornes temporelles ────────────────────────────────────────────────────
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd   = new Date(todayStart.getTime() + 86400000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const weekStart  = new Date(todayStart);
    weekStart.setDate(todayStart.getDate() - ((todayStart.getDay() || 7) - 1));
    const last7Start = new Date(todayStart);
    last7Start.setDate(todayStart.getDate() - 6);

    const base = { company: companyId, isBlock: { $ne: true } };

    // ── Requêtes parallèles ───────────────────────────────────────────────────
    const [
      rdvMois, rdvMoisPrev,
      cancelMois, cancelMoisPrev,
      dailyCounts,
      todayAppts,
      upcomingAppts,
      recentLogs,
      recentBookings,
    ] = await Promise.all([
      // RDV confirmés ce mois
      Booking.countDocuments({ ...base, status: "confirmed", date: { $gte: monthStart } }),
      Booking.countDocuments({ ...base, status: "confirmed", date: { $gte: lastMonthStart, $lt: monthStart } }),
      // Annulations ce mois
      Booking.countDocuments({ ...base, status: "canceled", date: { $gte: monthStart } }),
      Booking.countDocuments({ ...base, status: "canceled", date: { $gte: lastMonthStart, $lt: monthStart } }),
      // Sparkline : RDV par jour sur 7 jours
      Booking.aggregate([
        { $match: { ...base, status: "confirmed", date: { $gte: last7Start } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: "Europe/Paris" } }, n: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      // Aujourd'hui
      Booking.find({ ...base, date: { $gte: todayStart, $lt: todayEnd } })
        .sort({ startTime: 1 })
        .populate("clientRef", "fullName email profilePicture")
        .lean(),
      // Prochains (hors aujourd'hui)
      Booking.find({ ...base, status: "confirmed", date: { $gte: todayEnd } })
        .sort({ date: 1, startTime: 1 })
        .limit(5)
        .populate("clientRef", "fullName email")
        .lean(),
      // Dernières activités
      require("../db/models/activityLog.model").find({ company: companyId })
        .sort({ createdAt: -1 })
        .limit(7)
        .lean(),
      // Derniers RDV créés
      Booking.find({ ...base })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("clientRef", "fullName email")
        .lean(),
    ]);

    // ── Clients uniques ce mois ───────────────────────────────────────────────
    const [clientsThisMonth, clientsLastMonth] = await Promise.all([
      Booking.distinct("clientRef", { ...base, status: "confirmed", date: { $gte: monthStart }, clientRef: { $ne: null } }),
      Booking.distinct("clientRef", { ...base, status: "confirmed", date: { $gte: lastMonthStart, $lt: monthStart }, clientRef: { $ne: null } }),
    ]);

    // ── Sparkline helper ──────────────────────────────────────────────────────
    function sparkPoints(counts) {
      const vals = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(todayStart);
        d.setDate(d.getDate() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        const found = counts.find((c) => c._id === key);
        vals.push(found ? found.n : 0);
      }
      const max = Math.max(...vals, 1);
      const pts = vals.map((v, i) => {
        const x = 6 + Math.round(i * 84 / 6);
        const y = 20 - Math.round((v / max) * 16);
        return `${x},${y}`;
      });
      return { pts: pts.join(" "), fillPts: `6,24 ${pts.join(" ")} 90,24` };
    }

    function pctDelta(cur, prev) {
      if (prev === 0 && cur === 0) return null;
      if (prev === 0) return { label: "Nouveau", positive: true };
      const p = Math.round(((cur - prev) / prev) * 100);
      return { label: `${p >= 0 ? "+" : ""}${p}%`, positive: p >= 0 };
    }

    const spark = sparkPoints(dailyCounts);

    const stats = [
      {
        key: "rdv", label: "RDV ce mois", icon: "calendar_month",
        value: rdvMois, delta: pctDelta(rdvMois, rdvMoisPrev),
        period: "vs mois dernier", pts: spark.pts, fillPts: spark.fillPts,
        color: "var(--accent)",
      },
      {
        key: "cancel", label: "Annulations", icon: "cancel",
        value: cancelMois, delta: pctDelta(cancelMois, cancelMoisPrev),
        period: "vs mois dernier", pts: spark.pts, fillPts: spark.fillPts,
        color: "var(--danger)",
      },
      {
        key: "clients", label: "Clients actifs", icon: "groups",
        value: clientsThisMonth.length, delta: pctDelta(clientsThisMonth.length, clientsLastMonth.length),
        period: "vs mois dernier", pts: spark.pts, fillPts: spark.fillPts,
        color: "#059669",
      },
      {
        key: "today", label: "RDV aujourd'hui", icon: "today",
        value: todayAppts.filter(a => a.status === "confirmed").length,
        delta: null,
        period: "confirmés", pts: spark.pts, fillPts: spark.fillPts,
        color: "#d97706",
      },
    ];

    // ── Enrichissement des RDV aujourd'hui ────────────────────────────────────
    const todayEnriched = todayAppts.map((a) => {
      const clientName = a.clientRef?.fullName || `${a.name || ""} ${a.surname || ""}`.trim() || "Client";
      const initials = clientName.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
      return { ...a, clientName, initials };
    });

    const upcomingEnriched = upcomingAppts.map((a) => {
      const clientName = a.clientRef?.fullName || `${a.name || ""} ${a.surname || ""}`.trim() || "Client";
      const dateStr = new Date(a.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
      return { ...a, clientName, dateStr };
    });

    const recentEnriched = recentBookings.map((a) => {
      const clientName = a.clientRef?.fullName || `${a.name || ""} ${a.surname || ""}`.trim() || "Client";
      const dateStr = new Date(a.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
      return { ...a, clientName, dateStr };
    });

    const logsEnriched = recentLogs.map((l) => {
      const ago = (() => {
        const diff = Date.now() - new Date(l.createdAt).getTime();
        if (diff < 60000) return "À l'instant";
        if (diff < 3600000) return `${Math.floor(diff / 60000)} min`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} h`;
        return `${Math.floor(diff / 86400000)} j`;
      })();
      const actionColor = l.action.includes("delete") || l.action.includes("cancel") ? "danger"
        : l.action.includes("create") || l.action.includes("add") ? "accent"
        : "muted";
      return { ...l, ago, actionColor };
    });

    // Nom de l'établissement actif — jamais `req.user.businessName` : un
    // collaborateur verrait sinon le nom de sa propre activité. Le repli sur
    // le compte du VRAI patron est déjà résolu par injectCompany.
    const companyName = res.locals.currentCompanyName || res.locals.currentCompany.name || "Établissement";
    const initials = companyName.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "BS";
    const nextAppt = todayEnriched.find((a) => a.status === "confirmed" && a.startTime >= `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`);

    // ── Checklist d'onboarding (masquée si complète ou fermée) ────────────────
    // Réservée au PROPRIÉTAIRE : c'est la mise en route de SA page, et les flags
    // (dismissed / linkShared) vivent sur son compte. Un collaborateur verrait
    // sinon un état calculé sur SON user (logo/lien faux) et poserait les flags
    // au mauvais endroit.
    let onboarding = null;
    if (res.locals.membershipRole === "owner") {
      try {
        const status = await getOnboardingStatus(req.user, res.locals.currentCompany);
        if (status && !status.complete && !status.dismissed) onboarding = status;
      } catch (_) { /* non bloquant */ }
    }

    res.render("admin/panel", {
      pageName: "Dashboard",
      title: "Dashboard — BranShee",
      greeting,
      companyName,
      initials,
      stats,
      todayAppts: todayEnriched,
      upcomingAppts: upcomingEnriched,
      recentBookings: recentEnriched,
      recentLogs: logsEnriched,
      nextAppt,
      onboarding,
      todayStr: now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
    });
  } catch (err) {
    console.error("[panel]", err);
    res.render("admin/panel", {
      pageName: "Dashboard",
      title: "Dashboard — BranShee",
      greeting: "Bonjour", companyName: "Studio", initials: "BS",
      stats: [], todayAppts: [], upcomingAppts: [], recentBookings: [], recentLogs: [],
      nextAppt: null, onboarding: null,
      todayStr: new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
    });
  }
};

const Booking = require("../db/models/book.model");
const DaysOff = require("../db/models/company/daysOff.model");
const pug = require("pug");
const path = require("path");
const htmlTemplate = pug.renderFile(path.join(__dirname, "../views/templates/emails/booking-confirmed.pug"), { hour: "22:30" });
exports.book = async (req, res) => {
  const { bookId } = req.params;

  const [client, company, activeEmployees] = await Promise.all([
    // IDOR : scopé à l'établissement courant.
    Booking.findOne({ _id: bookId, company: res.locals.currentCompany._id })
      .populate("employee", "fullName profilePicture")
      .populate("clientRef", "fullName profilePicture email phone"),
    Company.findOne(
      { _id: res.locals.currentCompany._id, "employees.user": req.user._id },
      { "employees.$": 1 },
    ).lean(),
    getBookableTeam(res.locals.currentCompany._id),
  ]);

  const grade = company?.employees[0]?.grade;

  res.render("admin/book", {
    pageName: "Book",
    title: res.locals.t.titles.book,
    client,
    grade,
    isPremium: res.locals.user.isPremium,
    employees: activeEmployees,
  });
};

function getWeekDays(startDate = new Date(), locale = "fr-FR") {
  const week = [];
  const monday = new Date(startDate);

  const today = new Date();

  const day = monday.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);

    const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();

    // Build isoDate from local date parts so it is never shifted by UTC offset
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, "0");
    const dd   = String(d.getDate()).padStart(2, "0");
    const isoDate = `${yyyy}-${mm}-${dd}`;

    week.push({
      label: d.toLocaleDateString(locale, { weekday: "short" }),
      initial: d.toLocaleDateString(locale, { weekday: "narrow" }),
      longLabel: d.toLocaleDateString(locale, { weekday: "long" }),
      date: d.toLocaleDateString(locale, {
        day: "numeric",
        month: "long",
      }),
      dayNumber: d.getDate(),
      weekdayIndex: d.getDay(),   // 0=Sun … 6=Sat — stored while d is correct local Date
      iso: d.toISOString(),
      isoDate,                    // built from local parts, never UTC-shifted
      isToday,
    });
  }

  return week;
}

function generateTimeSlots(startHour, endHour, slotTime) {
  const slots = [];

  for (let hour = startHour; hour < endHour; hour++) {
    for (let minute = 0; minute < 60; minute += slotTime) {
      const h = String(hour).padStart(2, "0");
      const m = String(minute).padStart(2, "0");

      slots.push(`${h}:${m}`);
    }
  }

  return slots;
}

function timeStrToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Positionne les RDV d'une journée en continu (comme Google Calendar) plutôt
 * que de les caler sur une grille dont le pas changerait selon les minutes de
 * début (ex: un RDV à 9h20 ne doit JAMAIS resserrer toute la grille à 10 min —
 * il doit juste s'afficher légèrement décalé dans la case 9h00–9h30).
 * Repère les RDV qui se chevauchent dans le temps et leur assigne une colonne
 * (côte à côte) ; au-delà de 3 RDV simultanés, regroupe en un seul résumé
 * cliquable (comme avant) pour ne pas surcharger la vue.
 */
function buildDayBoxes(dayItems) {
  const sorted = dayItems.slice().sort((a, b) => timeStrToMinutes(a.startHour) - timeStrToMinutes(b.startHour));
  const clusters = [];
  let cluster = [];
  let clusterEnd = -Infinity;
  sorted.forEach((ev) => {
    const s = timeStrToMinutes(ev.startHour);
    const e = s + (ev.slotTime || 30);
    if (cluster.length && s >= clusterEnd) {
      clusters.push(cluster);
      cluster = [];
      clusterEnd = -Infinity;
    }
    cluster.push(ev);
    clusterEnd = Math.max(clusterEnd, e);
  });
  if (cluster.length) clusters.push(cluster);

  const boxes = [];
  clusters.forEach((cl) => {
    if (cl.length > 3) {
      const starts = cl.map((ev) => timeStrToMinutes(ev.startHour));
      const ends   = cl.map((ev) => timeStrToMinutes(ev.startHour) + (ev.slotTime || 30));
      boxes.push({
        kind: "summary",
        startMin: Math.min(...starts),
        endMin: Math.max(...ends),
        count: cl.length,
        items: cl,
      });
      return;
    }
    const colEnds = [];
    const startIndex = boxes.length;
    cl.forEach((ev) => {
      const s = timeStrToMinutes(ev.startHour);
      const e = s + (ev.slotTime || 30);
      let col = colEnds.findIndex((end) => end <= s);
      if (col === -1) { col = colEnds.length; colEnds.push(e); }
      else colEnds[col] = e;
      boxes.push({ kind: "single", startMin: s, endMin: e, col, colCount: 0, appointment: ev });
    });
    const colCount = colEnds.length;
    for (let i = startIndex; i < boxes.length; i++) boxes[i].colCount = colCount;
  });
  return boxes;
}

exports.appointment = async (req, res) => {
  const currentCompany = res.locals.currentCompany;
  if (!currentCompany) {
    // Un utilisateur connecté sans établissement (ex: intention "undecided"
    // à l'inscription) ne doit JAMAIS être renvoyé vers /register : pour un
    // compte déjà authentifié, GET /register redirige lui-même vers
    // /appointment → boucle de redirection infinie ("trop de redirections").
    return res.redirect("/etablissement/mes-etablissements");
  }

  // Employee filter from query param
  const employeeFilter = req.query.employee || "all";

  const Service = require("../db/models/company/service.model");
  const [apps, rowTime, employees, daysOffDoc, services, allServicesForColor] = await Promise.all([
    GetAllAppointments(currentCompany, employeeFilter),
    Company.findById(currentCompany).select("slotTime schedule").lean(),
    getBookableTeam(currentCompany),
    DaysOff.findOne({ company: currentCompany }).lean(),
    // Les services MASQUÉS sont inclus : masquer sert à les retirer de la
    // page publique, pas à empêcher le pro de les utiliser lui-même (ex. une
    // prestation réservée aux habitués, ou une nouveauté pas encore annoncée).
    // Le champ `active` est renvoyé pour que le sélecteur les signale.
    Service.find({ company: currentCompany }).select("_id name duration durationMax price employees color active").sort({ active: -1, order: 1 }).lean(),
    // Filet de secours pour les anciens RDV créés avant qu'on fige la couleur
    // sur la réservation elle-même (serviceColor) — inclut les services
    // désactivés (mais pas supprimés) pour ne pas leur faire perdre leur
    // couleur d'un coup.
    Service.find({ company: currentCompany }).select("_id color").lean(),
  ]);

  const slotTime = rowTime.slotTime || 60;

  // Map serviceId → color pour colorer les RDV selon le service réservé
  const serviceColorById = {};
  services.forEach((s) => { if (s.color) serviceColorById[String(s._id)] = s.color; });
  const serviceColorByIdAll = {};
  allServicesForColor.forEach((s) => { if (s.color) serviceColorByIdAll[String(s._id)] = s.color; });

  const formatted = apps.map((appointment) => {
    const [h, m] = appointment.startTime.split(":").map(Number);
    const startDate = new Date(appointment.date.getFullYear(), appointment.date.getMonth(), appointment.date.getDate(), h, m, 0, 0);

    // Use the booking’s stored slotTime (actual service duration) for end time
    const duration = appointment.slotTime || slotTime;
    const endDate = new Date(startDate);
    endDate.setMinutes(endDate.getMinutes() + duration);

    // Populated employee (may be null)
    const emp = appointment.employee;
    const empName  = emp ? (emp.fullName || `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || "") : (appointment.employeeName || "");
    const empPhoto = emp ? (emp.profilePicture || "/images/no-user.webp") : "/images/no-user.webp";

    return {
      _id: appointment._id,
      name: appointment.name,
      surname: appointment.surname,
      email: appointment.email,
      phone: appointment.phone,
      message: appointment.message,
      isBlock: !!appointment.isBlock,
      weekday: (startDate.getDay() + 6) % 7,
      status: appointment.status,
      slotTime: duration,
      serviceName: appointment.serviceName || "",
      // Priorité à la couleur figée sur la réservation (correcte même si le
      // service a été supprimé/désactivé depuis) ; sinon recalculée en
      // direct pour les anciens RDV créés avant ce correctif.
      serviceColor: appointment.serviceColor
        || (appointment.service ? (serviceColorById[String(appointment.service)] || serviceColorByIdAll[String(appointment.service)] || "") : ""),
      employeeId:   emp ? String(emp._id) : "",
      employeeName: empName,
      employeePhoto: empPhoto,

      // Build from local date parts so it always matches the local calendar day,
      // even when the server timezone is not UTC.
      isoDate: `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`,
      date: startDate.toLocaleDateString("fr-BE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      // Use stored time strings directly — locale formatting is unreliable across environments
      startHour: appointment.startTime,
      endHour: `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`,
    };
  });
  const view = req.query.view === "month" ? "month" : "week";
  // Rejeter "undefined" / dates invalides
  const rawDate = req.query.date;
  const parsedDate = rawDate && rawDate !== "undefined" ? new Date(rawDate + "T12:00:00") : null;
  const referenceDate = (parsedDate && !isNaN(parsedDate.getTime())) ? parsedDate : new Date();
  const focusedIso = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth()+1).padStart(2,"0")}-${String(referenceDate.getDate()).padStart(2,"0")}`;
  const localeMap = {
    fr: "fr-FR",
    en: "en-US",
    nl: "nl-NL",
    es: "es-ES",
    it: "it-IT",
    de: "de-DE",
  };
  const locale = localeMap[res.locals.lang] || "fr-FR";
  const weekDays = getWeekDays(referenceDate, locale).map((d) => ({
    ...d,
    isFocused: d.iso.split("T")[0] === focusedIso,
  }));
  // ── Événements externes (Google Calendar) : bloquer les créneaux occupés sur l'agenda perso ──
  const companyForOwner = await Company.findById(currentCompany).select("owner").lean();
  if (companyForOwner?.owner) {
    const ownerUser = await User.findById(companyForOwner.owner).select("googleCalendar").lean();
    const gcal = ownerUser?.googleCalendar;
    if (gcal?.connected && gcal.refreshToken) {
      const toBrusselsMinutes = (date) => {
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", hour12: false,
        }).formatToParts(date);
        const h = Number(parts.find((p) => p.type === "hour").value);
        const m = Number(parts.find((p) => p.type === "minute").value);
        return h * 60 + m;
      };

      const busyByDay = await Promise.all(
        weekDays.map((d) => getBusyIntervals(gcal.refreshToken, d.isoDate))
      );

      weekDays.forEach((d, i) => {
        busyByDay[i].forEach((interval) => {
          const startMin = toBrusselsMinutes(interval.start);
          const endMin = toBrusselsMinutes(interval.end);
          if (endMin <= startMin) return;

          const slotStart = Math.floor(startMin / 30) * 30;
          const slotEnd = Math.max(Math.ceil(endMin / 30) * 30, slotStart + 30);

          // Ignore les créneaux déjà occupés par un RDV Branshee (déjà synchronisé vers Google)
          const overlapsExisting = formatted.some((a) => {
            if (a.isoDate !== d.isoDate) return false;
            const [ah, am] = a.startHour.split(":").map(Number);
            const aStart = ah * 60 + am;
            const aEnd = aStart + (a.slotTime || slotTime);
            return aStart < endMin && aEnd > startMin;
          });
          if (overlapsExisting) return;

          formatted.push({
            _id: `gcal-${d.isoDate}-${slotStart}`,
            name: "Autre événement",
            surname: "",
            isExternal: true,
            weekday: d.weekdayIndex,
            status: "external",
            slotTime: slotEnd - slotStart,
            serviceName: "",
            employeeId: "",
            employeeName: "",
            employeePhoto: "/images/no-user.webp",
            isoDate: d.isoDate,
            date: d.date,
            startHour: `${String(Math.floor(slotStart / 60)).padStart(2, "0")}:${String(slotStart % 60).padStart(2, "0")}`,
            endHour: `${String(Math.floor(slotEnd / 60)).padStart(2, "0")}:${String(slotEnd % 60).padStart(2, "0")}`,
          });
        });
      });
    }
  }

  // ── Cours collectifs dans le calendrier ────────────────────────────────────
  // Un cours est un Service (type "group"), pas un Booking : il n'apparaissait
  // donc JAMAIS dans le calendrier, même quand il bloquait réellement des
  // créneaux côté client — le pro voyait un trou inexplicable dans son agenda.
  //
  // Rendu comme BANDE DE FOND et non comme pastille dans `formatted` : une
  // pastille se ferait replier dans le résumé « N RDV » dès 4 événements sur le
  // même créneau — or un cours collectif attire justement plusieurs
  // participants, donc il redisparaîtrait exactement quand il compte le plus.
  // La bande occupe toute la largeur du jour, sous les RDV, et ne dispute
  // aucune colonne à ses propres participants.
  //
  // Affichée TOUJOURS, que `blocksIndividualBookings` soit vrai ou non : dans
  // les deux cas le pro a bien un cours à cette heure-là ; seul le blocage des
  // RDV individuels change, ce que signale le cadenas.
  //
  // TOUT le bloc est sous try/catch : c'est un enrichissement d'affichage, il
  // ne doit JAMAIS pouvoir empêcher le calendrier de se rendre. Une donnée de
  // cours mal formée fait au pire disparaître les bandes, jamais l'agenda.
  const courseBandsByDay = {};
  try {
    const hhmm = (min) =>
      `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    const coursesByDay = await Promise.all(
      weekDays.map((d) => getCoursesForDate(currentCompany, d.isoDate).catch(() => []))
    );
    weekDays.forEach((d, i) => {
      courseBandsByDay[d.isoDate] = (coursesByDay[i] || [])
        .filter((course) => {
          // Respecte le filtre employé de la barre du haut. Un cours sans
          // employé assigné concerne tout le monde et reste toujours visible.
          const assigned = (course.employees || []).map(String);
          return employeeFilter === "all" || !assigned.length || assigned.includes(String(employeeFilter));
        })
        .map((course) => {
          const [startMin, endMin] = courseRange(course);
          if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return null;
          return {
            id: String(course._id),
            name: course.name || "Cours collectif",
            color: course.color || "",
            blocks: course.blocksIndividualBookings !== false,
            startMin,
            endMin,
            startHour: hhmm(startMin),
            endHour: hhmm(endMin),
          };
        })
        .filter(Boolean);
    });
  } catch (err) {
    console.error("courseBands error:", err);
  }

  const firstDay = weekDays[0];
  const lastDay = weekDays[6];
  const weekLabel = `${firstDay.label} ${firstDay.date} - ${lastDay.label} ${lastDay.date}`;
  const focusedDay = weekDays.find((d) => d.isFocused) || weekDays[0];
  const dayLabel = `${focusedDay.label} ${focusedDay.date}`;
  const focusedDayName = focusedDay.longLabel;
  const focusedDayDate = focusedDay.date;
  const activeSchedule = (rowTime.schedule || []).filter((d) => !d.dayOff);
  const scheduleHours = activeSchedule.flatMap((d) => d.workingHours || []);

  // Heure d'un "HH:MM", ou null si la valeur est absente/illisible.
  //
  // CRITIQUE : sans ce filtre, une seule plage enregistrée avec un début ou une
  // fin vide (""/undefined) donnait parseInt("") = NaN. Or NaN n'est pas null :
  // il passait le `.filter(v => v !== null)` plus bas, contaminait Math.min /
  // Math.max, et minHour/maxHour devenaient NaN. `generateTimeSlots` boucle sur
  // `hour < endHour` — toute comparaison avec NaN est fausse, la boucle ne
  // tournait donc AUCUNE fois : zéro ligne d'heure, calendrier entièrement vide
  // sur TOUTES les semaines, sans la moindre erreur dans les logs.
  const hourOf = (value) => {
    const h = parseInt(String(value ?? "").split(":")[0], 10);
    return Number.isFinite(h) ? h : null;
  };
  const scheduleStarts = scheduleHours.map((wh) => hourOf(wh && wh.start)).filter((h) => h !== null);
  const scheduleEnds = scheduleHours.map((wh) => hourOf(wh && wh.end)).filter((h) => h !== null);
  const scheduleMin = scheduleStarts.length > 0 ? Math.min(...scheduleStarts) : null;
  const scheduleMax = scheduleEnds.length > 0 ? Math.max(...scheduleEnds) : null;

  // Include special days (DaysOff with custom working hours) in range calculation
  const weekIsos = weekDays.map((d) => d.isoDate);
  const specialDayHours = (daysOffDoc?.dates || [])
    .filter((d) => weekIsos.includes(new Date(d.date).toISOString().split("T")[0]))
    .flatMap((d) => d.workingHours || [])
    .filter((wh) => wh && wh.start);
  // Même piège que pour scheduleMin/Max ci-dessus — et ici le filtre ne testait
  // que `start`, alors que `specialMax` lit `end` : un jour spécial avec une
  // heure de fin vide suffisait à faire passer NaN.
  const specialStarts = specialDayHours.map((wh) => hourOf(wh.start)).filter((h) => h !== null);
  const specialEnds = specialDayHours.map((wh) => hourOf(wh.end)).filter((h) => h !== null);
  const specialMin = specialStarts.length > 0 ? Math.min(...specialStarts) : null;
  const specialMax = specialEnds.length > 0 ? Math.max(...specialEnds) : null;

  // Compute appointment range — use total minutes so :30 appointments extend the range correctly.
  //
  // IMPORTANT : uniquement sur les RDV de la période AFFICHÉE. `formatted`
  // contient tout l'historique de l'établissement : un seul rendez-vous pris à
  // 00:00 (créneau ouvert par erreur, un jour) forçait la grille à démarrer à
  // minuit pour toujours, sur toutes les semaines — alors que les horaires
  // commencent à 09:00. La plage suit maintenant ce qu'on regarde : les
  // horaires de travail, sauf si un RDV de ces jours-là déborde.
  const apptMinutesList = formatted
    .filter((a) => weekIsos.includes(a.isoDate))
    .map((a) => {
      const [h, m] = a.startHour.split(":").map(Number);
      return h * 60 + m;
    });
  const apptMin = apptMinutesList.length > 0 ? Math.floor(Math.min(...apptMinutesList) / 60) : null;
  // +1h buffer so the appointment slot itself is always visible even at the last row
  const apptMax = apptMinutesList.length > 0 ? Math.ceil((Math.max(...apptMinutesList) + 60) / 60) : null;

  // Les cours collectifs élargissent aussi la grille. Un cours qui déborde des
  // horaires d'ouverture (16:30 → 20:30 alors que la boutique ferme à 18:00)
  // s'affichait sinon en dehors du calendrier, dans le vide sous la dernière
  // ligne. Même logique que pour les RDV : la grille couvre ce qu'elle montre.
  const bandMinutes = Object.values(courseBandsByDay).flat();
  const courseMin = bandMinutes.length > 0 ? Math.floor(Math.min(...bandMinutes.map((b) => b.startMin)) / 60) : null;
  // Arrondi au-dessus : un cours qui finit à 20:30 a besoin de la ligne de 21h.
  const courseMax = bandMinutes.length > 0 ? Math.ceil(Math.max(...bandMinutes.map((b) => b.endMin)) / 60) : null;

  const candidates = [scheduleMin, specialMin, apptMin, courseMin].filter((v) => Number.isFinite(v));
  const candidatesMax = [scheduleMax, specialMax, apptMax, courseMax].filter((v) => Number.isFinite(v));

  // Filet de sécurité : la grille horaire doit TOUJOURS s'afficher. Peu importe
  // ce que contient la configuration de l'établissement, on borne la plage à
  // quelque chose d'affichable — un calendrier aux horaires approximatifs reste
  // utilisable, un calendrier vide ne l'est pas.
  let minHour = candidates.length > 0 ? Math.min(...candidates) : 8;
  let maxHour = candidatesMax.length > 0 ? Math.max(...candidatesMax) : 18;
  minHour = Math.min(Math.max(0, minHour), 23);
  maxHour = Math.min(Math.max(minHour + 1, maxHour), 24);

  // ── Fill status per weekday (green / orange / red) ────────────────────────
  // Compare total MINUTES booked vs total available minutes so that services
  // with a different duration than the company slotTime don't skew the ratio.
  // Capacity is multiplied by the number of active employees when showing all.
  const empCapacityFactor = (employeeFilter === "all" && employees.length > 0) ? employees.length : 1;

  const weekDaysWithFill = weekDays.map((d) => {
    // weekdayIndex is stored directly from d.getDay() in getWeekDays — always the
    // correct local weekday, never shifted by UTC serialisation.
    const jsWeekday = d.weekdayIndex; // 0=Sun … 6=Sat

    // Special day override (congé with custom hours)?
    // Compare using local date parts so UTC midnight never shifts the date.
    const specialDay = (daysOffDoc?.dates || []).find((sd) => {
      const s = new Date(sd.date);
      const sdIso = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")}`;
      return sdIso === d.isoDate;
    });

    let workingHours = [];
    if (specialDay) {
      workingHours = specialDay.workingHours || [];
    } else {
      const dayConfig = (rowTime.schedule || []).find((s) => s.weekdayIndex === jsWeekday);
      if (dayConfig && !dayConfig.dayOff) workingHours = dayConfig.workingHours || [];
    }

    // Total available minutes for this day (× employee count when viewing "all")
    let totalAvailableMinutes = 0;
    workingHours.forEach((period) => {
      if (!period?.start || !period?.end) return; // guard against malformed data
      const [sh, sm] = period.start.split(":").map(Number);
      const [eh, em] = period.end.split(":").map(Number);
      if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return;
      totalAvailableMinutes += (eh * 60 + em) - (sh * 60 + sm);
    });
    totalAvailableMinutes *= empCapacityFactor;

    // Total minutes booked on this day — use each booking's real duration so that
    // a 60-min service doesn't count as only one 30-min slot (or vice-versa).
    const minutesBooked = formatted
      .filter((a) => a.isoDate === d.isoDate)
      .reduce((sum, a) => sum + (a.slotTime || slotTime), 0);

    let fillStatus = null;
    if (totalAvailableMinutes > 0) {
      const ratio = minutesBooked / totalAvailableMinutes;
      // thresholds: green < 75 % ≤ orange < 100 % ≤ red
      if      (ratio >= 1)    fillStatus = "red";
      else if (ratio >= 0.75) fillStatus = "orange";
      else                    fillStatus = "green";
    }

    // Congé = jour spécial marqué "dayOff" (ou sans aucune plage horaire) — c'est
    // un jour posé en congé, à distinguer d'un jour de fermeture hebdomadaire.
    const specialIsOff = !!specialDay && (specialDay.dayOff === true || !(specialDay.workingHours || []).some((w) => w && w.start && w.end));
    // Jour spécial AVEC horaires personnalisés (pas un congé complet, mais un jour
    // dont les horaires diffèrent du planning habituel) — à signaler aussi.
    const isSpecial = !!specialDay && !specialIsOff;
    const specialLabel = isSpecial
      ? (specialDay.workingHours || []).filter((w) => w && w.start && w.end).map((w) => `${w.start}–${w.end}`).join(", ")
      : "";
    // A day is "off" when it's a congé, or (no special override) the weekly schedule
    // marks it dayOff / has no entry for this weekday.
    const dayConfig2 = (rowTime.schedule || []).find((s) => s.weekdayIndex === jsWeekday);
    const isDayOff = specialIsOff || (!specialDay && (!dayConfig2 || dayConfig2.dayOff === true));
    const isTimeOff = specialIsOff;

    return { ...d, fillStatus, isDayOff, isTimeOff, isSpecial, specialLabel };
  });

  // ── Données vue mois ────────────────────────────────────────────────────
  const monthDays = [];
  const mYear  = referenceDate.getFullYear();
  const mMonth = referenceDate.getMonth();
  const mFirst = new Date(mYear, mMonth, 1);
  const mLast  = new Date(mYear, mMonth + 1, 0);
  // Padding debut (lundi = 0)
  const startDow = (mFirst.getDay() + 6) % 7;
  for (let i = startDow - 1; i >= 0; i--) {
    const d = new Date(mYear, mMonth, -i);
    monthDays.push({ day: d.getDate(), iso: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`, current: false });
  }
  for (let d = 1; d <= mLast.getDate(); d++) {
    const iso = `${mYear}-${String(mMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const now = new Date(); const todayIso = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    monthDays.push({ day: d, iso, current: true, isToday: iso === todayIso });
  }
  while (monthDays.length < 42) {
    const prev = monthDays[monthDays.length - 1];
    const nd = new Date(prev.iso + "T12:00:00"); nd.setDate(nd.getDate() + 1);
    monthDays.push({ day: nd.getDate(), iso: `${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,"0")}-${String(nd.getDate()).padStart(2,"0")}`, current: false });
  }
  // Compter les RDV par jour pour le mois — groupés par couleur de service
  // (pour afficher un badge par service plutôt qu'un seul total vert)
  const apptByDay = {};
  const colorsByDay = {};
  formatted.forEach(a => {
    if (a.isExternal) return;
    apptByDay[a.isoDate] = (apptByDay[a.isoDate] || 0) + 1;
    const key = a.serviceColor || "__default__";
    if (!colorsByDay[a.isoDate]) colorsByDay[a.isoDate] = {};
    colorsByDay[a.isoDate][key] = (colorsByDay[a.isoDate][key] || 0) + 1;
  });
  monthDays.forEach(d => {
    d.count = apptByDay[d.iso] || 0;
    const map = colorsByDay[d.iso] || {};
    d.colorCounts = Object.keys(map).map((k) => ({
      color: k === "__default__" ? null : k,
      count: map[k],
    }));
    // Jours off / congés pour la vue Mois — même logique que la vue Semaine.
    const dd = new Date(d.iso + "T12:00:00");
    const jsWeekday = dd.getDay();
    const special = (daysOffDoc?.dates || []).find((sd) => {
      const s = new Date(sd.date);
      return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")}` === d.iso;
    });
    const specialIsOff = !!special && (special.dayOff === true || !(special.workingHours || []).some((w) => w && w.start && w.end));
    const dayConfig = (rowTime.schedule || []).find((s) => s.weekdayIndex === jsWeekday);
    d.isTimeOff = specialIsOff;
    d.isDayOff = specialIsOff || (!special && (!dayConfig || dayConfig.dayOff === true));
    d.isSpecial = !!special && !specialIsOff;
    d.specialLabel = d.isSpecial
      ? (special.workingHours || []).filter((w) => w && w.start && w.end).map((w) => `${w.start}–${w.end}`).join(", ")
      : "";
  });
  const monthLabel = mFirst.toLocaleDateString(locale, { month: "long", year: "numeric" });

  // Mois prev/next (1er du mois)
  const prevMonth = new Date(mYear, mMonth - 1, 1);
  const nextMonth = new Date(mYear, mMonth + 1, 1);
  const prevMonthIso = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth()+1).padStart(2,"0")}-01`;
  const nextMonthIso = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth()+1).padStart(2,"0")}-01`;

  // Grille horaire fixe à 30 min (2 lignes par heure) — un RDV qui démarre à
  // une minute non multiple de 30 (ex: 9h20) ne resserre plus toute la grille :
  // il s'affiche en continu, légèrement décalé dans sa case, via boxesByDay.
  const gridStep = 30;
  const boxesByDay = {};
  weekDays.forEach((d) => {
    boxesByDay[d.isoDate] = buildDayBoxes(formatted.filter((a) => a.isoDate === d.isoDate));
  });

  res.render("admin/appointment", {
    pageName: "Appointment",
    title: res.locals.t.titles.calendar,
    slotTime,
    gridStep,
    minHour,
    hours: generateTimeSlots(minHour, maxHour, gridStep),
    weekDays: weekDaysWithFill,
    appointments: formatted,
    boxesByDay,
    courseBandsByDay,
    weekLabel,
    dayLabel,
    focusedDayName,
    focusedDayDate,
    focusedIso,
    employees,
    employeeFilter,
    view,
    monthDays,
    monthLabel,
    prevMonthIso,
    nextMonthIso,
    services,
  });
};

// ── Conflit d'horaire : jamais deux RDV/absences qui se chevauchent sur la
// même ressource — un employé précis si choisi, l'établissement entier s'il
// n'y a pas d'employés, ou "n'importe quel employé disponible" si aucun
// n'est choisi alors que l'entreprise en a (même logique que la réservation
// publique, cf. booking.controller.js#getBooking : on ne bloque que si TOUS
// les employés sont occupés). Partagé entre createAdminBooking et
// createAdminBlock (absences). Retourne un message d'erreur ou null. ───────
// Implémentation partagée avec l'API mobile — cf. utils/bookingConflict.js
const { checkBookingConflict, inspectBookingConflict } = require("../utils/bookingConflict");
const { dossierKey } = require("../utils/dossierKey");
const { preserveClient } = require("../utils/preserveClient");

// ── Création manuelle d'un rendez-vous depuis le panel admin ─────────────────
exports.createAdminBooking = async (req, res) => {
  try {
    const currentCompany = res.locals.currentCompany;
    if (!currentCompany) return res.status(401).json({ success: false, error: "unauthorized" });

    const {
      date, startTime, name, surname, phone, message,
      serviceId, duration,
    } = req.body;
    let { employeeId } = req.body;
    const rawEmail = req.body.email;
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : rawEmail;

    // E-mail et téléphone facultatifs : quand c'est le PRO qui saisit le
    // rendez-vous, il a souvent le client en face de lui ou au téléphone et
    // ne connaît ni l'un ni l'autre. Exiger l'e-mail l'obligeait à
    // inventer une adresse bidon, qui polluait ensuite la fiche client et
    // faisait partir des confirmations dans le vide.
    // Seuls la date, l'heure et le nom restent indispensables.
    if (!date || !startTime || !name) {
      return res.json({ success: false, error: "missing_fields", message: "La date, l'heure et le nom sont nécessaires." });
    }

    const Service = require("../db/models/company/service.model");
    const Booking = require("../db/models/book.model");
    const pug = require("pug");
    const path = require("path");
    const { sendEmail } = require("../utils/mailer");

    const company = await Company.findById(currentCompany);
    if (!company) return res.json({ success: false, error: "company_not_found" });

    let serviceName = "";
    let serviceColor = "";
    // Priorité : durée du service choisi > durée glissée sur le calendrier
    // (clic-glisser, voir public/js/layouts/appointment.js#manualDurationOverride)
    // > durée par défaut de l'entreprise — même ordre que l'aperçu affiché
    // dans la modale ("Heure de fin" / "Durée").
    let actualDuration = (Number(duration) > 0 ? Number(duration) : null) || company.slotTime || 60;
    let serviceDoc = null;
    if (serviceId) {
      const service = await Service.find({ _id: serviceId, company: currentCompany }).select("name duration durationMax color type capacity recurring sessions").lean();
      serviceDoc = service[0] || null;
      if (serviceDoc) {
        serviceName = serviceDoc.name || "";
        serviceColor = serviceDoc.color || "";
        // Service à durée variable (« 30-45 min ») : la durée envoyée fait foi
        // tant qu'elle reste entre les deux bornes. Sinon on retombe sur la
        // borne basse, comme avant.
        const min = Number(serviceDoc.duration) || 0;
        const max = Number(serviceDoc.durationMax) || 0;
        const demandee = Number(duration) > 0 ? Number(duration) : null;
        if (max > min && demandee && demandee >= min && demandee <= max) {
          actualDuration = demandee;
        } else {
          actualDuration = min || actualDuration;
        }
      }
    }

    // ── Inscription manuelle à un cours collectif : même logique que la
    // réservation publique (cf. booking.controller.js#createBooking) — on
    // vérifie la capacité restante plutôt que de bloquer sur un chevauchement
    // d'employé, puisqu'il s'agit précisément DU cours que l'admin inscrit.
    // Permet à l'admin d'ajouter Caroline à un atelier qu'il a lui-même
    // bloqué, tant qu'il reste des places (cf. bug rapporté par Cecile). ────
    let isGroup = !!(serviceDoc && serviceDoc.type === "group");
    if (isGroup) {
      const bookingDateObj = new Date(date);
      const occurrenceValid = serviceDoc.recurring?.enabled
        ? (serviceDoc.recurring.weekdays || []).includes(bookingDateObj.getDay()) && serviceDoc.recurring.startTime === startTime
        : (serviceDoc.sessions || []).some((s) => {
            const sDate = new Date(s.date);
            return sDate.getFullYear() === bookingDateObj.getFullYear()
              && sDate.getMonth() === bookingDateObj.getMonth()
              && sDate.getDate() === bookingDateObj.getDate()
              && s.startTime === startTime;
          });
      if (occurrenceValid) {
        // Séance planifiée : on vérifie la capacité restante (inscription à la séance).
        const capacity = serviceDoc.capacity || 1;
        const participantCount = await Booking.countDocuments({
          company: currentCompany, service: serviceId, date: bookingDateObj, startTime, status: "confirmed",
        });
        if (participantCount >= capacity) {
          return res.json({ success: false, error: "session_full", message: "Cette session est complète, merci de choisir un autre horaire." });
        }
      } else {
        // Horaire hors des séances planifiées : l'admin crée un RDV ponctuel avec
        // ce service collectif → on le traite comme un rendez-vous individuel
        // (assignation d'un praticien + vérif de chevauchement) au lieu de bloquer.
        isGroup = false;
      }
    }

    let employeeName = "";
    // Un cours collectif n'est jamais assigné à un employé précis (même
    // convention que la réservation publique) — la capacité a déjà été
    // vérifiée ci-dessus, pas besoin de chercher un employé libre.
    if (!isGroup) {
      const team = await getBookableTeam(currentCompany);
      if (employeeId) {
        const emp = team.find((m) => m.id === String(employeeId));
        // Praticien inconnu de cette équipe (id falsifié / autre établissement) →
        // on n'enregistre PAS cet id : le RDV devient non assigné plutôt que de
        // référencer un employé d'un autre établissement.
        if (emp) employeeName = `${emp.firstName} ${emp.lastName}`.trim();
        else employeeId = null;
      } else if (team.length >= 1) {
        // Plusieurs employés : auto-assigner au premier disponible sur ce créneau
        const [h, m] = startTime.split(":").map(Number);
        const startMin = h * 60 + m;
        const endMin = startMin + actualDuration;
        const dayBookings = await Booking.find({
          company: currentCompany,
          date: new Date(date),
          status: { $ne: "canceled" },
          $or: [{ employee: { $in: team.map((x) => x.id) } }, { employee: null }],
        }).select("startTime slotTime employee").lean();
        const busyIds = new Set();
        dayBookings.forEach((b) => {
          const [bh, bm] = b.startTime.split(":").map(Number);
          const bs = bh * 60 + bm, be = bs + (b.slotTime || actualDuration);
          if (startMin < be && endMin > bs) {
            if (b.employee == null) team.forEach((x) => busyIds.add(x.id));
            else busyIds.add(String(b.employee));
          }
        });
        const free = team.find((x) => !busyIds.has(x.id));
        if (free) {
          employeeId = free.id;
          employeeName = `${free.firstName} ${free.lastName}`.trim();
        }
      }
    } else {
      employeeId = null;
    }

    const [hours, minutes] = startTime.split(":").map(Number);
    const startTimeInMinutes = hours * 60 + minutes;
    const endTimeInMinutes = startTimeInMinutes + actualDuration;
    const endTime = `${String(Math.floor(endTimeInMinutes / 60)).padStart(2, "0")}:${String(endTimeInMinutes % 60).padStart(2, "0")}`;

    // Surbooking : quand l'établissement l'autorise, un chevauchement ne
    // bloque plus la création — mais le RDV doit être marqué `overbooked`,
    // sinon l'index unique de book.model.js le rejetterait (E11000) et le
    // réglage resterait sans effet.
    let estEnSurbooking = false;
    if (!isGroup) {
      const { message: conflictMessage, hadConflict, absence } = await inspectBookingConflict({
        Booking, currentCompany, date, startTimeInMinutes, endTimeInMinutes, employeeId, actualDuration,
      });
      if (conflictMessage && !company.allowOverbooking) {
        // Le seul obstacle est une absence que le pro s'est posée lui-même :
        // on ne refuse pas sèchement, on lui dit LAQUELLE et on le laisse
        // décider. Le client renvoie alors `forcerSurAbsence`.
        // L'absence n'est PAS supprimée : elle peut couvrir toute la journée
        // et d'autres rendez-vous, la détruire pour un seul RDV serait
        // disproportionné. Le rendez-vous se pose simplement par-dessus,
        // exactement comme une absence se pose par-dessus des RDV existants.
        if (absence && !req.body.forcerSurAbsence) {
          return res.json({
            success: false,
            error: "absence_conflict",
            message: conflictMessage,
            absence,
          });
        }
        if (!absence) {
          return res.json({ success: false, error: "conflict", message: conflictMessage });
        }
      }
      estEnSurbooking = hadConflict;
    }

    const newBooking = await Booking.create({
      overbooked: estEnSurbooking,
      date: new Date(date),
      startTime,
      endTime,
      company: currentCompany,
      name,
      surname: surname || "",
      email,
      phone: phone || "",
      message: message || "",
      slotTime: actualDuration,
      status: "confirmed",
      service: serviceId || null,
      serviceName,
      serviceColor,
      employee: employeeId || null,
      employeeName,
      isGroup,
      payment: { method: "none", status: "none", amount: 0, currency: "eur" },
    });

    const companyOwner = company.owner ? await User.findById(company.owner).lean() : null;

    // Adresse et téléphone appartiennent à l'ÉTABLISSEMENT : lus sur le compte,
    // un RDV créé depuis le second établissement envoyait le client à l'adresse
    // du premier.
    const identity = identityFor(company, companyOwner);

    let locationText = "";
    const loc = identity.location;
    if (loc?.serviceType === "en_ligne") {
      locationText = "En ligne";
    } else if (loc?.address || loc?.city) {
      locationText = [loc.address, loc.city].filter(Boolean).join(", ");
    }

    const baseUrl = process.env.BASE_URL || "https://www.branshee.com";
    const cancelUrl = `${baseUrl}/cancel-booking/${newBooking._id}?token=${newBooking.cancelToken}`;
    const formattedDate = new Date(date).toLocaleDateString("fr-FR", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    });

    const htmlTemplate = pug.renderFile(
      path.join(__dirname, "../views/templates/emails/booking-confirmed.pug"),
      {
        name,
        surname,
        date,
        formattedDate,
        startHour: startTime,
        endHour: endTime,
        slotTime: actualDuration,
        message,
        serviceName,
        employeeName,
        formAnswers: [],
        locationText,
        // Nom de l'ÉTABLISSEMENT (repli compte pour les fiches historiques).
        businessName:  (company?.name || companyOwner?.businessName || "").trim(),
        businessPhone: (identity.phonePro || "").trim(),
        cancelUrl,
        bookingId: newBooking._id,
        cancelToken: newBooking.cancelToken,
        // Message libre du pro (Personnaliser > Rappels), affiché tel quel.
        ownerMessage: (companyOwner?.calendarSettings?.confirmationMessage || "").trim(),
      },
    );

    // Sans adresse (saisie par le pro sans e-mail), il n'y a personne à
    // prévenir : on saute l'envoi au lieu d'appeler sendEmail avec une
    // destination vide, qui ferait échouer toute la création du rendez-vous.
    if (email) {
      await sendEmail(email, "Confirmation de votre rendez-vous — BranShee", htmlTemplate);
    }

    // ── Confirmation WhatsApp / SMS au client (canal prioritaire WhatsApp,
    // repli SMS ; même système de crédits + toggles établissement) ──────────
    try {
      const cs = companyOwner?.calendarSettings || {};
      // Nom de l'ÉTABLISSEMENT (règle 8) ; espaces normalisés car Meta rejette
      // un paramètre de template contenant un saut de ligne.
      const bizName = (company?.name || companyOwner?.businessName || companyOwner?.fullName || "")
        .replace(/\s+/g, " ")
        .trim();
      // Quota inclus SMS/WhatsApp = propriété du forfait de l'établissement.
      const billingPlan = billingUserFor(company, companyOwner).subscription.plan;
      if (phone && (cs.whatsappConfirmationEnabled || cs.smsConfirmationEnabled)) {
        // Fire-and-forget : ne bloque pas la réponse sur l'appel externe.
        (async () => {
          const { isWhatsappConfigured, sendWhatsappIfAllowed, WA_TPL_CONFIRMATION } = require("../utils/whatsapp");
          if (cs.whatsappConfirmationEnabled && isWhatsappConfigured()) {
            const wa = await sendWhatsappIfAllowed(companyOwner, phone, {
              plan: billingPlan,
              template: WA_TPL_CONFIRMATION,
              params: [
                (name || "").trim() || (surname || "").trim() || "",
                bizName || "votre établissement",
                formattedDate,
                startTime || "",
              ],
            }).catch((e) => { console.error("WhatsApp confirmation error:", e.message); return { sent: false }; });
            if (wa && wa.sent) return;
          }
          if (cs.smsConfirmationEnabled && (await isFeatureEnabled("sms_notifications"))) {
            const { sendBillableSmsIfAllowed } = require("../utils/sms");
            await sendBillableSmsIfAllowed(
              companyOwner,
              phone,
              `${bizName ? bizName + " : " : ""}votre rendez-vous est confirmé pour le ${formattedDate} à ${startTime}.`,
              { plan: billingPlan },
            ).catch((e) => console.error("SMS confirmation error:", e.message));
          }
        })().catch((e) => console.error("Confirmation notif error:", e.message));
      }
    } catch (notifErr) {
      console.error("Confirmation notif error:", notifErr.message);
    }

    try {
      if (companyOwner?.googleCalendar?.connected && companyOwner.googleCalendar.refreshToken) {
        const eventId = await addEventToCalendar(companyOwner.googleCalendar.refreshToken, newBooking);
        if (eventId) {
          await Booking.findByIdAndUpdate(newBooking._id, { googleEventId: eventId });
        }
      }
    } catch (gcalErr) {
      console.error("Google Calendar sync error (admin create):", gcalErr.message);
    }

    res.json({ success: true, bookingId: newBooking._id });
  } catch (err) {
    console.error("createAdminBooking error:", err);
    res.status(500).json({ success: false, error: "server_error", message: "Une erreur est survenue." });
  }
};

// ── Pose un bloc d'indisponibilité ("Absent") depuis le calendrier admin —
// clic-glisser sur une case vide, choix "Absence" plutôt que "Rendez-vous".
// Occupe le créneau comme un RDV (mêmes règles de chevauchement) mais sans
// client : pas d'email, n'apparaît jamais dans les dossiers clients. ───────
/**
 * Combien de VRAIS rendez-vous une absence va-t-elle recouvrir ?
 *
 * Strictement informatif : cette fonction LIT, elle ne modifie ni ne supprime
 * jamais rien. Poser une absence sur une journée déjà réservée est légitime —
 * « je ferme aux nouvelles demandes, mais j'honore ce qui est pris » — et les
 * rendez-vous existants doivent survivre intacts.
 *
 * Les blocs sont exclus du compte : deux absences qui se chevauchent n'ont
 * aucun intérêt à être signalées.
 */
async function compterRdvRecouverts({
  Booking, currentCompany, date, startTimeInMinutes, endTimeInMinutes, employeeId, excludeBookingId,
}) {
  const critere = {
    company: currentCompany._id || currentCompany,
    date: new Date(date),
    status: { $ne: "canceled" },
    isBlock: { $ne: true },
  };
  if (excludeBookingId) critere._id = { $ne: excludeBookingId };
  // Absence visant un praticien précis : seuls SES rendez-vous sont concernés.
  // Absence pour tout l'établissement : tous le sont.
  if (employeeId) critere.$or = [{ employee: employeeId }, { employee: null }];

  const rdv = await Booking.find(critere).select("startTime slotTime name").lean();
  return rdv.filter((b) => {
    const [h, m] = String(b.startTime || "00:00").split(":").map(Number);
    const debut = h * 60 + m;
    const fin = debut + (b.slotTime || 0);
    return startTimeInMinutes < fin && endTimeInMinutes > debut;
  }).length;
}

exports.createAdminBlock = async (req, res) => {
  try {
    const currentCompany = res.locals.currentCompany;
    if (!currentCompany) return res.status(401).json({ success: false, error: "unauthorized" });

    const { date, startTime, endTime, note } = req.body;
    let { employeeId } = req.body;
    if (!date || !startTime || !endTime) {
      return res.json({ success: false, error: "missing_fields", message: "Date et horaires requis." });
    }

    const Booking = require("../db/models/book.model");

    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const startTimeInMinutes = sh * 60 + sm;
    const endTimeInMinutes = eh * 60 + em;
    if (!(endTimeInMinutes > startTimeInMinutes)) {
      return res.json({ success: false, error: "invalid_range", message: "L'heure de fin doit être après l'heure de début." });
    }
    const actualDuration = endTimeInMinutes - startTimeInMinutes;

    let employeeName = "";
    if (employeeId) {
      const team = await getBookableTeam(currentCompany);
      const emp = team.find((m) => m.id === String(employeeId));
      // Praticien inconnu de cette équipe (id falsifié / autre établissement) →
      // on n'enregistre PAS cet id, comme dans createAdminBooking : sinon le
      // bloc affichait le nom et la photo d'un membre d'un autre établissement.
      if (emp) employeeName = `${emp.firstName} ${emp.lastName}`.trim();
      else employeeId = null;
    }

    // Une absence PEUT recouvrir des rendez-vous déjà pris — c'est même son
    // usage principal : « je ferme la journée, mais j'honore ce qui est
    // réservé ». On ne refuse donc jamais la création, contrairement à un vrai
    // rendez-vous. Les réservations existantes ne sont NI annulées NI touchées :
    // le bloc est un document séparé, posé par-dessus.
    // Il empêche en revanche toute NOUVELLE réservation sur ce créneau, puisque
    // checkBookingConflict le voit comme un créneau occupé.
    const recouverts = await compterRdvRecouverts({
      Booking, currentCompany, date, startTimeInMinutes, endTimeInMinutes, employeeId,
    });

    const block = await Booking.create({
      date: new Date(date),
      startTime,
      endTime,
      company: currentCompany,
      name: "Absent",
      message: (note || "").trim().slice(0, 200),
      slotTime: actualDuration,
      status: "confirmed",
      isBlock: true,
      employee: employeeId || null,
      employeeName,
      payment: { method: "none", status: "none", amount: 0, currency: "eur" },
    });

    res.json({ success: true, bookingId: block._id, coveredBookings: recouverts });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.json({ success: false, error: "duplicate",
        message: "Une absence existe déjà à cette heure exacte pour ce praticien." });
    }
    console.error("createAdminBlock error:", err);
    res.status(500).json({ success: false, error: "server_error", message: "Une erreur est survenue." });
  }
};

// ── Modifier une absence déjà posée ─────────────────────────────────────────
// Il fallait supprimer puis recréer pour corriger un horaire ou un motif.
// Mêmes règles que la création (chevauchements, employé de l'équipe), à une
// exception près : l'absence ne doit pas se considérer elle-même comme un
// conflit, d'où `excludeBookingId`.
exports.updateAdminBlock = async (req, res) => {
  try {
    const currentCompany = res.locals.currentCompany;
    if (!currentCompany) return res.status(401).json({ success: false, error: "unauthorized" });

    const Booking = require("../db/models/book.model");
    // Filtré sur l'établissement courant ET sur isBlock : cette route ne doit
    // jamais permettre de modifier un vrai rendez-vous, ni celui d'un autre
    // établissement.
    const block = await Booking.findOne({
      _id: req.params.id,
      company: currentCompany._id || currentCompany,
      isBlock: true,
    });
    if (!block) {
      return res.status(404).json({ success: false, error: "not_found", message: "Absence introuvable." });
    }

    const { date, startTime, endTime, note } = req.body;
    let { employeeId } = req.body;
    if (!date || !startTime || !endTime) {
      return res.json({ success: false, error: "missing_fields", message: "Date et horaires requis." });
    }

    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const startTimeInMinutes = sh * 60 + sm;
    const endTimeInMinutes = eh * 60 + em;
    if (!(endTimeInMinutes > startTimeInMinutes)) {
      return res.json({ success: false, error: "invalid_range", message: "L'heure de fin doit être après l'heure de début." });
    }
    const actualDuration = endTimeInMinutes - startTimeInMinutes;

    let employeeName = "";
    if (employeeId) {
      const team = await getBookableTeam(currentCompany);
      const emp = team.find((m) => m.id === String(employeeId));
      if (emp) employeeName = `${emp.firstName} ${emp.lastName}`.trim();
      else employeeId = null;
    }

    // Comme à la création : une absence peut recouvrir des rendez-vous pris,
    // sans jamais les annuler. On se contente de les compter pour l'informer.
    const recouverts = await compterRdvRecouverts({
      Booking, currentCompany, date, startTimeInMinutes, endTimeInMinutes, employeeId,
      excludeBookingId: block._id,
    });

    block.date = new Date(date);
    block.startTime = startTime;
    block.endTime = endTime;
    block.slotTime = actualDuration;
    block.message = (note || "").trim().slice(0, 200);
    block.employee = employeeId || null;
    block.employeeName = employeeName;
    await block.save();

    res.json({ success: true, bookingId: block._id, coveredBookings: recouverts });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.json({ success: false, error: "duplicate",
        message: "Une absence existe déjà à cette heure exacte pour ce praticien." });
    }
    console.error("updateAdminBlock error:", err);
    res.status(500).json({ success: false, error: "server_error", message: "Une erreur est survenue." });
  }
};

const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const User = require("../db/models/user.model");
const { addEventToCalendar, deleteEventFromCalendar, updateEventInCalendar, getBusyIntervals } = require("../utils/googleCalendarSync");
const { logActivity } = require("../utils/activityLog");

// Ces routes de gestion des RDV (cancel/delete/restore) n'ont pas
// `injectCompany` dans leur chaîne de middlewares (cf. routes/admin.js) — on
// doit donc déterminer nous-même le rôle de l'acteur pour le log.
async function resolveActorRole(companyDoc, user) {
  if (!companyDoc || !user) return "";
  if (String(companyDoc.owner) === String(user._id)) return "owner";
  const membership = await CompanyMembership.findOne({ company: companyDoc._id, user: user._id, status: "accepted" }).lean();
  return (membership && membership.role) || "";
}

async function getSlotTime(companyId) {
  const res = await Company.findById(companyId).select("slotTime").lean();

  return res?.slotTime;
}

async function getSlotConfig(companyId) {
  const res = await Company.findById(companyId)
    .select("bufferTime bufferBefore bufferAfter slotMode slotInterval")
    .lean();

  return {
    bufferBefore: res?.bufferBefore ?? res?.bufferTime ?? 0,
    bufferAfter:  res?.bufferAfter  ?? res?.bufferTime ?? 0,
    slotMode:     res?.slotMode || "fixed",
    slotInterval: res?.slotInterval || 30,
  };
}

async function getDaysOff(companyId) {
  const doc = await DaysOff.findOne({ company: companyId })
    .populate("dates.employees", "fullName")
    .lean();

  if (!doc) return { dates: [] };

  const today = new Date();
  today.setHours(0, 0, 0, 0); // ignore l'heure

  doc.dates = doc.dates
    .filter((d) => new Date(d.date) >= today) // garde seulement futur / aujourd'hui
    .sort((a, b) => new Date(a.date) - new Date(b.date)); // tri proche → loin

  return doc;
}
exports.availability = async (req, res) => {
  const currentCompany = res.locals.currentCompany;
  if (!currentCompany) {
    // Cf. exports.appointment ci-dessus : jamais /register pour un compte
    // déjà connecté (boucle de redirection infinie avec GET /register).
    return res.redirect("/etablissement/mes-etablissements");
  }
  const Service  = require("../db/models/company/service.model");
  const [daysOff, currentSlotTime, slotConfig, serviceCount, activeEmployees, companyDoc] = await Promise.all([
    getDaysOff(currentCompany),
    getSlotTime(currentCompany),
    getSlotConfig(currentCompany),
    Service.countDocuments({ company: currentCompany, active: true }),
    getBookableTeam(currentCompany._id),
    Company.findById(currentCompany._id).select("smartGrouping minBookingLeadTime scheduleMode owner ownerEmployeeProfile.schedule bookingHorizonDays autoConfirm waitlistEnabled allowOverbooking").lean(),
  ]);
  const availFeatures = getLimit("availability", res.locals.billingUser);

  // ── Horaire individuel (cf. plan grades/permissions) ───────────────────────
  // En mode "perEmployee", l'horaire affiché/édité dans la carte hebdomadaire
  // existante devient celui de l'employé sélectionné (`?employeeId=`) au lieu
  // du Company.schedule commun — on substitue juste `currentCompany.schedule`
  // pour cette requête, le reste du template (et son JS) ne change pas.
  const scheduleMode = companyDoc?.scheduleMode === "perEmployee" ? "perEmployee" : "shared";
  let selectedEmployeeId = scheduleMode === "perEmployee" ? (req.query.employeeId || String(req.user._id)) : "shared";
  let renderedCompany = currentCompany;

  // Self-service : un employé qui n'a pas le droit de gérer l'horaire des
  // autres (ni l'horaire commun) ne peut voir/éditer QUE le sien — jamais le
  // sélecteur ni le toggle "horaire commun" (cf. plan, "page auto-scopée").
  const canManageShared = !!res.locals.permissions?.availability?.manageShared;
  const canManageOthersSchedule = !!res.locals.permissions?.availability?.manageOthersSchedule;
  if (scheduleMode === "perEmployee" && !canManageShared && !canManageOthersSchedule) {
    selectedEmployeeId = String(req.user._id);
  }

  if (scheduleMode === "perEmployee" && selectedEmployeeId !== "shared") {
    let individualSchedule;
    if (String(companyDoc.owner) === String(selectedEmployeeId)) {
      individualSchedule = companyDoc.ownerEmployeeProfile?.schedule;
    } else {
      const membership = await CompanyMembership.findOne({ company: currentCompany._id, user: selectedEmployeeId })
        .select("schedule").lean();
      individualSchedule = membership?.schedule;
    }
    // Pas encore configuré → retombe sur le commun (cf. plan, "vide = pas
    // configuré"), mais reste affiché/édité comme étant CET employé (le
    // premier edit le copiera implicitement dans son propre schedule via
    // editAvailabilty/toggleDay ci-dessus, qui ciblent déjà schedule.$ —
    // si le tableau est vide il n'y a rien à $ matcher : on initialise donc
    // ici si besoin).
    if (!individualSchedule || individualSchedule.length === 0) {
      individualSchedule = currentCompany.schedule;
      if (String(companyDoc.owner) === String(selectedEmployeeId)) {
        await Company.updateOne({ _id: currentCompany._id }, { $set: { "ownerEmployeeProfile.schedule": individualSchedule } });
      } else {
        await CompanyMembership.updateOne({ company: currentCompany._id, user: selectedEmployeeId }, { $set: { schedule: individualSchedule } });
      }
    }
    renderedCompany = Object.assign({}, currentCompany, { schedule: individualSchedule });
  }

  const canManageOwnSchedule = !!res.locals.permissions?.availability?.manageOwnSchedule;
  const isOwnEmployee = selectedEmployeeId === String(req.user._id);
  let canEditSchedule;
  if (scheduleMode === "shared") {
    canEditSchedule = canManageShared;
  } else if (selectedEmployeeId === "shared") {
    canEditSchedule = canManageShared;
  } else if (isOwnEmployee) {
    canEditSchedule = canManageOwnSchedule || canManageOthersSchedule;
  } else {
    canEditSchedule = canManageOthersSchedule;
  }

  res.render(res.locals._availView || "admin/availability", {
    daysOff,
    employees: activeEmployees,
    currentCompany: renderedCompany,
    scheduleMode,
    selectedEmployeeId,
    canEditSchedule,
    pageName: "Availability",
    title: res.locals.t.titles.avail,
    timeSlot: [10, 15, 20, 25, 30, 45, 60, 90, 120, 180],
    // Pas de 5 min : 12:25, 10:05, 08:45… sont des horaires d'ouverture
    // courants. Au pas de 10 ils étaient tout simplement impossibles à choisir.
    hours: generateHours(5),
    currentSlotTime,
    bufferBefore: slotConfig.bufferBefore,
    bufferAfter: slotConfig.bufferAfter,
    slotMode: slotConfig.slotMode,
    slotInterval: slotConfig.slotInterval,
    hasServices: serviceCount > 0,
    availFeatures,
    smartGrouping: Object.assign({ enabled: false, windowHours: 3, weekdays: [] }, companyDoc?.smartGrouping || {}),
    minBookingLeadTime: companyDoc?.minBookingLeadTime || { enabled: false, minutes: 60 },
    // Règles de réservation. `lean()` n'applique pas les valeurs par défaut du
    // schéma aux documents qui n'ont pas encore le champ : on les repose ici,
    // sinon un établissement d'avant ces réglages afficherait « confirmation
    // automatique désactivée » alors qu'elle est bien active.
    bookingRules: {
      bookingHorizonDays: Number(companyDoc?.bookingHorizonDays) || 0,
      autoConfirm: companyDoc?.autoConfirm !== false,
      waitlistEnabled: companyDoc?.waitlistEnabled === true,
      allowOverbooking: companyDoc?.allowOverbooking === true,
    },
    // Réglages portés par le compte (téléphone obligatoire, messages d'emails…).
    calendarSettings: req.user?.calendarSettings || {},
  });
};

// Ancienne page Disponibilités, conservée « dans l'ombre » sur /availability-old
// au cas où : mêmes données, seul le template (et son CSS) diffère. Le design
// actuel est servi par exports.availability ci-dessus (admin/availability).
exports.availabilityOld = async (req, res) => {
  res.locals._availView = "admin/availability-old";
  return exports.availability(req, res);
};

function generateHours(step = 60) {
  // comprendre cette function
  const hours = [];

  for (let i = 0; i < 24 * 60; i += step) {
    const h = String(Math.floor(i / 60)).padStart(2, "0");
    const m = String(i % 60).padStart(2, "0");
    hours.push(`${h}:${m}`);
  }

  return hours;
}

// Quand `employeeId` est fourni (et différent de "shared") ET que la company
// est en mode "perEmployee", l'édition cible le `schedule` individuel de cet
// employé (Company.ownerEmployeeProfile.schedule pour le patron,
// CompanyMembership.schedule sinon) au lieu du Company.schedule commun —
// cf. plan grades/permissions, horaires individuels.
async function resolveScheduleUpdateTarget(companyId, employeeId) {
  if (!employeeId || employeeId === "shared") return null;
  const company = await Company.findById(companyId).select("owner scheduleMode").lean();
  if (!company || company.scheduleMode !== "perEmployee") return null;
  if (String(company.owner) === String(employeeId)) return { kind: "owner" };
  return { kind: "membership", companyId, employeeId };
}

exports.toggleDay = async (req, res) => {
  const { weekdayIndex, companyId, dayOff, employeeId } = req.body;
  const wdIndex = Number(weekdayIndex);

  const target = await resolveScheduleUpdateTarget(companyId, employeeId);
  if (target?.kind === "owner") {
    await Company.updateOne(
      { _id: companyId, "ownerEmployeeProfile.schedule.weekdayIndex": wdIndex },
      { $set: { "ownerEmployeeProfile.schedule.$.dayOff": dayOff } }
    );
  } else if (target?.kind === "membership") {
    // Initialise le schedule individuel depuis le commun si vide (lazy copy)
    const mem = await CompanyMembership.findOne({ company: target.companyId, user: target.employeeId }).select("schedule").lean();
    if (!mem?.schedule?.length) {
      const co = await Company.findById(target.companyId).select("schedule").lean();
      await CompanyMembership.updateOne(
        { company: target.companyId, user: target.employeeId },
        { $set: { schedule: co?.schedule || [] } }
      );
    }
    await CompanyMembership.updateOne(
      { company: target.companyId, user: target.employeeId, "schedule.weekdayIndex": wdIndex },
      { $set: { "schedule.$.dayOff": dayOff } }
    );
  } else {
    await Company.updateOne(
      { _id: companyId, "schedule.weekdayIndex": wdIndex },
      { $set: { "schedule.$.dayOff": dayOff } }
    );
  }

  res.json({ success: true });
};

exports.editAvailabilty = async (req, res) => {
  const { weekdayIndex, companyId, workingHours, employeeId } = req.body;
  const wdIndex = Number(weekdayIndex);

  if (!workingHours || workingHours.length === 0) {
    return res.json({ success: false, message: "No working hours provided" });
  }

  // Format strictement "HH:MM", fin après début. Sans ce contrôle, une heure
  // vide enregistrée ici (un clic sur une entrée de liste sans libellé suffit)
  // se propageait jusqu'au calendrier : parseInt("") = NaN, plage horaire NaN,
  // et la grille ne s'affichait plus DU TOUT, sur toutes les semaines, sans
  // aucune erreur visible. Une donnée invalide ne doit jamais entrer en base.
  const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const toMinutes = (t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const invalid = workingHours.some(
    (wh) =>
      !wh ||
      !HHMM.test(String(wh.start || "")) ||
      !HHMM.test(String(wh.end || "")) ||
      toMinutes(wh.end) <= toMinutes(wh.start)
  );
  if (invalid) {
    return res.json({ success: false, message: "Horaires invalides : vérifiez l'heure de début et de fin." });
  }

  const target = await resolveScheduleUpdateTarget(companyId, employeeId);
  if (target?.kind === "owner") {
    await Company.updateOne(
      { _id: companyId, "ownerEmployeeProfile.schedule.weekdayIndex": wdIndex },
      { $set: { "ownerEmployeeProfile.schedule.$.workingHours": workingHours } }
    );
  } else if (target?.kind === "membership") {
    // Initialise le schedule individuel depuis le commun si vide (lazy copy)
    const mem = await CompanyMembership.findOne({ company: target.companyId, user: target.employeeId }).select("schedule").lean();
    if (!mem?.schedule?.length) {
      const co = await Company.findById(target.companyId).select("schedule").lean();
      await CompanyMembership.updateOne(
        { company: target.companyId, user: target.employeeId },
        { $set: { schedule: co?.schedule || [] } }
      );
    }
    await CompanyMembership.updateOne(
      { company: target.companyId, user: target.employeeId, "schedule.weekdayIndex": wdIndex },
      { $set: { "schedule.$.workingHours": workingHours } }
    );
  } else {
    await Company.updateOne(
      { _id: companyId, "schedule.weekdayIndex": wdIndex },
      { $set: { "schedule.$.workingHours": workingHours } }
    );
  }

  res.json({ success: true });
};

exports.editSlotTime = async (req, res) => {
  try {
    const { slot } = req.body;
    const companyId = res.locals.currentCompany._id;

    await Company.findByIdAndUpdate(companyId, {
      slotTime: slot,
    });

    res.json({ success: true });
  } catch (err) {
    res.json({ error: err });
  }
};

exports.deleteBooking = async (req, res) => {
  if (!atLeast(res.locals.billingUser, "pro")) {
    return res.status(403).json({ error: "plan_limit", message: "Nécessite un abonnement Pro ou Business." });
  }
  const { bookId } = req.params;

  // IDOR : la requête est scopée à l'établissement courant — un RDV d'un autre
  // établissement n'est jamais trouvé, donc jamais supprimé.
  const data = await Booking.findOneAndDelete({ _id: bookId, company: res.locals.currentCompany?._id });

  if (data) {
    // Le client doit survivre à la suppression de son rendez-vous.
    await preserveClient(res.locals.currentCompany?._id, data).catch(() => {});
    const companyDoc = await Company.findById(data.company);

    // Sync Google Calendar
    if (data.googleEventId) {
      try {
        const owner = await User.findById(companyDoc?.owner);
        if (owner?.googleCalendar?.connected && owner.googleCalendar.refreshToken) {
          await deleteEventFromCalendar(owner.googleCalendar.refreshToken, data.googleEventId);
        }
      } catch (gcalErr) {
        console.error("Google Calendar sync error (delete):", gcalErr.message);
      }
    }

    logActivity({
      company: data.company,
      user: req.user,
      role: await resolveActorRole(companyDoc, req.user),
      action: "booking.delete",
      description: `a supprimé le RDV de ${data.name || ""} ${data.surname || ""}`.trim(),
    });
  }

  res.json({ success: true, data });
};

exports.restoreBooking = async (req, res) => {
  if (!atLeast(res.locals.billingUser, "pro")) {
    return res.status(403).json({ error: "plan_limit", message: "Nécessite un abonnement Pro ou Business." });
  }
  try {
    const { bookId } = req.params;

    // IDOR : scopé à l'établissement courant.
    const booking = await Booking.findOneAndUpdate({ _id: bookId, company: res.locals.currentCompany?._id }, { status: "confirmed" }, { new: true }).lean();

    if (booking) {
      const companyDoc = await Company.findById(booking.company);

      // Sync Google Calendar : recréer l'événement et sauvegarder le nouvel ID
      try {
        const owner = await User.findById(companyDoc?.owner);
        if (owner?.googleCalendar?.connected && owner.googleCalendar.refreshToken) {
          const eventId = await addEventToCalendar(owner.googleCalendar.refreshToken, booking);
          if (eventId) {
            await Booking.findByIdAndUpdate(bookId, { googleEventId: eventId });
          }
        }
      } catch (gcalErr) {
        console.error("Google Calendar sync error (restore):", gcalErr.message);
      }

      logActivity({
        company: booking.company,
        user: req.user,
        role: await resolveActorRole(companyDoc, req.user),
        action: "booking.restore",
        description: `a restauré le RDV de ${booking.name || ""} ${booking.surname || ""}`.trim(),
      });
    }

    res.json({ success: true });
  } catch (err) {
    if (err.code === 11000) {
      return res.json({
        success: false,
        message: "Impossible de restaurer : ce créneau horaire est déjà occupé par une autre réservation.",
      });
    }
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Une erreur est survenue lors de la restauration.",
    });
  }
};

exports.cancelBooking = async (req, res) => {
  if (!atLeast(res.locals.billingUser, "pro")) {
    return res.status(403).json({ error: "plan_limit", message: "Nécessite un abonnement Pro ou Business." });
  }
  const { id } = req.params;

  // IDOR : scopé à l'établissement courant — impossible d'annuler (et donc
  // d'envoyer un email au client) le RDV d'un autre établissement.
  const booking = await Booking.findOneAndUpdate({ _id: id, company: res.locals.currentCompany?._id }, { status: "canceled" }, { new: false }).lean();

  // Déclaré ici et non dans le `if` : l'envoi de l'email plus bas en a besoin
  // aussi, pour retrouver le propriétaire (porteur des réglages).
  let companyDoc = null;

  if (booking) {
    companyDoc = await Company.findById(booking.company);

    // Sync Google Calendar
    if (booking.googleEventId) {
      try {
        const owner = await User.findById(companyDoc?.owner);
        if (owner?.googleCalendar?.connected && owner.googleCalendar.refreshToken) {
          await deleteEventFromCalendar(owner.googleCalendar.refreshToken, booking.googleEventId);
        }
      } catch (gcalErr) {
        console.error("Google Calendar sync error (admin cancel):", gcalErr.message);
      }
    }

    logActivity({
      company: booking.company,
      user: req.user,
      role: await resolveActorRole(companyDoc, req.user),
      action: "booking.cancel",
      description: `a annulé le RDV de ${booking.name || ""} ${booking.surname || ""}`.trim(),
    });
  }

  // Send cancellation email to the client
  if (booking?.email) {
    try {
      // Message libre du pro (Personnaliser > Rappels). Le propriétaire de
      // l'établissement porte les réglages, pas l'acteur qui annule : un
      // collaborateur qui annule doit envoyer le même message.
      const proprietaire = await User.findById(companyDoc?.owner).select("calendarSettings.cancellationMessage").lean();
      const cancelHtml = pug.renderFile(path.join(__dirname, "../views/templates/emails/booking-cancelled.pug"), {
        name:      booking.name     || "",
        surname:   booking.surname  || "",
        date:      booking.date,
        startHour: booking.startTime || "",
        endHour:   booking.endTime   || "",
        ownerMessage: (proprietaire?.calendarSettings?.cancellationMessage || "").trim(),
      });
      await sendEmail(booking.email, "Votre rendez-vous a été annulé", cancelHtml);
    } catch (mailErr) {
      console.error("Cancel email error:", mailErr.message);
    }
  }

  res.json({ success: true });
};

exports.sendManualReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const Service = require("../db/models/company/service.model");

    const booking = await Booking.findById(id).lean();
    if (!booking) return res.status(404).json({ error: "Rendez-vous introuvable." });
    if (!booking.email) return res.status(400).json({ error: "Ce rendez-vous n'a pas d'adresse email." });
    if (booking.status !== "confirmed") return res.status(400).json({ error: "Le rendez-vous doit être confirmé." });

    // Verify ownership
    const companyDoc = await Company.findById(booking.company).lean();
    if (!companyDoc || String(companyDoc.owner) !== String(req.user._id)) {
      return res.status(403).json({ error: "Accès refusé." });
    }

    // `company` : désigne l'établissement d'origine, seul à bénéficier du repli
    // du compte pour l'adresse et le téléphone (establishmentIdentity).
    const owner = await User.findById(companyDoc.owner)
      .select("company calendarSettings location phone isPremium manualPremium subscription businessName phonePro")
      .lean();

    // Gate sur le forfait de L'ÉTABLISSEMENT, comme partout ailleurs.
    if (!atLeast(billingUserFor(companyDoc, owner), "pro")) {
      return res.status(403).json({ error: "plan_limit", message: "Nécessite un abonnement Pro ou Business." });
    }

    // Service category lookup
    let serviceCategory = "";
    if (booking.service) {
      try {
        const svc = await Service.findById(booking.service).select("category").lean();
        serviceCategory = svc?.category || "";
      } catch (_) {}
    }

    const servicePrice = booking.payment?.amount ? Number(booking.payment.amount) : null;
    const ownerMessage = (owner?.calendarSettings?.reminderMessage || "").trim();
    const paymentMethods = Array.isArray(owner?.calendarSettings?.reminderPaymentMethods)
      ? owner.calendarSettings.reminderPaymentMethods : [];
    const paymentNote = (owner?.calendarSettings?.reminderPaymentNote || "").trim();

    // Adresse et téléphone de l'ÉTABLISSEMENT du rendez-vous, pas du compte :
    // un rappel manuel envoyait sinon le client à l'adresse du premier
    // établissement du patron.
    const identity = identityFor(companyDoc, owner);
    const loc = identity.location;
    let locationText = "";
    if (loc?.serviceType === "en_ligne") {
      locationText = "En ligne";
    } else if (loc?.address || loc?.city) {
      locationText = [loc.address, loc.city].filter(Boolean).join(", ");
    }

    // Nom de l'ÉTABLISSEMENT (repli compte pour les fiches historiques).
    const businessName = (companyDoc?.name || owner?.businessName || "").trim();
    const businessPhone = (identity.phonePro || "").trim();

    const formattedDate = new Date(booking.date).toLocaleDateString("fr-FR", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    });

    const templatePath = path.join(__dirname, "../views/templates/emails/booking-reminder.pug");
    const html = pug.renderFile(templatePath, {
      name: booking.name || "",
      surname: booking.surname || "",
      date: booking.date,
      formattedDate,
      startHour: booking.startTime,
      endHour: booking.endTime,
      slotTime: booking.slotTime,
      serviceName: booking.serviceName || "",
      serviceCategory,
      servicePrice,
      employeeName: booking.employeeName || "",
      locationText,
      formAnswers: (Array.isArray(booking.formAnswers) ? booking.formAnswers : []).filter(
        (a) => a.required || (a.answer !== undefined && a.answer !== null && String(a.answer).trim() !== "")
      ),
      message: booking.message || "",
      ownerMessage,
      paymentMethods,
      paymentNote,
      businessName,
      businessPhone,
      delayLabel: "bientôt",
      bookingId: booking._id,
      cancelToken: booking.cancelToken,
      baseUrl: (process.env.BASE_URL || "https://www.branshee.com").replace(/\/$/, ""),
    });

    const ok = await sendEmail(booking.email, "Rappel : votre rendez-vous — BranShee", html);
    if (!ok) return res.status(500).json({ error: "Échec de l'envoi de l'email." });

    await Booking.findByIdAndUpdate(id, { manualReminderSent: true, reminderSent: true });
    return res.json({ success: true });
  } catch (err) {
    console.error("sendManualReminder error:", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.updateBookingEmployee = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { employeeId } = req.body;

    let updateFields = {};

    if (employeeId) {
      const emp = await User.findById(employeeId).select("fullName").lean();
      if (!emp) return res.json({ success: false, error: "Employé introuvable." });
      updateFields.employee     = emp._id;
      updateFields.employeeName = (emp.fullName || "").trim();
    } else {
      updateFields.employee     = null;
      updateFields.employeeName = "";
    }

    // IDOR : scopé à l'établissement courant.
    const updated = await Booking.findOneAndUpdate({ _id: bookId, company: res.locals.currentCompany?._id }, updateFields);
    if (!updated) return res.status(404).json({ success: false, error: "Rendez-vous introuvable." });
    return res.json({ success: true, employeeId: employeeId || null, employeeName: updateFields.employeeName });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, error: err.message });
  }
};

exports.getWeekData = async (req, res) => {
  const currentCompany = res.locals.currentCompany;
  if (!currentCompany) {
    // Cf. exports.appointment ci-dessus : jamais /register pour un compte
    // déjà connecté (boucle de redirection infinie avec GET /register).
    return res.redirect("/etablissement/mes-etablissements");
  }
  const referenceDate = new Date(req.query.date);

  const weekDays = getWeekDays(referenceDate);

  const apps = await GetAllAppointments(currentCompany);

  res.json({
    weekDays,
    appointments: apps,
  });
};

exports.informationsPage = async (req, res) => {
  const email = req.user.email;
  const maskEmail = email.replace(/^(..)(.*)(?=@)/, "$1...");
  const canUseSocial    = getLimit("socialLinks", res.locals.billingUser);
  const canUseCustomUrl = require("../utils/planLimits").LIMITS.customUrl.hasFeature(res.locals.billingUser);
  const cs = req.user.calendarSettings || {};

  // ── Stripe : cartes & factures ──────────────────────────────────────────
  let paymentMethods = [];
  let invoices       = [];
  const stripeCustomerId = req.user.subscription?.stripeCustomerId;
  if (stripeCustomerId) {
    try {
      const [pmsResult, invResult, customer] = await Promise.all([
        stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card", limit: 10 }),
        stripe.invoices.list({ customer: stripeCustomerId, limit: 12 }),
        stripe.customers.retrieve(stripeCustomerId),
      ]);

      // Trouver la carte par défaut (customer invoice_settings ou abonnement)
      let defaultPmId = customer.invoice_settings?.default_payment_method || null;
      if (!defaultPmId && req.user.subscription?.stripeSubscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(req.user.subscription.stripeSubscriptionId);
          defaultPmId = sub.default_payment_method || null;
        } catch (_) {}
      }
      // Si aucune défaut explicite mais une seule carte → c'est elle la défaut
      if (!defaultPmId && pmsResult.data.length === 1) {
        defaultPmId = pmsResult.data[0].id;
      }

      paymentMethods = pmsResult.data.map((pm) => ({
        id:        pm.id,
        brand:     pm.card.brand,
        last4:     pm.card.last4,
        expMonth:  pm.card.exp_month,
        expYear:   pm.card.exp_year,
        isDefault: pm.id === defaultPmId,
      }));
      invoices = invResult.data.map((inv) => ({
        id:          inv.id,
        date:        inv.created,
        description: inv.description || (inv.lines?.data?.[0]?.description) || "Abonnement BranShee",
        amount:      ((inv.amount_paid || inv.amount_due || 0) / 100).toFixed(2),
        currency:    (inv.currency || "eur").toUpperCase(),
        status:      inv.status,
        pdfUrl:      inv.invoice_pdf,
        hostedUrl:   inv.hosted_invoice_url,
      }));
    } catch (e) {
      console.error("Stripe billing fetch error:", e.message);
    }
  }

  res.render("admin/informations", {
    pageName: "Informations",
    success: req.query.success,
    title: res.locals.t.titles.infos,
    maskEmail,
    currentCompany: res.locals.currentCompany,
    canUseSocial,
    canUseCustomUrl,
    cs,
    gallery:             cs.gallery   || [],
    equipment:           cs.equipment || [],
    isPro:               res.locals.isPro,
    paymentMethods,
    invoices,
    stripePublishableKey: env.stripePublishableKey || "",
  });
};

// ── Helper : récupérer les cartes enregistrées d'un utilisateur (Stripe) ─────
// Utilisé sur /subscription pour proposer "payer avec la carte X ou en
// changer" + le récap avant paiement, au lieu de débiter instantanément
// dès qu'une carte existe ("c'est abusé, faut demander avant").
exports.getUserPaymentMethods = async function (user) {
  const stripeCustomerId = user?.subscription?.stripeCustomerId;
  if (!stripeCustomerId) return [];
  try {
    const [pmsResult, customer] = await Promise.all([
      stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card", limit: 10 }),
      stripe.customers.retrieve(stripeCustomerId),
    ]);

    let defaultPmId = customer.invoice_settings?.default_payment_method || null;
    if (!defaultPmId && user.subscription?.stripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(user.subscription.stripeSubscriptionId);
        defaultPmId = sub.default_payment_method || null;
      } catch (_) {}
    }
    if (!defaultPmId && pmsResult.data.length === 1) {
      defaultPmId = pmsResult.data[0].id;
    }

    return pmsResult.data.map((pm) => ({
      id:        pm.id,
      brand:     pm.card.brand,
      last4:     pm.card.last4,
      expMonth:  pm.card.exp_month,
      expYear:   pm.card.exp_year,
      isDefault: pm.id === defaultPmId,
    }));
  } catch (e) {
    console.error("getUserPaymentMethods error:", e.message);
    return [];
  }
};

exports.historyInit = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const requestedLimit = parseInt(req.query.limit);
    // Le client mesure la hauteur d'écran dispo et redemande la page avec le
    // nombre de lignes qui y tient réellement (cf. history.js) — bornes de
    // sécurité pour éviter un paramètre absurde/abusif.
    const limit = Number.isFinite(requestedLimit) ? Math.min(50, Math.max(5, requestedLimit)) : 13;
    const skip = (page - 1) * limit;

    const now = new Date();
    const query = {
      company: res.locals.currentCompany._id,
      isBlock: { $ne: true },
    };

    const history = await Booking.find(query).sort({ date: -1, startTime: 1 }).skip(skip).limit(limit).populate("user");

    const totalBookings = await Booking.countDocuments(query);
    const totalPages = Math.ceil(totalBookings / limit);
    console.log(`totalBookings: ${totalBookings}`);
    console.log(`totalPages: ${totalPages}`);

    return res.render("admin/history", {
      pageName: "History",
      title: res.locals.t.titles.history,
      history,
      currentPage: page,
      currentLimit: limit,
      totalBookings,
      totalPages,
    });
  } catch (err) {
    console.log(history);
    return res.send(err);
  }
};

// ── Clients (nouvelle page unifiée) ─────────────────────────────────────────
// À terme : fusion de l'Historique et des Dossiers clients dans une seule page
// (cf. maquettes healthcare). On affiche la liste des CLIENTS uniques ayant pris
// au moins un RDV (regroupés par email, sinon téléphone, sinon nom), pas un RDV
// par ligne. On ne touche pas aux pages /history et /clients existantes.
exports.clientsHubInit = async (req, res) => {
  try {
    const query = {
      company: res.locals.currentCompany._id,
      isBlock: { $ne: true },
    };

    // date décroissante → le RDV le plus récent d'abord (pour « dernier RDV »).
    const bookings = await Booking.find(query)
      .sort({ date: -1, startTime: -1 })
      .lean();

    const stateOf = (b) => {
      const s = (b.status || "confirmed").toLowerCase();
      return b.noShow ? "noshow" : (s === "canceled" || s === "cancelled") ? "canceled" : "confirmed";
    };

    // Regroupement par client.
    const map = new Map();
    for (const b of bookings) {
      const key =
        (b.email && b.email.trim().toLowerCase()) ||
        (b.phone && b.phone.trim()) ||
        (((b.name || "") + " " + (b.surname || "")).trim().toLowerCase()) ||
        String(b._id);

      let c = map.get(key);
      if (!c) {
        // 1er RDV rencontré = le plus récent (tri desc) → sert de « dernier RDV ».
        c = {
          name: b.name || "",
          surname: b.surname || "",
          email: b.email || "",
          phone: b.phone || "",
          ids: [],
          count: 0,
          lastDate: b.date,
          lastTime: b.startTime || "",
          lastState: stateOf(b),
          lastBookingId: String(b._id),
          empCounts: {},
        };
        map.set(key, c);
      }
      c.ids.push(String(b._id));
      c.count++;
      if (b.employeeName) c.empCounts[b.employeeName] = (c.empCounts[b.employeeName] || 0) + 1;
      // Compléter les infos manquantes à partir d'un RDV plus ancien si besoin.
      if (!c.name && b.name) c.name = b.name;
      if (!c.surname && b.surname) c.surname = b.surname;
      if (!c.email && b.email) c.email = b.email;
      if (!c.phone && b.phone) c.phone = b.phone;
    }

    const clients = Array.from(map.values()).map((c) => {
      let emp = "", max = 0;
      for (const [k, v] of Object.entries(c.empCounts)) if (v > max) { max = v; emp = k; }
      return {
        name: c.name,
        surname: c.surname,
        email: c.email,
        phone: c.phone,
        ids: c.ids,
        count: c.count,
        lastDate: c.lastDate,
        lastTime: c.lastTime,
        lastState: c.lastState,
        lastBookingId: c.lastBookingId,
        employeeName: emp,
      };
    });
    // Les dossiers portent deux choses utiles ici : le surnom (altName) affiché
    // à côté du nom, et les clients créés à la main — qui n'ont AUCUN rendez-vous
    // et n'existent donc dans aucun Booking.
    const ClientDossier = require("../db/models/clientDossier.model");
    const dossiers = await ClientDossier.find({ company: res.locals.currentCompany._id })
      .select("email altName fullName firstName lastName phone createdAt createdManually hadBookings clientKey").lean();

    const altMap = {};
    dossiers.forEach((d) => { if (d.altName) altMap[d.email] = d.altName; });
    clients.forEach((c) => { c.altName = altMap[(c.email || "").trim().toLowerCase()] || ""; });

    // Indexé par CLÉ et non par e-mail : un client sans adresse aurait sinon
    // été considéré comme absent, et se serait affiché deux fois — une fois
    // via ses rendez-vous, une fois via son dossier.
    const dejaListes = new Set(
      clients
        .map((c) => dossierKey({ email: c.email, phone: c.phone, firstName: c.name, lastName: c.surname }))
        .filter(Boolean),
    );
    for (const d of dossiers) {
      const mail = (d.email || "").trim().toLowerCase();
      // Un dossier né d'une simple note ou d'un blocage n'est pas un client
      // à afficher. En revanche `hadBookings` marque quelqu'un qui a bel et
      // bien été client : il reste listé même après suppression de tous ses
      // rendez-vous.
      const vraiClient = d.createdManually || d.hadBookings;
      if (!vraiClient) continue;
      // Repli sur la clé quand il n'y a pas d'e-mail — sinon un client sans
      // adresse serait écarté ici alors qu'on vient de le préserver.
      const identifiant = mail || d.clientKey || "";
      if (!identifiant || dejaListes.has(identifiant)) continue;
      const morceaux = (d.fullName || "").trim().split(/\s+/);
      clients.push({
        name: d.firstName || morceaux[0] || "",
        surname: d.lastName || morceaux.slice(1).join(" "),
        email: d.email,
        phone: d.phone || "",
        ids: [],                 // aucun rendez-vous à sélectionner ni supprimer
        count: 0,
        lastDate: null,
        lastTime: "",
        lastState: "confirmed",
        lastBookingId: String(d._id),   // la fiche s'ouvre par l'id du dossier
        employeeName: "",
        altName: d.altName || "",
        createdAt: d.createdAt,
      });
    }

    // Tri : dernier RDV le plus récent d'abord. Les clients sans aucun
    // rendez-vous n'ont pas de date — ils passent en tête (le plus récemment
    // ajouté d'abord) plutôt qu'en fin de liste, où on ne les retrouverait pas.
    clients.sort((a, b) => {
      if (!a.lastDate && !b.lastDate) return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      if (!a.lastDate) return -1;
      if (!b.lastDate) return 1;
      return new Date(b.lastDate) - new Date(a.lastDate);
    });

    return res.render("admin/clients-hub", {
      pageName: "ClientsHub",
      title: "Clients",
      clients,
      totalClients: clients.length,
    });
  } catch (err) {
    console.error("clientsHubInit error:", err.message);
    return res.status(500).send("Erreur serveur");
  }
};

// Suppression (unitaire ou groupée) des RDV depuis la page Clients. Scopé à
// l'établissement courant (anti-IDOR) — on ne supprime que ses propres RDV.
exports.clientsHubBulkDelete = async (req, res) => {
  try {
    // Cette route sert DEUX intentions opposées : « supprimer ce rendez-vous »
    // (le client doit rester) et « supprimer ce client » (il doit partir).
    // On ne le devine pas — l'interface le dit explicitement. Par défaut on
    // PRÉSERVE : perdre un client par erreur est bien plus grave que laisser
    // une fiche vide de trop.
    const supprimerClient = req.body.supprimerClient === true;
    let { ids, dossierIds } = req.body;
    if (!Array.isArray(ids)) ids = ids ? [ids] : [];
    ids = ids.filter(Boolean);
    if (!Array.isArray(dossierIds)) dossierIds = dossierIds ? [dossierIds] : [];
    dossierIds = dossierIds.filter(Boolean);
    if (!ids.length && !dossierIds.length) return res.status(400).json({ success: false, error: "no_ids" });

    const companyId = res.locals.currentCompany?._id;
    const ClientDossier = require("../db/models/clientDossier.model");

    // Emails concernés AVANT suppression : un client créé à la main qui a
    // depuis réservé doit voir sa fiche partir avec ses rendez-vous, sinon il
    // réapparaîtrait aussitôt dans la liste (sans aucun rendez-vous).
    let emails = [];
    if (ids.length) {
      const concernes = await Booking.find({ _id: { $in: ids }, company: companyId }).select("email").lean();
      emails = [...new Set(concernes.map((b) => (b.email || "").trim().toLowerCase()).filter(Boolean))];
    }

    // Suppression d'un simple rendez-vous : on pose le dossier témoin AVANT,
    // tant que les coordonnées du client sont encore lisibles.
    if (!supprimerClient && ids.length) {
      const aPreserver = await Booking.find({ _id: { $in: ids }, company: companyId })
        .select("name surname email phone isBlock").lean();
      for (const b of aPreserver) await preserveClient(companyId, b).catch(() => {});
    }

    const result = ids.length
      ? await Booking.deleteMany({ _id: { $in: ids }, company: companyId })
      : { deletedCount: 0 };

    // Seuls les dossiers créés à la main sont supprimables ici : ceux nés d'une
    // note ou d'un blocage doivent survivre (on ne débloque pas quelqu'un en
    // supprimant ses rendez-vous, et on ne perd pas un suivi).
    // `hadBookings` s'ajoute à `createdManually` : supprimer volontairement
    // un client depuis cette page doit emporter le dossier témoin posé à la
    // suppression de ses rendez-vous, sinon il resterait listé pour toujours.
    const cibles = supprimerClient ? [] : null;
    if (cibles === null) return res.json({ success: true, deleted: result.deletedCount });
    if (dossierIds.length) cibles.push({ _id: { $in: dossierIds } });
    if (emails.length) cibles.push({ email: { $in: emails } });
    if (cibles.length) {
      await ClientDossier.deleteMany({
        company: companyId,
        $and: [
          { $or: [{ createdManually: true }, { hadBookings: true }] },
          { $or: cibles },
        ],
      });
    }

    return res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    console.error("clientsHubBulkDelete error:", err.message);
    return res.status(500).json({ success: false });
  }
};

// Fiche client (nouvelle page façon « dossier patient »). Pour l'instant :
// onglet Aperçu uniquement. On part d'un RDV (id), on charge le client et
// TOUS ses RDV (regroupés par email/téléphone) pour l'aperçu. Scopé à
// l'établissement courant (anti-IDOR). On ne touche pas à /history/edit.
// ── Recherche de clients (modale « Nouveau rendez-vous ») ───────────────────
// Sans elle, chaque rendez-vous obligeait à retaper nom, e-mail et téléphone —
// une faute de frappe sur l'e-mail créait un client en double.
function echapperRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Clients de l'établissement, dédupliqués comme dans la liste : e-mail d'abord,
// à défaut téléphone, à défaut nom complet.
async function chercherClients(companyId, motif, limite) {
  const rx = new RegExp(echapperRegex(motif), "i");
  const ClientDossier = require("../db/models/clientDossier.model");
  const [bookings, dossiers] = await Promise.all([
    Booking.find({
      company: companyId,
      isBlock: { $ne: true },
      $or: [{ name: rx }, { surname: rx }, { email: rx }, { phone: rx }],
    }).sort({ date: -1, startTime: -1 }).select("name surname email phone date").limit(300).lean(),
    ClientDossier.find({
      company: companyId,
      createdManually: true,
      $or: [{ firstName: rx }, { lastName: rx }, { fullName: rx }, { email: rx }, { phone: rx }],
    }).select("firstName lastName fullName email phone").limit(50).lean(),
  ]);

  const map = new Map();
  const cle = (c) =>
    (c.email && c.email.trim().toLowerCase()) ||
    (c.phone && c.phone.trim()) ||
    ((c.name || "") + " " + (c.surname || "")).trim().toLowerCase();

  for (const b of bookings) {
    const k = cle(b);
    if (!k) continue;
    const vu = map.get(k);
    if (vu) { vu.count++; continue; }
    map.set(k, {
      name: b.name || "", surname: b.surname || "",
      email: b.email || "", phone: b.phone || "",
      lastDate: b.date, count: 1,
    });
  }
  for (const d of dossiers) {
    const morceaux = (d.fullName || "").trim().split(/\s+/);
    const c = {
      name: d.firstName || morceaux[0] || "",
      surname: d.lastName || morceaux.slice(1).join(" "),
      email: d.email || "", phone: d.phone || "",
      lastDate: null, count: 0,
    };
    const k = cle(c);
    if (k && !map.has(k)) map.set(k, c);
  }

  const liste = Array.from(map.values());
  // Les clients les plus récents d'abord ; ceux sans rendez-vous en tête.
  liste.sort((a, b) => {
    if (!a.lastDate && !b.lastDate) return 0;
    if (!a.lastDate) return -1;
    if (!b.lastDate) return 1;
    return new Date(b.lastDate) - new Date(a.lastDate);
  });
  return liste.slice(0, limite || 8);
}

exports.clientsHubSearch = async (req, res) => {
  try {
    const motif = String(req.query.q || "").trim().slice(0, 80);
    if (motif.length < 2) return res.json({ success: true, clients: [] });
    const clients = await chercherClients(res.locals.currentCompany._id, motif, 8);
    return res.json({ success: true, clients });
  } catch (err) {
    console.error("clientsHubSearch error:", err.message);
    return res.status(500).json({ success: false, clients: [] });
  }
};

// Avant de créer un client à la volée : est-ce qu'on ne l'a pas déjà ?
//   • même e-mail  → c'est le même client, ses rendez-vous se regrouperont
//                    tout seuls : rien à signaler.
//   • même téléphone ou même nom, e-mail différent → doublon probable, à
//                    signaler pour que le pro tranche.
exports.clientsHubLookup = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const email = String(req.query.email || "").trim().toLowerCase().slice(0, 160);
    const phone = String(req.query.phone || "").trim().slice(0, 40);
    const nom = String(req.query.name || "").trim().slice(0, 120);

    if (email) {
      const memeMail = await chercherClients(companyId, email, 20);
      if (memeMail.some((c) => (c.email || "").trim().toLowerCase() === email)) {
        return res.json({ success: true, doublon: null });
      }
    }

    // Le nom complet n'est dans aucun champ pris isolément (prénom et nom sont
    // stockés séparément) : on cherche sur le mot le plus long, puis on compare
    // le nom reconstitué.
    const motNom = nom.split(/\s+/).sort((a, b) => b.length - a.length)[0] || "";
    const pistes = [
      { motif: phone, raison: "phone", correspond: (c) => (c.phone || "").trim() === phone },
      {
        motif: motNom,
        raison: "name",
        correspond: (c) => ((c.name || "") + " " + (c.surname || "")).trim().toLowerCase() === nom.toLowerCase(),
      },
    ];
    for (const piste of pistes) {
      if (!piste.motif || piste.motif.length < 3) continue;
      const trouves = await chercherClients(companyId, piste.motif, 20);
      const exact = trouves.find(piste.correspond);
      if (exact && (exact.email || "").trim().toLowerCase() !== email) {
        return res.json({ success: true, doublon: exact, raison: piste.raison });
      }
    }
    return res.json({ success: true, doublon: null });
  } catch (err) {
    console.error("clientsHubLookup error:", err.message);
    return res.json({ success: true, doublon: null }); // ne jamais bloquer la création
  }
};

// Créer un client sans passer par un rendez-vous. Jusqu'ici la liste des
// clients était entièrement déduite des réservations : impossible d'inscrire
// quelqu'un rencontré hors ligne (téléphone, passage en boutique) avant qu'il
// ait réservé. La fiche vit dans ClientDossier, déjà identifié par
// (établissement, e-mail) — c'est aussi lui qui porte notes et dossier de suivi.
exports.clientsHubCreate = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const prenom = String(req.body.firstName || "").trim().slice(0, 80);
    const nom = String(req.body.lastName || "").trim().slice(0, 80);
    const email = String(req.body.email || "").trim().toLowerCase().slice(0, 160);
    const phone = String(req.body.phone || "").trim().slice(0, 40);

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ success: false, message: "Indiquez une adresse e-mail valide." });
    }
    if (!prenom && !nom) {
      return res.json({ success: false, message: "Indiquez au moins un nom ou un prénom." });
    }

    // Déjà client ? On n'en crée pas un deuxième : on renvoie vers sa fiche.
    const rdv = await Booking.findOne({ company: companyId, email, isBlock: { $ne: true } })
      .sort({ date: -1 }).select("_id").lean();
    if (rdv) {
      return res.json({ success: false, message: "Ce client existe déjà — voici sa fiche.", redirect: `/clients-hub/${rdv._id}` });
    }
    const ClientDossier = require("../db/models/clientDossier.model");
    const existant = await ClientDossier.findOne({ company: companyId, email }).select("_id").lean();
    if (existant) {
      return res.json({ success: false, message: "Ce client existe déjà — voici sa fiche.", redirect: `/clients-hub/${existant._id}` });
    }

    const dossier = await ClientDossier.create({
      company: companyId, email, phone,
      firstName: prenom, lastName: nom,
      fullName: (prenom + " " + nom).trim(),
      createdManually: true,
    });
    return res.json({ success: true, redirect: `/clients-hub/${dossier._id}` });
  } catch (err) {
    // Course entre deux créations simultanées : l'index unique tranche.
    if (err && err.code === 11000) {
      return res.json({ success: false, message: "Ce client existe déjà." });
    }
    console.error("clientsHubCreate error:", err.message);
    return res.status(500).json({ success: false, message: "Une erreur est survenue." });
  }
};

// Une fiche client s'ouvre par l'identifiant d'un de ses rendez-vous — sauf
// pour un client créé à la main, qui n'en a aucun : son identité vit alors
// dans ClientDossier, et c'est l'id du dossier qui sert de clé. Les deux
// chemins doivent marcher partout (fiche, blocage, notes, dossier de suivi).
async function resoudreClient(companyId, id) {
  const booking = await Booking.findOne({ _id: id, company: companyId }).lean();
  if (booking) {
    return {
      booking,
      email: (booking.email || "").trim().toLowerCase(),
      fullName: ((booking.name || "") + " " + (booking.surname || "")).trim(),
      phone: booking.phone || "",
    };
  }
  const ClientDossier = require("../db/models/clientDossier.model");
  const dossier = await ClientDossier.findOne({ _id: id, company: companyId }).lean();
  if (!dossier) return null;
  return {
    booking: null,
    dossier,
    email: (dossier.email || "").trim().toLowerCase(),
    fullName: dossier.fullName || "",
    phone: dossier.phone || "",
  };
}

exports.clientsHubDetail = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-f0-9]{24}$/i.test(id)) return res.redirect("/clients-hub");
    const companyId = res.locals.currentCompany._id;

    const ctx = await resoudreClient(companyId, id);
    if (!ctx) return res.redirect("/clients-hub");

    // Client créé à la main : pas de rendez-vous d'où tirer l'identité, on la
    // reconstitue depuis son dossier pour que la fiche s'affiche pareil.
    const morceaux = (ctx.fullName || "").trim().split(/\s+/);
    const booking = ctx.booking || {
      _id: ctx.dossier._id,
      name: ctx.dossier.firstName || morceaux[0] || "",
      surname: ctx.dossier.lastName || morceaux.slice(1).join(" "),
      email: ctx.dossier.email || "",
      phone: ctx.dossier.phone || "",
      payment: {},
      status: "confirmed",
    };

    // Autres RDV du même client (même email OU même téléphone).
    // Même précédence que la clé de dossier : e-mail, sinon téléphone,
    // sinon nom. Sans le repli sur le nom, un client noté sans coordonnées
    // n'avait qu'un seul rendez-vous visible dans sa fiche, même s'il en
    // avait dix.
    const or = [];
    if (booking.email) or.push({ email: booking.email });
    else if (booking.phone) or.push({ phone: booking.phone });
    else if ((booking.name || "").trim()) {
      or.push({ name: booking.name || "", surname: booking.surname || "" });
    }
    let clientBookings = ctx.booking ? [booking] : [];
    if (or.length) {
      const trouves = await Booking.find({
        company: companyId,
        isBlock: { $ne: true },
        $or: or,
      }).sort({ date: -1, startTime: -1 }).lean();
      if (trouves.length) clientBookings = trouves;
    }

    // Services + équipe pour les sélecteurs d'édition inline (comme history-edit).
    const Service = require("../db/models/company/service.model");
    const ClientDossier = require("../db/models/clientDossier.model");
    const [services, employees, dossier] = await Promise.all([
      Service.find({ company: companyId, active: true }).select("_id name duration durationMax price").lean(),
      getBookableTeam(companyId),
      // Recherché par CLÉ : un client sans e-mail a désormais un dossier
      // identifié par son téléphone ou son nom.
      (function () {
        const cle = dossierKey({
          email: booking.email, phone: booking.phone,
          firstName: booking.name, lastName: booking.surname,
        });
        return cle ? ClientDossier.findOne({ company: companyId, clientKey: cle }).lean() : null;
      })(),
    ]);

    // Entrées du dossier, plus récentes d'abord.
    const dossierEntries = ((dossier && dossier.entries) || [])
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.render("admin/client-detail", {
      pageName: "ClientsHub",
      title: "Clients",
      booking,
      clientBookings,
      services,
      employees,
      generalNotes: (dossier && dossier.generalInfo) || "",
      hasEmailForNotes: !!booking.email,
      // Client créé à la main : il n'a aucun rendez-vous à supprimer, c'est sa
      // fiche qu'il faut viser. Sans ça, « Supprimer le client » envoyait une
      // liste vide et le serveur refusait.
      manualClientId: ctx.booking ? "" : String(ctx.dossier._id),
      dossierEntries,
      defaultDuration: (res.locals.currentCompany && res.locals.currentCompany.slotTime) || 30,
      hasServices: services.length > 0,
      altContact: {
        altName: (dossier && dossier.altName) || "",
        altEmail: (dossier && dossier.altEmail) || "",
        altPhone: (dossier && dossier.altPhone) || "",
      },
    });
  } catch (err) {
    console.error("clientsHubDetail error:", err.message);
    return res.redirect("/clients-hub");
  }
};

// Bloquer un client depuis sa fiche : upsert d'un ClientDossier (par email)
// avec blocked=true. Le flux de réservation publique rejette déjà les emails
// bloqués (cf. booking.controller). Scopé à l'établissement courant.
exports.clientsHubBlock = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ success: false });
    const companyId = res.locals.currentCompany._id;

    const ctx = await resoudreClient(companyId, id);
    if (!ctx) return res.status(404).json({ success: false });

    // Le blocage, LUI, exige une adresse : la réservation publique reconnaît
    // un client bloqué par son e-mail (cf. booking.controller). Bloquer
    // quelqu'un sans adresse enregistrerait un drapeau que rien ne lirait —
    // le pro se croirait protégé alors que le client pourrait réserver.
    const email = ctx.email;
    if (!email) return res.status(400).json({ success: false, error: "no_email" });

    const ClientDossier = require("../db/models/clientDossier.model");
    const fullName = ctx.fullName;
    await ClientDossier.findOneAndUpdate(
      { company: companyId, email },
      {
        $set: { blocked: true, blockedAt: new Date(), blockedReason: (req.body.reason || "").trim().slice(0, 200) },
        $setOnInsert: { company: companyId, email, fullName, phone: ctx.phone },
      },
      { new: true, upsert: true }
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("clientsHubBlock error:", err.message);
    return res.status(500).json({ success: false });
  }
};

// Notes générales sur le client (persistantes, niveau client). Stockées dans
// ClientDossier.generalInfo (clé = email), upsert. Scopé à l'établissement.
exports.clientsHubSaveNotes = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ success: false });
    const companyId = res.locals.currentCompany._id;

    const ctx = await resoudreClient(companyId, id);
    if (!ctx) return res.status(404).json({ success: false });

    const email = ctx.email || "";
    // Une note peut se prendre sur un client sans e-mail : la clé retombe
    // sur son téléphone, sinon sur son nom.
    const cle = dossierKey({ email: email, phone: ctx.phone, fullName: ctx.fullName });
    if (!cle) return res.status(400).json({ success: false, error: "no_identity" });

    const ClientDossier = require("../db/models/clientDossier.model");
    const notes = String(req.body.notes || "").slice(0, 5000);
    const fullName = ctx.fullName;
    await ClientDossier.findOneAndUpdate(
      { company: companyId, clientKey: cle },
      { $set: { generalInfo: notes }, $setOnInsert: { company: companyId, email, fullName, phone: ctx.phone } },
      { new: true, upsert: true }
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("clientsHubSaveNotes error:", err.message);
    return res.status(500).json({ success: false });
  }
};

// ── Dossier client : entrées de suivi (notes datées + PDF) ──────────────────
const _dossierRoot = () => require("path").join(__dirname, "..", "private_uploads");
async function _getOrCreateDossier(bookingId, companyId) {
  // `bookingId` est l'id d'un rendez-vous, ou celui du dossier lui-même pour un
  // client créé à la main (voir resoudreClient).
  const ctx = await resoudreClient(companyId, bookingId);
  if (!ctx) return { error: "not_found" };
  // Un client SANS e-mail a maintenant un dossier : identifié par son
  // téléphone, sinon par son nom. Seul un client sans aucune de ces trois
  // informations reste impossible à ficher — il n'y aurait rien pour le
  // reconnaître d'une fois sur l'autre.
  const cle = dossierKey({ email: ctx.email, phone: ctx.phone, fullName: ctx.fullName });
  if (!cle) return { error: "no_identity" };
  const ClientDossier = require("../db/models/clientDossier.model");
  let dossier = await ClientDossier.findOne({ company: companyId, clientKey: cle });
  if (!dossier) {
    dossier = await ClientDossier.create({
      company: companyId, email: ctx.email || "",
      fullName: ctx.fullName,
      phone: ctx.phone,
    });
  }
  return { booking: ctx.booking, dossier };
}
function _saveDossierPdf(file, companyId) {
  const fs = require("fs"), path = require("path"), crypto = require("crypto");
  const isPdf = file.mimetype === "application/pdf" || (file.originalname || "").toLowerCase().endsWith(".pdf");
  if (!isPdf) return { error: "not_pdf" };
  const rel = path.join("dossiers", String(companyId));
  const dir = path.join(_dossierRoot(), rel);
  fs.mkdirSync(dir, { recursive: true });
  const fname = crypto.randomBytes(16).toString("hex") + ".pdf";
  fs.writeFileSync(path.join(dir, fname), file.buffer);
  return { attachment: { path: path.join(rel, fname), filename: (file.originalname || "document.pdf").slice(0, 200), size: file.size || file.buffer.length } };
}
function _deleteDossierFile(relPath) {
  if (!relPath) return;
  try {
    const fs = require("fs"), path = require("path");
    const full = path.join(_dossierRoot(), relPath);
    if (full.startsWith(_dossierRoot()) && fs.existsSync(full)) fs.unlinkSync(full);
  } catch (e) { /* silencieux */ }
}

// Contacts alternatifs du client (surnom/autre nom, autre email, autre tél).
// Stockés au niveau client (ClientDossier), pas sur le RDV.
exports.clientsHubDossierContact = async (req, res) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false });
    const companyId = res.locals.currentCompany._id;
    const { dossier, error } = await _getOrCreateDossier(req.params.id, companyId);
    if (error === "no_identity") return res.status(400).json({ success: false, error: "no_identity" });
    if (error) return res.status(404).json({ success: false });

    dossier.altName = String(req.body.altName || "").trim().slice(0, 120);
    dossier.altEmail = String(req.body.altEmail || "").trim().slice(0, 160);
    dossier.altPhone = String(req.body.altPhone || "").trim().slice(0, 40);
    await dossier.save();
    return res.json({ success: true });
  } catch (err) {
    console.error("clientsHubDossierContact error:", err.message);
    return res.status(500).json({ success: false });
  }
};

exports.clientsHubDossierAdd = async (req, res) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false });
    const companyId = res.locals.currentCompany._id;
    const { dossier, error } = await _getOrCreateDossier(req.params.id, companyId);
    if (error === "no_identity") return res.status(400).json({ success: false, error: "no_identity" });
    if (error) return res.status(404).json({ success: false });

    const note = (req.body.note || "").trim();
    const title = (req.body.title || "").trim();
    if (!note && !title && !req.file) return res.status(400).json({ success: false, error: "empty" });

    const entry = {
      date: req.body.date ? new Date(req.body.date) : new Date(),
      title: title.slice(0, 200),
      note: note.slice(0, 5000),
      todo: (req.body.todo || "").trim().slice(0, 2000),
    };
    if (req.file) {
      const r = _saveDossierPdf(req.file, companyId);
      if (r.error) return res.status(400).json({ success: false, error: r.error });
      entry.attachment = r.attachment;
    }
    dossier.entries.push(entry);
    await dossier.save();
    return res.json({ success: true });
  } catch (err) {
    console.error("clientsHubDossierAdd error:", err.message);
    return res.status(500).json({ success: false });
  }
};

exports.clientsHubDossierUpdate = async (req, res) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false });
    const companyId = res.locals.currentCompany._id;
    const { dossier, error } = await _getOrCreateDossier(req.params.id, companyId);
    if (error) return res.status(404).json({ success: false });

    const entry = dossier.entries.id(req.params.entryId);
    if (!entry) return res.status(404).json({ success: false });

    if (req.body.date) entry.date = new Date(req.body.date);
    if (req.body.title !== undefined) entry.title = (req.body.title || "").trim().slice(0, 200);
    if (req.body.note !== undefined) entry.note = (req.body.note || "").trim().slice(0, 5000);
    if (req.body.todo !== undefined) entry.todo = (req.body.todo || "").trim().slice(0, 2000);

    if (req.body.removeAttachment === "1" && entry.attachment && entry.attachment.path) {
      _deleteDossierFile(entry.attachment.path);
      entry.attachment = { path: "", filename: "", size: 0 };
    }
    if (req.file) {
      const r = _saveDossierPdf(req.file, companyId);
      if (r.error) return res.status(400).json({ success: false, error: r.error });
      if (entry.attachment && entry.attachment.path) _deleteDossierFile(entry.attachment.path);
      entry.attachment = r.attachment;
    }
    await dossier.save();
    return res.json({ success: true });
  } catch (err) {
    console.error("clientsHubDossierUpdate error:", err.message);
    return res.status(500).json({ success: false });
  }
};

exports.clientsHubDossierDelete = async (req, res) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false });
    const companyId = res.locals.currentCompany._id;
    const { dossier, error } = await _getOrCreateDossier(req.params.id, companyId);
    if (error) return res.status(404).json({ success: false });

    const entry = dossier.entries.id(req.params.entryId);
    if (!entry) return res.status(404).json({ success: false });
    if (entry.attachment && entry.attachment.path) _deleteDossierFile(entry.attachment.path);
    entry.deleteOne();
    await dossier.save();
    return res.json({ success: true });
  } catch (err) {
    console.error("clientsHubDossierDelete error:", err.message);
    return res.status(500).json({ success: false });
  }
};

// Téléchargement protégé du PDF (jamais servi en statique — RGPD).
exports.clientsHubDossierDownload = async (req, res) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).send("Requête invalide");
    const companyId = res.locals.currentCompany._id;
    const booking = await Booking.findOne({ _id: req.params.id, company: companyId }).lean();
    if (!booking || !booking.email) return res.status(404).send("Introuvable");
    const ClientDossier = require("../db/models/clientDossier.model");
    const dossier = await ClientDossier.findOne({ company: companyId, email: booking.email.trim().toLowerCase() });
    if (!dossier) return res.status(404).send("Introuvable");
    const entry = dossier.entries.id(req.params.entryId);
    if (!entry || !entry.attachment || !entry.attachment.path) return res.status(404).send("Fichier introuvable");

    const path = require("path"), fs = require("fs");
    const full = path.join(_dossierRoot(), entry.attachment.path);
    if (!full.startsWith(_dossierRoot()) || !fs.existsSync(full)) return res.status(404).send("Fichier introuvable");

    // ?view=1 → affichage dans le navigateur (inline) ; sinon téléchargement.
    if (req.query.view === "1") {
      const safe = (entry.attachment.filename || "document.pdf").replace(/[^\w.\- ]/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'inline; filename="' + safe + '"');
      return res.sendFile(full);
    }
    return res.download(full, entry.attachment.filename || "document.pdf");
  } catch (err) {
    console.error("clientsHubDossierDownload error:", err.message);
    return res.status(500).send("Erreur serveur");
  }
};

exports.historyDeleteRow = async (req, res) => {
  try {
    const { id } = req.body;

    // IDOR : scopé à l'établissement courant.
    const response = await Booking.findOneAndDelete({ _id: id, company: res.locals.currentCompany?._id });
    if (response) {
      await preserveClient(res.locals.currentCompany?._id, response).catch(() => {});
      return res.json({ success: true });
    } else {
      return res.status(404).json({ success: false });
    }
  } catch (err) {
    console.error("historyDeleteRow error:", err.message);
    return res.status(500).json({ success: false });
  }
};

exports.historySearch = async (req, res) => {
  try {
    // ── FAILLE CRITIQUE CORRIGÉE (fuite RGPD) ─────────────────────────────
    // Avant, la requête n'avait AUCUN filtre `company` → un pro qui cherchait
    // un client recevait les nom/email/téléphone/message de TOUS les clients
    // de TOUS les établissements de la plateforme. En plus, la saisie brute
    // dans `new RegExp` permettait un blocage serveur (ReDoS). Désormais :
    // scopé à l'établissement courant, regex échappée, projection minimale
    // (aucune donnée sensible renvoyée), résultats bornés.
    const currentCompany = res.locals.currentCompany;
    if (!currentCompany) {
      return res.status(400).json({ success: false, error: "Aucun établissement." });
    }

    const raw = (req.query.client || "").trim().slice(0, 80);
    const filter = { company: currentCompany._id };
    if (raw) {
      const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchRegex = new RegExp(escaped, "i");
      filter.$or = [
        { name: searchRegex },
        { surname: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { message: searchRegex },
      ];
    }

    const results = await Booking.find(filter)
      .select("name surname serviceName employee employeeName date startTime status slotTime")
      .sort({ date: -1 })
      .limit(300)
      .lean();

    return res.json({ success: true, results });
  } catch (err) {
    console.error("historySearch error:", err.message);
    return res.status(500).json({ success: false, error: "Erreur serveur." });
  }
};

exports.historyEditRow = async (req, res) => {
  try {
    const { id } = req.params;
    // IDOR : scopé à l'établissement courant — impossible d'ouvrir la fiche
    // d'édition (données client complètes) d'un RDV d'un autre établissement.
    const results = await Booking.findOne({ _id: id, company: res.locals.currentCompany?._id }).populate("employee");
    if (!results) return res.redirect("/history");

    // Fetch services & employees for the booking's company (for edit selectors)
    let services = [];
    let employees = [];
    if (results && results.company) {
      const Service  = require("../db/models/company/service.model");
      [services, employees] = await Promise.all([
        Service.find({ company: results.company, active: true }).select("_id name duration price").lean(),
        getBookableTeam(results.company),
      ]);
    }

    return res.render("admin/history-edit", {
      rowId: id,
      pageName: "History",
      title: res.locals.t.titles.history,
      results,
      services,
      employees,
      payoutInfo: res.locals.currentCompany?.payoutInfo || null,
    });
  } catch (err) {
    console.error(err);
    return res.json({ err });
  }
};

exports.settingsInit = async (req, res) => {
  // Générer un code de parrainage si l'utilisateur n'en a pas encore
  if (!req.user.referralCode) {
    const crypto = require("crypto");
    const base = (req.user.fullName || "USER").trim().split(" ")[0]
      .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
    let code;
    for (let i = 0; i < 10; i++) {
      code = `${base}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      const exists = await User.exists({ referralCode: code });
      if (!exists) break;
    }
    req.user.referralCode = code;
    await User.findByIdAndUpdate(req.user._id, { referralCode: code });
  }

  const email     = req.user.email;
  const maskEmail = email.replace(/^(..)(.*)(?=@)/, "$1...");
  const canUseSocial    = getLimit("socialLinks", res.locals.billingUser);
  const canUseCustomUrl = require("../utils/planLimits").LIMITS.customUrl.hasFeature(res.locals.billingUser);
  const cs = req.user.calendarSettings || {};

  // ── Stripe : cartes & factures ──────────────────────────────────────────
  let paymentMethods = [];
  let invoices       = [];
  const stripeCustomerId = req.user.subscription?.stripeCustomerId;
  if (stripeCustomerId) {
    try {
      const [pmsResult, invResult, customer] = await Promise.all([
        stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card", limit: 10 }),
        stripe.invoices.list({ customer: stripeCustomerId, limit: 12 }),
        stripe.customers.retrieve(stripeCustomerId),
      ]);

      let defaultPmId = customer.invoice_settings?.default_payment_method || null;
      if (!defaultPmId && req.user.subscription?.stripeSubscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(req.user.subscription.stripeSubscriptionId);
          defaultPmId = sub.default_payment_method || null;
        } catch (_) {}
      }
      if (!defaultPmId && pmsResult.data.length === 1) defaultPmId = pmsResult.data[0].id;

      paymentMethods = pmsResult.data.map((pm) => ({
        id:        pm.id,
        brand:     pm.card.brand,
        last4:     pm.card.last4,
        expMonth:  pm.card.exp_month,
        expYear:   pm.card.exp_year,
        isDefault: pm.id === defaultPmId,
      }));
      invoices = invResult.data.map((inv) => ({
        id:          inv.id,
        date:        inv.created,
        description: inv.description || (inv.lines?.data?.[0]?.description) || "Abonnement BranShee",
        amount:      ((inv.amount_paid || inv.amount_due || 0) / 100).toFixed(2),
        currency:    (inv.currency || "eur").toUpperCase(),
        status:      inv.status,
        pdfUrl:      inv.invoice_pdf,
        hostedUrl:   inv.hosted_invoice_url,
      }));
    } catch (e) {
      console.error("Stripe billing fetch error:", e.message);
    }
  }

  const twoFAEnabled = req.user?.twoFA?.enabled || false;
  const currentLang  = req.cookies?.user_lang || req.user?.preferredLang || "fr";

  // ── "Rejoindre un établissement" — cf. plan d'unification des comptes ──────
  // Côté demandeur : a-t-il une demande en cours/refusée à afficher ?
  let myJoinRequest = null;
  if (!res.locals.currentCompany) {
    const membership = await CompanyMembership.findOne({ user: req.user._id })
      .sort("-createdAt")
      .populate({ path: "company", select: "name owner", populate: { path: "owner", select: "businessName fullName" } })
      .lean();
    if (membership && membership.company) {
      myJoinRequest = {
        status: membership.status,
        // Nom de l'établissement demandé (repli sur son patron).
        companyName: membership.company.name
          || membership.company.owner?.businessName
          || membership.company.owner?.fullName
          || "Établissement",
      };
    }
  }

  // Côté propriétaire (ou délégué collaborators.manage) : demandes en attente
  // pour cet établissement (Business uniquement)
  let pendingJoinRequests = [];
  if (res.locals.currentCompany && res.locals.permissions?.collaborators?.manage) {
    const requests = await CompanyMembership.find({ company: res.locals.currentCompany._id, status: "pending" })
      .populate("user", "fullName email profilePicture")
      .lean();
    pendingJoinRequests = requests.filter((r) => r.user).map((r) => ({
      id: String(r._id),
      fullName: r.user.fullName,
      email: r.user.email,
      profilePicture: r.user.profilePicture || "/images/no-user.webp",
    }));
  }

  return res.render("admin/settings", {
    pageName: "Settings",
    // Topbar = « Paramètres » (le titre de section, lui, suit l'onglet actif).
    title: res.locals.t?.titles?.settings || "Paramètres",
    success: req.query.success,
    maskEmail,
    currentCompany: res.locals.currentCompany,
    canUseSocial,
    canUseCustomUrl,
    cs,
    gallery:             cs.gallery   || [],
    equipment:           cs.equipment || [],
    isPro:               res.locals.isPro,
    currentPlan:         res.locals.currentPlan,
    paymentMethods,
    invoices,
    stripePublishableKey: env.stripePublishableKey || "",
    twoFAEnabled,
    currentLang,
    // Stripe Connect
    stripeConnect: res.locals.currentCompany?.stripeConnect || { status: "not_connected", accountId: "", accountEmail: "" },
    acceptedPayments: res.locals.currentCompany?.acceptedPayments || {},
    stripeConnectClientId: env.stripeConnectClientId || "",
    stripeConnectSuccess:  req.query.stripeConnectSuccess === "1",
    stripeConnectError:    req.query.stripeConnectError   || null,
    stripeConnectMsg:      req.query.stripeMsg            || null,
    membershipRole: res.locals.membershipRole || null,
    myJoinRequest,
    pendingJoinRequests,
  });
};

exports.historyEditRowPatch = async (req, res) => {
  try {
    const { id } = req.params;

    // ── IDOR CRITIQUE CORRIGÉ ─────────────────────────────────────────────
    // On vérifie DÈS LE DÉBUT que le RDV appartient à l'établissement courant.
    // Sans ça, un pro pouvait réécrire le RDV d'un concurrent, et pire :
    // via forceDeleteConflicts, déclencher un deleteMany() sur l'établissement
    // ciblé (suppression en masse de RDV chez un tiers).
    const owned = await Booking.exists({ _id: id, company: res.locals.currentCompany?._id });
    if (!owned) {
      return res.status(404).json({ success: false, error: "Rendez-vous introuvable." });
    }

    const {
      name,
      surname,
      fullName,
      email,
      phone,
      message,
      date,
      startTime,
      endTime,
      status,
      adminNotes,
      serviceId,
      serviceName,
      employeeId,
    } = req.body;

    // Support both separate name/surname and legacy fullName
    let firstName = name;
    let lastName = surname;
    if (!firstName && !lastName && fullName) {
      const parts = fullName.trim().split(" ");
      firstName = parts[0];
      lastName = parts.slice(1).join(" ") || "";
    }

    const updateFields = {};
    if (firstName !== undefined) updateFields.name = firstName;
    if (lastName !== undefined) updateFields.surname = lastName;
    if (email !== undefined) updateFields.email = email;
    if (phone !== undefined) updateFields.phone = phone;
    if (message !== undefined) updateFields.message = message;
    if (adminNotes !== undefined) updateFields.adminNotes = adminNotes;
    if (date) updateFields.date = new Date(date);
    if (startTime) updateFields.startTime = startTime;
    if (endTime) updateFields.endTime = endTime;
    // Le calendrier admin (GetAllAppointments) positionne et dimensionne les
    // créneaux à partir de `slotTime` (durée en minutes), pas de `endTime` —
    // sans ce recalcul, changer l'heure de fin (ou le service, qui ajuste
    // l'heure de fin côté client) laissait l'ancienne durée affichée partout
    // ailleurs que sur cette page d'édition.
    if (startTime && endTime) {
      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endTime.split(":").map(Number);
      const computedDuration = (eh * 60 + em) - (sh * 60 + sm);
      if (computedDuration > 0) updateFields.slotTime = computedDuration;
    }
    if (status && ["confirmed", "canceled"].includes(status)) {
      // Annuler un RDV exige `appointments.cancelDelete` partout ailleurs
      // (PATCH /appointment/:id/cancel, DELETE /history…). Cette route n'est
      // protégée que par `appointments.manage` : sans ce contrôle, un
      // collaborateur autorisé à modifier les RDV pouvait les annuler malgré
      // l'interdiction, en passant par l'édition d'historique.
      const { hasPermission } = require("../utils/permissions");
      if (status === "canceled" && !hasPermission(res, "appointments.cancelDelete")) {
        return res.status(403).json({
          success: false,
          error: "forbidden",
          message: "Vous n'avez pas la permission d'annuler un rendez-vous.",
        });
      }
      updateFields.status = status;
    }
    // Service update
    if (serviceId !== undefined) {
      updateFields.service    = serviceId || null;
      if (serviceName !== undefined) updateFields.serviceName = serviceName || "";
    }
    // Employee update (empty string = "no employee")
    if (employeeId !== undefined) {
      if (employeeId) {
        // On valide l'employé contre l'ÉQUIPE de l'établissement courant
        // (jamais un simple User.findById non scopé) — sinon un admin pouvait
        // référencer un praticien d'un autre établissement sur son RDV et
        // récupérer son nom (fuite inter-locataires / IDOR).
        const team = await getBookableTeam(res.locals.currentCompany._id);
        const emp = team.find((m) => m.id === String(employeeId));
        if (emp) {
          updateFields.employee = employeeId;
          updateFields.employeeName = `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || emp.businessName || "";
        } else {
          // Employé inconnu de cette équipe → on n'assigne personne.
          updateFields.employee = null;
          updateFields.employeeName = "";
        }
      } else {
        updateFields.employee = null;
        updateFields.employeeName = "";
      }
    }
    // Mode de paiement (défini/modifié manuellement par l'admin).
    const { paymentMethod } = req.body;
    if (paymentMethod !== undefined) {
      const allowedPay = ["online", "on_site", "bank_transfer", "paypal", "cash", "none"];
      if (allowedPay.includes(paymentMethod)) updateFields["payment.method"] = paymentMethod;
    }

    // ── Optional: force-delete conflicting bookings before saving ──────────────
    const { forceDeleteConflicts } = req.body;
    if (forceDeleteConflicts && req.body.date && updateFields.startTime && updateFields.endTime) {
      // Appartenance déjà vérifiée en tête → on force le scope sur
      // l'établissement courant (jamais celui d'un tiers).
      const bookingCompany = res.locals.currentCompany._id;
      const conflictQuery = buildConflictQuery(
        bookingCompany,
        req.body.date,       // keep as YYYY-MM-DD string for buildConflictQuery
        updateFields.startTime,
        updateFields.endTime,
        updateFields.employee ?? undefined,
        id
      );
      await Booking.deleteMany(conflictQuery);
    }

    const response = await Booking.findOneAndUpdate({ _id: id, company: res.locals.currentCompany._id }, updateFields, { new: true }).lean();

    // ── Sync Google Calendar ──────────────────────────────────────────────────
    if (response) {
      try {
        const companyDoc = await Company.findById(response.company);
        const owner = await User.findById(companyDoc?.owner);
        if (owner?.googleCalendar?.connected && owner.googleCalendar.refreshToken) {
          const refreshToken = owner.googleCalendar.refreshToken;

          if (response.status === "canceled") {
            // Annulé/supprimé via l'admin → retirer de Google Calendar
            if (response.googleEventId) {
              await deleteEventFromCalendar(refreshToken, response.googleEventId);
              await Booking.findByIdAndUpdate(id, { googleEventId: "" });
            }
          } else {
            // Confirmé : mettre à jour (ou créer si l'événement n'existait pas, ex. réactivé)
            const eventId = await updateEventInCalendar(refreshToken, response.googleEventId, response);
            if (eventId && eventId !== response.googleEventId) {
              await Booking.findByIdAndUpdate(id, { googleEventId: eventId });
            }
          }
        }
      } catch (gcalErr) {
        console.error("Google Calendar sync error (edit):", gcalErr.message);
      }

      return res.json({ success: true });
    }
    return res.json({ success: false });
  } catch (err) {
    console.error(err);
    return res.json({ err });
  }
};

// ── Shared helper: build a MongoDB conflict query ─────────────────────────────
function buildConflictQuery(company, date, startTime, endTime, employeeId, excludeId) {
  // Use a 24-hour window to be timezone-safe
  const dayStart = new Date(date + "T00:00:00.000Z");
  const dayEnd   = new Date(date + "T23:59:59.999Z");

  const query = {
    company,
    date:      { $gte: dayStart, $lte: dayEnd },
    status:    "confirmed",
    startTime: { $lt: endTime },
    endTime:   { $gt: startTime },
    _id:       { $ne: excludeId },
  };
  if (employeeId) {
    query.$or = [
      { employee: employeeId },
      { employee: null },
    ];
  }
  return query;
}

// ── Check conflicts before saving a booking edit ──────────────────────────────
exports.historyCheckConflicts = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, startTime, endTime, employeeId } = req.query;

    if (!date || !startTime || !endTime) {
      return res.json({ hasConflict: false, conflicts: [] });
    }

    // IDOR : on ne cherche des conflits que si le RDV appartient à
    // l'établissement courant, et on scope la recherche à cet établissement
    // (avant, on renvoyait les RDV d'un autre établissement).
    const booking = await Booking.findOne({ _id: id, company: res.locals.currentCompany?._id }).select("_id").lean();
    if (!booking) return res.json({ hasConflict: false, conflicts: [] });

    const query = buildConflictQuery(
      res.locals.currentCompany._id,
      date,
      startTime,
      endTime,
      employeeId || null,
      id
    );

    const conflicts = await Booking.find(query)
      .select("name surname startTime endTime date serviceName employeeName")
      .lean();

    return res.json({
      hasConflict: conflicts.length > 0,
      conflicts: conflicts.map((c) => ({
        id: c._id,
        name: `${c.name || ""} ${c.surname || ""}`.trim(),
        time: `${c.startTime} – ${c.endTime}`,
        service: c.serviceName || "",
      })),
    });
  } catch (err) {
    console.error("[historyCheckConflicts]", err);
    return res.json({ hasConflict: false, conflicts: [], error: err.message });
  }
};

exports.paymentVerification = async (req, res) => {
  const { session_id } = req.query;
  // `verifie` commande le discours de la page. Il n'est vrai que lorsque
  // Stripe a confirmé le paiement — pas quand quelqu'un tape l'adresse à la
  // main. Aucun forfait n'était accordé dans ce cas (l'activation vient plus
  // bas, après la vérification), mais l'écran affichait « Votre achat a été
  // confirmé » et des confettis. Annoncer un achat qui n'a pas eu lieu, c'est
  // se garantir un « j'ai payé et je n'ai rien reçu » à traiter plus tard.
  const rendre = (verifie) =>
    res.render("admin/payment-success", { t: res.locals.t, verifie });
  const renderSuccess = () => rendre(true);
  const renderNonVerifie = () => rendre(false);

  // Sans session_id on ne peut rien vérifier
  if (!session_id) {
    console.warn("[paymentVerification] Pas de session_id dans l'URL");
    return renderNonVerifie();
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(session_id);
  } catch (retrieveErr) {
    console.error("[paymentVerification] Impossible de récupérer la session Stripe:", retrieveErr.message);
    return renderNonVerifie();
  }

  console.log(`[paymentVerification] session=${session_id} payment_status=${session.payment_status} amount=${session.amount_total} customer=${session.customer} subscription=${session.subscription}`);

  // Accepter "paid" ET "no_payment_required" (promo 100%, achat 0€)
  const validStatus = ["paid", "no_payment_required"];
  if (!validStatus.includes(session.payment_status)) {
    console.warn("[paymentVerification] payment_status non valide:", session.payment_status);
    return res.redirect("/subscription");
  }

  // ── Déterminer le plan ─────────────────────────────────────────────────────
  // Priorité : metadata du checkout (toujours dispo) → line items → fallback "pro"
  let planName = session.metadata?.plan || null;

  if (!planName) {
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session_id, { limit: 5 });
      const priceId = lineItems.data[0]?.price?.id || "";
      const isBusinessPrice = [
        env.stripePriceBusinessMonthly,
        env.stripePriceBusinessYearly,
      ].filter(Boolean).includes(priceId);
      const isEssentielPrice = [
        env.stripePriceEssentielMonthly,
        env.stripePriceEssentielYearly,
      ].filter(Boolean).includes(priceId);
      planName = isEssentielPrice ? "essentiel" : isBusinessPrice ? "business" : "pro";
    } catch (liErr) {
      console.error("[paymentVerification] listLineItems error:", liErr.message);
      planName = "pro"; // fallback
    }
  }

  console.log(`[paymentVerification] plan détecté: ${planName}`);

  // ── Activer le plan ────────────────────────────────────────────────────────
  const Subscription = require("../db/models/subscription.model");
  const userId = session.client_reference_id || session.metadata?.userId || (req.user && req.user._id.toString());

  if (!userId) {
    // Le paiement est bien passé chez Stripe, mais on ne sait pas à QUI
    // l'attribuer : le forfait n'est pas activé. Dire « c'est bon » ici
    // enverrait le pro travailler en croyant être passé Pro.
    console.error("[paymentVerification] userId introuvable — plan NON activé");
    return renderNonVerifie();
  }

  try {
    await User.findByIdAndUpdate(userId, {
      isPremium:                           true,
      manualPremium:                       false,
      "subscription.plan":                 planName,
      "subscription.status":               "active",
      "subscription.stripeCustomerId":     session.customer,
      "subscription.stripeSubscriptionId": session.subscription || null,
    });

    await Subscription.updateMany(
      { user: userId, status: "active" },
      { status: "superseded" }
    );

    const expDate = new Date();
    expDate.setMonth(expDate.getMonth() + 1);
    await Subscription.findOneAndUpdate(
      { user: userId, stripeSubscriptionId: session.subscription || `manual_${session_id}` },
      {
        user:                userId,
        plan:                planName,
        status:              "active",
        startDate:           new Date(),
        endDate:             expDate,
        stripeCustomerId:    session.customer,
        stripeSubscriptionId: session.subscription || null,
        amount:              (session.amount_total || 0) / 100,
        currency:            session.currency || "eur",
      },
      { upsert: true, new: true }
    );

    // Mettre à jour la session Express en cours pour affichage immédiat
    if (req.user) {
      req.user.isPremium = true;
      req.user.subscription = req.user.subscription || {};
      req.user.subscription.plan   = planName;
      req.user.subscription.status = "active";
    }

    // ── Écriture PER-ÉTABLISSEMENT (source de vérité cible, idempotent avec le
    // webhook) : forfait rattaché à l'établissement ciblé au checkout.
    const Company = require("../db/models/company/company.model");
    let companyId = session.metadata?.companyId || "";
    if (!companyId) {
      const firstOwned = await Company.findOne({ owner: userId, isDeleted: { $ne: true } })
        .sort({ createdAt: 1 }).select("_id").lean();
      companyId = firstOwned?._id ? String(firstOwned._id) : "";
    }
    if (companyId) {
      await Company.findByIdAndUpdate(companyId, {
        plan: planName,
        planStatus: "active",
        stripeSubscriptionId: session.subscription || null,
      });
    }

    console.log(`✅ [paymentVerification] Plan "${planName}" activé pour user ${userId} (établissement ${companyId || "—"})`);
    const { enforcePlanLimits } = require("./account.controller");
    enforcePlanLimits(userId, planName, companyId || null).catch(() => {});

    // ── Parrainage : compter ce filleul comme "payant" pour son parrain ────────
    // Seulement la 1ère fois qu'il devient payant (un désabonnement/réabonnement
    // ne doit pas recompter — referralPaidCounted le garantit).
    try {
      const filleul = await User.findOneAndUpdate(
        { _id: userId, referredBy: { $ne: null }, referralPaidCounted: { $ne: true } },
        { referralPaidCounted: true },
      );
      if (filleul && filleul.referredBy) {
        await User.findByIdAndUpdate(filleul.referredBy, { $inc: { "referral.totalPaying": 1 } });
        console.log(`✅ [paymentVerification] Parrainage : ${filleul.referredBy} +1 filleul payant`);
      }
    } catch (refErr) {
      console.error("[paymentVerification] Erreur MAJ parrainage:", refErr.message);
    }

    // ── Incrémenter l'utilisation du code promo maintenant que le paiement
    //    est confirmé (évite de compter les abandons sur la page Stripe).
    const promoCodeId = session.metadata?.promoCodeId;
    if (promoCodeId) {
      try {
        const PromoCode = require("../db/models/promoCode.model");
        await PromoCode.findByIdAndUpdate(promoCodeId, {
          $inc: { usedCount: 1 },
          $addToSet: { usedByUsers: userId },
        });
        console.log(`✅ [paymentVerification] PromoCode ${promoCodeId} usage enregistré`);
      } catch (promoErr) {
        console.error("[paymentVerification] Erreur MAJ promo:", promoErr.message);
      }
    }
  } catch (dbErr) {
    console.error("[paymentVerification] Erreur DB:", dbErr.message);
  }

  return renderSuccess();
};

const Subscription = require("../db/models/subscription.model");

exports.resumeSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ user: req.user._id });

    if (!subscription || !subscription.stripeSubscriptionId) {
      return res.status(404).json({ error: "Abonnement introuvable." });
    }

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    subscription.autoRenew = true;
    subscription.status = "active";
    await subscription.save();

    return res.json({
      success: true,
      message: "Abonnement réactivé avec succès.",
    });
  } catch (error) {
    console.error(error);
    return res.json({ err });
  }
};

exports.saveAdminNotes = async (req, res) => {
  try {
    const { bookId } = req.params;
    const { adminNotes } = req.body;

    // IDOR : scopé à l'établissement courant.
    const updated = await Booking.findOneAndUpdate({ _id: bookId, company: res.locals.currentCompany?._id }, { adminNotes });
    if (!updated) return res.status(404).json({ success: false });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, err });
  }
};

const Form = require("../db/models/form.model");

exports.formsIndex = async (req, res) => {
  const { getLimit } = require("../utils/planLimits");
  try {
    const companyId = res.locals.currentCompany._id;
    const form = await Form.findOne({ company: companyId }).lean();
    const maxQuestions = getLimit("formQuestions", res.locals.billingUser);

    // Plan Basic (maxQuestions === 0) : on affiche quand même un aperçu
    // (verrouillé) de la fonctionnalité avec des questions de démonstration,
    // au lieu de la cacher complètement derrière un message "Fonctionnalité
    // Pro" — l'utilisateur voit concrètement ce que le plan Pro débloque,
    // ce qui est un meilleur argument d'upsell ("laisser l'utilisateur voir
    // la fonctionnalité, juste sans pouvoir l'utiliser tant qu'il ne paie pas").
    const demoForm = {
      active: false,
      questions: [
        { label: "Avez-vous déjà visité notre établissement ?", type: "yes_no", required: true },
        { label: "Quel est le motif de votre visite ?", type: "text", required: false },
        {
          label: "Comment avez-vous entendu parler de nous ?",
          type: "choice",
          required: false,
          options: ["Bouche-à-oreille", "Réseaux sociaux", "Recherche Google"],
        },
      ],
    };

    return res.render("admin/forms", {
      pageName: res.locals.t.sidebar.a_9,
      form: maxQuestions === 0 ? demoForm : (form || null),
      title: res.locals.t.sidebar.a_9,
      maxQuestions,
    });
  } catch (err) {
    console.error(err);
    return res.render("admin/forms", {
      pageName: res.locals.t.sidebar.a_9,
      form: null,
      title: res.locals.t.sidebar.a_9,
      maxQuestions: 0,
    });
  }
};

exports.getFormData = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const form = await Form.findOne({ company: companyId }).lean();
    return res.json({ success: true, form: form || null });
  } catch (err) {
    return res.json({ success: false, err: err.message });
  }
};

exports.saveForm = async (req, res) => {
  const { getLimit } = require("../utils/planLimits");
  try {
    const companyId = res.locals.currentCompany._id;
    const { active, questions } = req.body;

    // Enforce plan limit server-side
    const maxQuestions = getLimit("formQuestions", res.locals.billingUser);
    if (maxQuestions === 0) {
      return res.json({ success: false, error: "plan_limit", message: "Votre plan ne permet pas d'utiliser le formulaire." });
    }
    const limitedQuestions = Array.isArray(questions) ? questions.slice(0, maxQuestions) : [];

    const form = await Form.findOneAndUpdate(
      { company: companyId },
      { active: maxQuestions > 0 ? active : false, questions: limitedQuestions },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, form });
  } catch (err) {
    console.error(err);
    return res.json({ success: false, err: err.message });
  }
};

exports.customizeCalendarPage = async (req, res) => {
  const cs = req.user.calendarSettings || {};
  const canUseSocial    = getLimit("socialLinks", res.locals.billingUser);
  const canUseCustomUrl = require("../utils/planLimits").LIMITS.customUrl.hasFeature(res.locals.billingUser);
  const defaultOrder    = ['about', 'location', 'hours', 'gallery', 'reviews'];
  const sectionOrder    = cs.sectionOrder && cs.sectionOrder.length ? cs.sectionOrder : defaultOrder;
  // Retour d'une recharge SMS (Stripe Checkout) : créditer le solde tout de
  // suite (fallback idempotent, sans attendre le webhook — utile en local).
  if (req.query.smsTopupSuccess && req.query.session_id) {
    try {
      const s = await stripe.checkout.sessions.retrieve(req.query.session_id);
      if (["paid", "no_payment_required"].includes(s.payment_status) && s.metadata?.type === "sms_topup") {
        const { creditSmsTopup } = require("./account.controller");
        await creditSmsTopup(s.metadata.userId, s.id, parseInt(s.metadata.amountCents, 10) || 0);
        const fresh = await User.findById(req.user._id).select("smsBalanceCents").lean();
        if (fresh) req.user.smsBalanceCents = fresh.smsBalanceCents;
      }
    } catch (e) { console.error("[smsTopup fallback]", e.message); }
  }

  const { getSmsQuota } = require("../utils/planLimits");
  const { SMS_PRICE_CENTS } = require("../utils/sms");
  const smsQuota = getSmsQuota(res.locals.billingUser); // quota inclus du plan
  const smsUsage = req.user.smsUsage || {};
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const smsUsedThisMonth = smsUsage.monthKey === currentMonthKey ? (smsUsage.count || 0) : 0;
  const smsAutoRecharge = req.user.smsAutoRecharge || {};
  return res.render("admin/customize", {
    pageName: "Customize",
    title: res.locals.t.customize.title,
    // Identité RÉSOLUE de l'établissement courant. La vue lit `estab.location`,
    // `estab.instagramLink`… : sans cette ligne elle plantait sur un `estab`
    // indéfini, et la page entière renvoyait une erreur JSON.
    estab: identityFor(res.locals.currentCompany, req.user),
    calendarSettings: cs,
    gallery:      cs.gallery   || [],
    equipment:    cs.equipment || [],
    isPro:        res.locals.isPro,
    currentPlan:  res.locals.currentPlan,
    services:     getServices(res.locals.lang),
    currentCompany: res.locals.currentCompany,
    canUseSocial,
    canUseCustomUrl,
    sectionOrder,
    smsQuota,
    smsUsedThisMonth,
    smsBalanceCents: req.user.smsBalanceCents || 0,
    smsPriceCents:   SMS_PRICE_CENTS,
    smsAutoRecharge: {
      enabled:        !!smsAutoRecharge.enabled,
      thresholdEuros: Math.round((smsAutoRecharge.thresholdCents || 500) / 100),
      amountEuros:    Math.round((smsAutoRecharge.amountCents || 2000) / 100),
    },
  });
};

// ── Page SMS dédiée ────────────────────────────────────────────────────────
exports.smsPage = async (req, res) => {
  // Retour d'une recharge SMS (Stripe Checkout) : créditer tout de suite.
  if (req.query.smsTopupSuccess && req.query.session_id) {
    try {
      const s = await stripe.checkout.sessions.retrieve(req.query.session_id);
      if (["paid", "no_payment_required"].includes(s.payment_status) && s.metadata?.type === "sms_topup") {
        const { creditSmsTopup } = require("./account.controller");
        await creditSmsTopup(s.metadata.userId, s.id, parseInt(s.metadata.amountCents, 10) || 0);
        const fresh = await User.findById(req.user._id).select("smsBalanceCents").lean();
        if (fresh) req.user.smsBalanceCents = fresh.smsBalanceCents;
      }
    } catch (e) { console.error("[smsTopup fallback]", e.message); }
  }

  const cs = req.user.calendarSettings || {};
  const { getSmsQuota } = require("../utils/planLimits");
  const { SMS_PRICE_CENTS } = require("../utils/sms");
  const { isWhatsappConfigured, WHATSAPP_PRICE_CENTS } = require("../utils/whatsapp");
  const smsQuota = getSmsQuota(res.locals.billingUser);
  const smsUsage = req.user.smsUsage || {};
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const smsUsedThisMonth = smsUsage.monthKey === currentMonthKey ? (smsUsage.count || 0) : 0;
  const ar = req.user.smsAutoRecharge || {};

  return res.render("admin/sms", {
    pageName: "Sms",
    title: "SMS & WhatsApp — BranShee",
    calendarSettings: cs,
    isPro:       res.locals.isPro,
    currentPlan: res.locals.currentPlan,
    currentCompany: res.locals.currentCompany,
    smsQuota,
    smsUsedThisMonth,
    smsBalanceCents: req.user.smsBalanceCents || 0,
    smsPriceCents:   SMS_PRICE_CENTS,
    whatsappConfigured: isWhatsappConfigured(),
    whatsappPriceCents: WHATSAPP_PRICE_CENTS,
    smsAutoRecharge: {
      enabled:        !!ar.enabled,
      thresholdEuros: Math.round((ar.thresholdCents || 500) / 100),
      amountEuros:    Math.round((ar.amountCents || 2000) / 100),
      lastFailureAt:  ar.lastFailureAt || null,
    },
  });
};

exports.saveSectionOrder = async (req, res) => {
  try {
    const allowed = ['about', 'location', 'hours', 'gallery', 'reviews'];
    const order   = (req.body.order || []).filter(s => allowed.includes(s));
    if (!order.length) return res.status(400).json({ error: "Ordre invalide." });
    await User.findByIdAndUpdate(req.user._id, {
      "calendarSettings.sectionOrder": order,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Paramètres pré-paiement ───────────────────────────────────────────────────
exports.saveNotificationSettings = async (req, res) => {
  try {
    const { newBooking } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      "notifications.newBooking": !!newBooking,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("saveNotificationSettings error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.savePrepaymentSettings = async (req, res) => {
  try {
    if (!atLeast(res.locals.billingUser, "pro")) {
      return res.status(403).json({ error: "Fonctionnalité réservée au plan Pro." });
    }
    const { enabled, required, cash, cardOnSite,
            bankTransferEnabled, iban, bic, bankName, bankNote,
            paypalEnabled, paypalMe,
            qrCodeEnabled, qrCodeNote } = req.body;
    const companyId = res.locals.currentCompany._id;

    await Company.findByIdAndUpdate(companyId, {
      "prepayment.enabled":  !!enabled,
      "prepayment.required": !!required,
      // Modes de paiement acceptés
      "acceptedPayments.cash":                  !!cash,
      "acceptedPayments.cardOnSite":            !!cardOnSite,
      "acceptedPayments.bankTransfer.enabled":  !!bankTransferEnabled,
      "acceptedPayments.bankTransfer.iban":     (iban     || "").trim().replace(/\s/g, ""),
      "acceptedPayments.bankTransfer.bic":      (bic      || "").trim().toUpperCase(),
      "acceptedPayments.bankTransfer.bankName": (bankName || "").trim(),
      "acceptedPayments.bankTransfer.note":     (bankNote || "").trim(),
      "acceptedPayments.paypal.enabled":        !!paypalEnabled,
      "acceptedPayments.paypal.paypalMe":       (paypalMe || "").trim().replace(/^https?:\/\/paypal\.me\//i, ""),
      "acceptedPayments.qrCode.enabled":        !!qrCodeEnabled,
      "acceptedPayments.qrCode.note":           (qrCodeNote || "").trim(),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("savePrepaymentSettings error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── QR code de paiement (photo) ─────────────────────────────────────────────
exports.uploadPaymentQrCode = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Aucune image reçue." });
    const companyId = res.locals.currentCompany._id;
    const imagePath = `/uploads/profiles/${req.file.filename}`;
    await Company.findByIdAndUpdate(companyId, {
      "acceptedPayments.qrCode.imageUrl": imagePath,
    });
    res.json({ success: true, path: imagePath });
  } catch (err) {
    console.error("uploadPaymentQrCode error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur." });
  }
};

exports.deletePaymentQrCode = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    await Company.findByIdAndUpdate(companyId, {
      "acceptedPayments.qrCode.imageUrl": "",
    });
    res.json({ success: true });
  } catch (err) {
    console.error("deletePaymentQrCode error:", err);
    res.status(500).json({ success: false, message: "Erreur serveur." });
  }
};

// ── Politique d'annulation ────────────────────────────────────────────────────
exports.saveCancellationPolicy = async (req, res) => {
  try {
    if (!atLeast(res.locals.billingUser, "pro")) {
      return res.status(403).json({ error: "Fonctionnalité réservée au plan Pro." });
    }
    const { rule } = req.body;
    const validRules = ["free", "half_24h", "full_12h"];
    if (!validRules.includes(rule)) return res.status(400).json({ error: "Règle invalide." });
    await Company.findByIdAndUpdate(res.locals.currentCompany._id, {
      "cancellationPolicy.rule": rule,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("saveCancellationPolicy error:", err);
    res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Stripe Connect (Express — onboarding hébergé par Stripe) ─────────────────

/**
 * Démarre l'onboarding Express :
 *   1. Crée un compte Express Stripe (ou réutilise un compte "pending" existant)
 *   2. Génère un lien d'onboarding hébergé par Stripe
 *   3. Redirige l'admin vers ce lien
 * → Aucun ca_xxx / STRIPE_CONNECT_CLIENT_ID requis.
 */
exports.initiateStripeConnect = async (req, res) => {
  try {
    const { hasPermission } = require("../utils/permissions");
    if (!hasPermission(res, "billing.manage")) {
      return res.redirect("/settings?stripeConnectError=owner_only");
    }
    const baseUrl   = env.appBaseUrl || "https://www.branshee.com";
    const companyId = res.locals.currentCompany._id.toString();

    // ── 1. Compte Express : réutiliser si "pending", sinon créer ─────────────
    let accountId = res.locals.currentCompany?.stripeConnect?.accountId;
    const currentStatus = res.locals.currentCompany?.stripeConnect?.status;

    if (!accountId || currentStatus === "not_connected") {
      const account = await stripe.accounts.create({
        type: "express",
        capabilities: {
          card_payments: { requested: true },
          transfers:     { requested: true },
        },
        metadata: { companyId },
        ...(req.user?.email && { email: req.user.email }),
      });
      accountId = account.id;

      // Sauvegarder le compte en attente
      await Company.findByIdAndUpdate(companyId, {
        "stripeConnect.accountId":    accountId,
        "stripeConnect.status":       "pending",
        "stripeConnect.accountEmail": req.user?.email || "",
      });
    }

    // ── 2. Générer le lien d'onboarding ──────────────────────────────────────
    const accountLink = await stripe.accountLinks.create({
      account:     accountId,
      refresh_url: `${baseUrl}/settings/stripe-connect/refresh?accountId=${accountId}`,
      return_url:  `${baseUrl}/settings/stripe-connect/return?accountId=${accountId}`,
      type:        "account_onboarding",
    });

    return res.redirect(accountLink.url);
  } catch (err) {
    const code = err?.type || err?.code || "init";
    const msg  = err?.message || "";
    console.error("initiateStripeConnect (Express) error:", code, msg, err);
    if ((msg || "").toLowerCase().includes("managing losses") || (msg || "").toLowerCase().includes("responsibilities of managing")) {
      return res.redirect("/settings?stripeConnectError=losses_liability");
    }
    if ((msg || "").toLowerCase().includes("platform profile") || (msg || "").toLowerCase().includes("complete your platform")) {
      return res.redirect("/settings?stripeConnectError=platform_incomplete");
    }
    return res.redirect(`/settings?stripeConnectError=${encodeURIComponent(code)}&stripeMsg=${encodeURIComponent(msg.substring(0, 120))}`);
  }
};

/**
 * Retour après onboarding Stripe Express.
 * Stripe redirige ici même si l'onboarding n'est pas terminé —
 * on vérifie details_submitted pour savoir si c'est complet.
 */
exports.stripeConnectReturn = async (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.redirect("/settings?stripeConnectError=missing_account");

  try {
    const account = await stripe.accounts.retrieve(accountId);
    const isComplete = !!(account.details_submitted);
    const email = account.email || account.business_profile?.support_email || "";

    const company = await Company.findOne({ "stripeConnect.accountId": accountId });
    if (!company) return res.redirect("/settings?stripeConnectError=not_found");

    await Company.findByIdAndUpdate(company._id, {
      "stripeConnect.status":       isComplete ? "active" : "pending",
      "stripeConnect.accountEmail": email,
    });

    if (isComplete) {
      return res.redirect("/settings?stripeConnectSuccess=1");
    } else {
      // Onboarding non terminé — on peut lui proposer de continuer
      return res.redirect("/settings?stripeConnectError=incomplete");
    }
  } catch (err) {
    console.error("stripeConnectReturn error:", err);
    return res.redirect(`/settings?stripeConnectError=${encodeURIComponent(err.message || "return_error")}`);
  }
};

/**
 * Refresh : le lien d'onboarding a expiré — on en régénère un.
 */
exports.stripeConnectRefresh = async (req, res) => {
  const { accountId } = req.query;
  if (!accountId) return res.redirect("/settings?stripeConnectError=refresh");

  try {
    const baseUrl = env.appBaseUrl || "https://www.branshee.com";
    const accountLink = await stripe.accountLinks.create({
      account:     accountId,
      refresh_url: `${baseUrl}/settings/stripe-connect/refresh?accountId=${accountId}`,
      return_url:  `${baseUrl}/settings/stripe-connect/return?accountId=${accountId}`,
      type:        "account_onboarding",
    });
    return res.redirect(accountLink.url);
  } catch (err) {
    console.error("stripeConnectRefresh error:", err);
    return res.redirect("/settings?stripeConnectError=refresh");
  }
};

/** Déconnecte le compte Stripe Connect (supprime la liaison en DB) */
exports.savePayoutInfo = async (req, res) => {
  try {
    const { method, iban, bic, paypalEmail, other } = req.body;
    const allowed = ["bank_transfer", "paypal", "cash", "other"];
    if (!method || !allowed.includes(method)) {
      return res.status(400).json({ error: "Moyen de paiement invalide." });
    }
    const company = res.locals.currentCompany;
    await Company.findByIdAndUpdate(company._id, {
      "payoutInfo.method":      method,
      "payoutInfo.iban":        iban        || "",
      "payoutInfo.bic":         bic         || "",
      "payoutInfo.paypalEmail": paypalEmail || "",
      "payoutInfo.other":       other       || "",
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("savePayoutInfo error:", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.disconnectStripeConnect = async (req, res) => {
  try {
    const { hasPermission } = require("../utils/permissions");
    if (!hasPermission(res, "billing.manage")) {
      return res.status(403).json({ error: "Vous n'avez pas la permission d'effectuer cette action." });
    }
    const company = res.locals.currentCompany;
    await Company.findByIdAndUpdate(company._id, {
      "stripeConnect.accountId":    "",
      "stripeConnect.status":       "not_connected",
      "stripeConnect.accountEmail": "",
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("disconnectStripeConnect error:", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

/** Sauvegarde manuelle d'un compte Stripe (acct_xxx) — fallback pour les pros qui ont déjà un compte */
exports.saveStripeAccountManual = async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!accountId || !accountId.startsWith("acct_")) {
      return res.status(400).json({ error: "Identifiant invalide. Il doit commencer par acct_" });
    }
    let accountEmail = "";
    try {
      const account = await stripe.accounts.retrieve(accountId);
      accountEmail = account.email || account.business_profile?.support_email || "";
    } catch (_) {
      return res.status(400).json({ error: "Compte Stripe introuvable." });
    }
    const companyId = res.locals.currentCompany._id;
    await Company.findByIdAndUpdate(companyId, {
      "stripeConnect.accountId":    accountId,
      "stripeConnect.status":       "active",
      "stripeConnect.accountEmail": accountEmail,
    });
    return res.json({ success: true, accountEmail });
  } catch (err) {
    console.error("saveStripeAccountManual error:", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.supportPage = async (req, res) => {
  const SupportContent = require("../db/models/supportContent.model");
  let doc = await SupportContent.findOne().lean();
  const sections = doc ? doc.sections.sort((a, b) => a.order - b.order) : [];
  return res.render("admin/support", {
    pageName: "Support",
    title: "Support — BranShee",
    sections,
  });
};

// ── Chat support (utilisateur) ──────────────────────────────────────────────
// Un seul fil de discussion par utilisateur avec le founder (superadmin).
exports.getSupportChat = async (req, res) => {
  try {
    const SupportChat = require("../db/models/supportChat.model");
    let chat = await SupportChat.findOneAndUpdate(
      { user: req.user._id },
      {
        $setOnInsert: {
          user: req.user._id,
          businessName: req.user.businessName || req.user.fullName || "",
          email: req.user.email || "",
        },
      },
      { upsert: true, new: true }
    );
    if (chat.unreadByUser > 0) {
      chat.unreadByUser = 0;
      await chat.save();
    }
    return res.json({ success: true, messages: chat.messages });
  } catch (err) {
    console.error("getSupportChat error:", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.getSupportChatUnreadCount = async (req, res) => {
  try {
    const SupportChat = require("../db/models/supportChat.model");
    const chat = await SupportChat.findOne({ user: req.user._id }).select("unreadByUser").lean();
    return res.json({ success: true, unread: chat ? chat.unreadByUser : 0 });
  } catch (err) {
    return res.json({ success: true, unread: 0 });
  }
};

exports.sendSupportChatMessage = async (req, res) => {
  try {
    const text = (req.body.text || "").trim();
    if (!text) return res.status(400).json({ error: "Message vide." });
    const SupportChat = require("../db/models/supportChat.model");
    const chat = await SupportChat.findOneAndUpdate(
      { user: req.user._id },
      {
        $push: { messages: { sender: "user", text } },
        $inc: { unreadByAdmin: 1 },
        $set: {
          lastMessageAt: new Date(),
          businessName: req.user.businessName || req.user.fullName || "",
          email: req.user.email || "",
        },
      },
      { upsert: true, new: true }
    );
    const io = req.app.get("io");
    if (io) {
      const lastMsg = chat.messages[chat.messages.length - 1];
      io.to("superadmin").emit("support:newMessage", {
        userId: String(req.user._id),
        businessName: chat.businessName,
        email: chat.email,
        text: lastMsg.text,
        sender: "user",
        createdAt: lastMsg.createdAt,
      });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("sendSupportChatMessage error:", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// Note de satisfaction laissée après la fermeture d'une conversation par l'admin.
exports.rateSupportChat = async (req, res) => {
  try {
    const rating = Number(req.body.rating);
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Note invalide." });
    }
    const SupportRating = require("../db/models/supportRating.model");
    await SupportRating.create({ user: req.user._id, rating });
    return res.json({ success: true });
  } catch (err) {
    console.error("rateSupportChat error:", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

exports.parrainage = async (req, res) => {
  const filleuls = await User.find({ referredBy: req.user._id })
    .select("fullName email isPremium subscription createdAt referralPaidCounted")
    .lean();
  const referralCode = req.user.referralCode || "";
  const referral = req.user.referral || { totalInvited: 0, totalPaying: 0, creditMonths: 0 };
  const referralLink = `https://www.branshee.com/register?ref=${referralCode}`;
  return res.render("admin/parrainage", {
    pageName: "Parrainage",
    title: "Parrainage — BranShee",
    referralCode,
    referral,
    filleuls,
    referralLink,
    qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(referralLink)}`,
  });
};

exports.parrainageClaim = async (req, res) => {
  try {
    const user = req.user;
    const referral = user.referral || {};
    const totalPaying = referral.totalPaying || 0;
    const creditMonths = referral.creditMonths || 0;
    const claimable = Math.floor(totalPaying / 3) * 2 - creditMonths;
    if (claimable <= 0) {
      return res.status(400).json({ error: "Aucun crédit à réclamer pour le moment." });
    }

    const subId = user.subscription?.stripeSubscriptionId;
    let applied = false;

    // ── Application réelle : 100% de réduction sur les `claimable` prochaines
    // factures de l'abonnement Stripe actif du parrain. ─────────────────────
    if (subId) {
      try {
        const coupon = await stripe.coupons.create({
          percent_off: 100,
          duration: claimable > 1 ? "repeating" : "once",
          duration_in_months: claimable > 1 ? claimable : undefined,
          name: `Parrainage — ${claimable} mois offert${claimable > 1 ? "s" : ""}`,
        });
        await stripe.subscriptions.update(subId, { coupon: coupon.id });
        applied = true;
      } catch (stripeErr) {
        console.error("[parrainageClaim] Stripe coupon error:", stripeErr.message);
      }
    }

    // Crédit marqué comme réclamé dans tous les cas — si Stripe a échoué
    // (pas d'abonnement actif, erreur API), le mois reste dû et sera régularisé
    // manuellement (email envoyé ci-dessous), mais on ne fait jamais perdre le
    // crédit ni recompter une 2e fois la même tranche.
    await User.findByIdAndUpdate(user._id, { $inc: { "referral.creditMonths": claimable } });

    try {
      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      });
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: require("../utils/adressesContact").adminEmail(),
        subject: `[Parrainage] Récompense réclamée — ${user.fullName}`,
        text: `Utilisateur : ${user.fullName} (${user.email})\nID : ${user._id}\nFilleuls payants : ${totalPaying}\nMois accordés : ${claimable}\nAppliqué automatiquement sur Stripe : ${applied ? "OUI" : "NON — à régulariser manuellement (pas d'abonnement actif trouvé)"}\n`,
      });
    } catch (mailErr) {
      console.error("[parrainageClaim] Email notification error:", mailErr.message);
    }

    return res.json({ success: true, claimable, applied });
  } catch (err) {
    console.error("parrainageClaim error:", err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Onboarding (checklist du dashboard) ─────────────────────────────────────
// Deux petits endpoints appelés en fetch() depuis le widget de démarrage :
// masquer la checklist, et valider l'étape « partager mon lien » au clic.
exports.onboardingDismiss = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false });
    await User.updateOne({ _id: req.user._id }, { $set: { "onboarding.dismissed": true } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[onboardingDismiss]", err);
    return res.status(500).json({ success: false });
  }
};

exports.onboardingLinkShared = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ success: false });
    await User.updateOne({ _id: req.user._id }, { $set: { "onboarding.linkShared": true } });
    return res.json({ success: true });
  } catch (err) {
    console.error("[onboardingLinkShared]", err);
    return res.status(500).json({ success: false });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
//  DEMANDES DE RENDEZ-VOUS EN ATTENTE
//  ─────────────────────────────────────────────────────────────────────────
//  N'existent que lorsque l'établissement a désactivé la confirmation
//  automatique (Company.autoConfirm = false) : la réservation du client est
//  alors créée en `status: "pending"` et occupe déjà le créneau, en attendant
//  que le pro l'accepte ou la refuse ici.
// ═══════════════════════════════════════════════════════════════════════════

exports.pendingBookingsPage = async (req, res) => {
  const currentCompany = res.locals.currentCompany;
  if (!currentCompany) return res.redirect("/etablissement/mes-etablissements");

  const debutDuJour = new Date();
  debutDuJour.setHours(0, 0, 0, 0);

  // Les demandes pour une date PASSÉE sont listées à part : il n'y a plus rien
  // à valider, mais les masquer entièrement laisserait le pro sans explication
  // sur un créneau resté occupé.
  const [aVenir, passees, societe] = await Promise.all([
    Booking.find({ company: currentCompany._id, status: "pending", date: { $gte: debutDuJour } })
      .sort({ date: 1, startTime: 1 }).lean(),
    Booking.find({ company: currentCompany._id, status: "pending", date: { $lt: debutDuJour } })
      .sort({ date: -1, startTime: -1 }).limit(30).lean(),
    Company.findById(currentCompany._id).select("autoConfirm").lean(),
  ]);

  res.render("admin/pending-bookings", {
    pageName: "PendingBookings",
    title: "Demandes de rendez-vous",
    demandes: aVenir,
    demandesPassees: passees,
    autoConfirm: societe?.autoConfirm !== false,
  });
};

// Accepter : la demande devient un rendez-vous confirmé.
exports.confirmPendingBooking = async (req, res) => {
  try {
    const { id } = req.params;
    // Filtre sur `status: "pending"` autant que sur l'établissement : évite de
    // « re-confirmer » un RDV déjà annulé, et rend l'appel idempotent.
    const booking = await Booking.findOneAndUpdate(
      { _id: id, company: res.locals.currentCompany?._id, status: "pending" },
      { status: "confirmed" },
      { new: true },
    ).lean();
    if (!booking) {
      return res.status(404).json({ success: false, message: "Cette demande n'existe plus ou a déjà été traitée." });
    }

    const companyDoc = await Company.findById(booking.company);
    logActivity({
      company: booking.company,
      user: req.user,
      role: await resolveActorRole(companyDoc, req.user),
      action: "booking.confirm",
      description: `a accepté la demande de ${booking.name || ""} ${booking.surname || ""}`.trim(),
    });

    if (booking.email) {
      try {
        const html = pug.renderFile(path.join(__dirname, "../views/templates/emails/booking-confirmed-request.pug"), {
          name: booking.name || "",
          surname: booking.surname || "",
          date: booking.date,
          startHour: booking.startTime || "",
          endHour: booking.endTime || "",
          serviceName: booking.serviceName || "",
          companyName: companyDoc?.name || "",
        });
        await sendEmail(booking.email, "Votre rendez-vous est confirmé — BranShee", html);
      } catch (mailErr) {
        console.error("Confirm request email error:", mailErr.message);
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[confirmPendingBooking]", err);
    return res.status(500).json({ success: false, message: "Erreur serveur." });
  }
};

// Refuser : la demande est annulée et le créneau redevient libre.
// Volontairement SANS la barrière « forfait Pro » de cancelBooking : le pro a
// pu activer la validation manuelle quel que soit son forfait, il doit
// pouvoir refuser sans être bloqué — sinon la demande resterait éternellement
// en attente à occuper le créneau.
exports.refusePendingBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const motif = String(req.body?.motif || "").trim().slice(0, 500);

    const booking = await Booking.findOneAndUpdate(
      { _id: id, company: res.locals.currentCompany?._id, status: "pending" },
      { status: "canceled" },
      { new: true },
    ).lean();
    if (!booking) {
      return res.status(404).json({ success: false, message: "Cette demande n'existe plus ou a déjà été traitée." });
    }

    const companyDoc = await Company.findById(booking.company);
    logActivity({
      company: booking.company,
      user: req.user,
      role: await resolveActorRole(companyDoc, req.user),
      action: "booking.refuse",
      description: `a refusé la demande de ${booking.name || ""} ${booking.surname || ""}`.trim(),
    });

    if (booking.email) {
      try {
        const html = pug.renderFile(path.join(__dirname, "../views/templates/emails/booking-refused.pug"), {
          name: booking.name || "",
          surname: booking.surname || "",
          date: booking.date,
          startHour: booking.startTime || "",
          serviceName: booking.serviceName || "",
          companyName: companyDoc?.name || "",
          motif,
        });
        await sendEmail(booking.email, "Votre demande de rendez-vous n'a pas pu être acceptée", html);
      } catch (mailErr) {
        console.error("Refuse request email error:", mailErr.message);
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[refusePendingBooking]", err);
    return res.status(500).json({ success: false, message: "Erreur serveur." });
  }
};
