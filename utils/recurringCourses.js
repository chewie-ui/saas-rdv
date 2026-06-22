const Service = require("../db/models/company/service.model");

// Jour de la semaine d'une date, au format JS Date#getDay() (0=dimanche…6=samedi)
// — même convention que company.schedule[].weekdayIndex et DaysOff.
function weekdayOf(dateInput) {
  return new Date(dateInput).getDay();
}

// Tous les cours collectifs actifs qui ont lieu (récurrence hebdomadaire) le
// jour de la semaine correspondant à `dateInput`, pour cette entreprise.
async function getCoursesForDate(companyId, dateInput) {
  const weekday = weekdayOf(dateInput);
  return Service.find({
    company: companyId,
    type: "group",
    active: true,
    "recurring.enabled": true,
    "recurring.weekdays": weekday,
  })
    .select("name duration recurring employees")
    .lean();
}

function courseRange(course) {
  const [h, m] = course.recurring.startTime.split(":").map(Number);
  const start = h * 60 + m;
  return [start, start + (course.duration || 30)];
}

// Plages occupées (en minutes depuis minuit) par des cours collectifs pour un
// employé donné, sur les cours déjà filtrés pour le bon jour (`getCoursesForDate`).
// Un cours sans employé assigné bloque TOUT LE MONDE (y compris employeeId=null,
// utilisé quand l'entreprise n'a aucun employé) ; un cours avec des employés
// assignés ne bloque que ceux-là.
function courseRangesFor(courses, employeeId) {
  return courses
    .filter((c) => {
      const assigned = (c.employees || []).map(String);
      if (assigned.length === 0) return true;
      return employeeId ? assigned.includes(String(employeeId)) : false;
    })
    .map(courseRange);
}

module.exports = { weekdayOf, getCoursesForDate, courseRange, courseRangesFor };
