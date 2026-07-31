const Service = require("../db/models/company/service.model");

// Jour de la semaine d'une date, au format JS Date#getDay() (0=dimanche…6=samedi)
// — même convention que company.schedule[].weekdayIndex et DaysOff.
function weekdayOf(dateInput) {
  return new Date(dateInput).getDay();
}

// Nombre de minutes entre deux heures "HH:MM" — utilisé pour calculer la
// durée réelle d'une séance ponctuelle, qui peut différer de Service.duration
// (ex: service.duration=60 mais un atelier précis dure 19h00-19h45).
function minutesBetween(startTime, endTime) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

// Tous les cours collectifs actifs qui ont lieu ce jour-là pour cette
// entreprise — récurrence hebdomadaire (recurring.enabled) OU date ponctuelle
// exacte présente dans `sessions[]`. Le résultat est normalisé : un cours en
// mode ponctuel est recopié avec un `recurring.startTime` + une `duration`
// effective tirés de SA séance de ce jour précis, afin que `courseRange` /
// `courseRangesFor` ci-dessous n'aient besoin d'AUCUNE connaissance du mode
// sous-jacent (récurrent vs ponctuel) — ils ne lisent jamais `sessions`.
async function getCoursesForDate(companyId, dateInput) {
  const weekday = weekdayOf(dateInput);
  const dayStart = new Date(dateInput);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const courses = await Service.find({
    company: companyId,
    type: "group",
    active: true,
    $or: [
      { "recurring.enabled": true, "recurring.weekdays": weekday },
      { "recurring.enabled": false, sessions: { $elemMatch: { date: { $gte: dayStart, $lt: dayEnd } } } },
    ],
  })
    .select("name duration recurring sessions employees blocksIndividualBookings")
    .lean();

  return courses.map((c) => {
    if (c.recurring?.enabled) return c;
    const todaySession = (c.sessions || []).find((s) => s.date >= dayStart && s.date < dayEnd);
    if (!todaySession) return c; // garde-fou théorique — déjà filtré par la requête ci-dessus
    const effectiveDuration = todaySession.endTime
      ? minutesBetween(todaySession.startTime, todaySession.endTime)
      : c.duration;
    return {
      ...c,
      recurring: { enabled: true, weekdays: [weekday], startTime: todaySession.startTime },
      duration: effectiveDuration,
    };
  });
}

function courseRange(course) {
  const [h, m] = course.recurring.startTime.split(":").map(Number);
  const start = h * 60 + m;
  // Filet de sécurité sur la durée : une séance enregistrée avec une heure de
  // fin antérieure au début (ex. 13:00 → 00:00, possible avant le durcissement
  // de sanitizeSessions) donnait une durée NÉGATIVE, donc une plage inversée
  // [780, 0] qui ne chevauchait jamais rien — le cours ne bloquait plus aucun
  // créneau, en silence. `> 0` et non `||` : -780 est « truthy ».
  const duration = Number(course.duration) > 0 ? Number(course.duration) : 30;
  return [start, Math.min(start + duration, 24 * 60)];
}

// Plages occupées (en minutes depuis minuit) par des cours collectifs pour un
// employé donné, sur les cours déjà filtrés pour le bon jour (`getCoursesForDate`).
// Un cours sans employé assigné bloque TOUT LE MONDE (y compris employeeId=null,
// utilisé quand l'entreprise n'a aucun employé) ; un cours avec des employés
// assignés ne bloque que ceux-là.
//
// Un cours dont `blocksIndividualBookings` est explicitement `false` n'occupe
// personne : le pro reste réservable en individuel pendant le cours (plusieurs
// salles, cours animé par un tiers…). `!== false` et non `=== true` : les cours
// créés AVANT l'ajout de ce champ n'ont pas la propriété et doivent conserver
// l'ancien comportement (bloquant), sinon ils libéreraient d'un coup des
// créneaux que le pro n'a jamais voulu ouvrir.
function courseRangesFor(courses, employeeId) {
  return courses
    .filter((c) => c.blocksIndividualBookings !== false)
    .filter((c) => {
      const assigned = (c.employees || []).map(String);
      if (assigned.length === 0) return true;
      return employeeId ? assigned.includes(String(employeeId)) : false;
    })
    .map(courseRange);
}

module.exports = { weekdayOf, getCoursesForDate, courseRange, courseRangesFor };
