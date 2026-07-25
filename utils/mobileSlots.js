// ── Créneaux disponibles pour l'API mobile ────────────────────────────────
// Reproduit la grille horaire du web (booking.controller.js#getSchedule) puis
// en retire les créneaux occupés en appliquant EXACTEMENT les mêmes règles de
// chevauchement que la création (utils/bookingConflict.js) — un créneau
// proposé ici doit toujours être acceptable par POST /bookings.
//
// Note : contrairement au parcours public, on n'applique pas le délai minimum
// de réservation — un gérant doit pouvoir caler un RDV dans 10 minutes.
const Company = require("../db/models/company/company.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const DaysOff = require("../db/models/company/daysOff.model");
const Booking = require("../db/models/book.model");
const { getCoursesForDate, courseRangesFor } = require("./recurringCourses");
const { getBookableTeam } = require("./bookableTeam");

function hhmmToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}
function minutesToHhmm(total) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// Construit la grille horaire brute du jour (avant retrait des créneaux pris).
async function buildGrid({ company, dateStr, weekdayIndex, employeeId, duration }) {
  // Horaire individuel si l'établissement est en mode "par employé".
  let baseSchedule = company.schedule || [];
  const specificEmp = employeeId && employeeId !== "all";
  if (specificEmp && company.scheduleMode === "perEmployee") {
    let individual;
    if (String(company.owner) === String(employeeId)) {
      individual = company.ownerEmployeeProfile?.schedule;
    } else {
      const membership = await CompanyMembership.findOne({ company: company._id, user: employeeId })
        .select("schedule").lean();
      individual = membership?.schedule;
    }
    if (individual && individual.length > 0) baseSchedule = individual;
  }

  let target = baseSchedule.find((d) => d.weekdayIndex === weekdayIndex);

  // Exceptions de dates (congés / horaires spéciaux), ciblées ou globales.
  const exceptionsDoc = await DaysOff.findOne({ company: company._id }).lean();
  if (exceptionsDoc?.dates?.length) {
    const relevant = exceptionsDoc.dates.find((d) => {
      if (new Date(d.date).toISOString().split("T")[0] !== dateStr) return false;
      const empIds = (d.employees || []).map((e) => String(e));
      if (specificEmp) return empIds.length === 0 || empIds.includes(String(employeeId));
      return empIds.length === 0;
    });
    if (relevant) {
      if (relevant.workingHours?.length && relevant.workingHours[0].start) {
        target = relevant; // journée avec horaires spéciaux
      } else {
        return { slots: [], closed: true, reason: "day_off" };
      }
    }
  }

  if (!target || target.dayOff || !(target.workingHours || []).length) {
    return { slots: [], closed: true, reason: "day_off" };
  }

  // "fixed" : un créneau par durée de prestation. "interval" : un créneau
  // toutes les slotInterval minutes, quelle que soit la durée.
  const step = company.slotMode === "interval" ? company.slotInterval || 30 : duration;

  const slots = [];
  target.workingHours.forEach((period) => {
    let current = hhmmToMinutes(period.start);
    const endTotal = hhmmToMinutes(period.end);
    // La prestation doit pouvoir se terminer avant la fin de la plage.
    while (current + duration <= endTotal) {
      slots.push(current);
      current += step;
    }
  });

  return { slots, closed: false };
}

// Retourne les créneaux libres d'un jour, au format ["09:00", "09:30", …].
async function getAvailableSlots({ companyId, dateStr, serviceDuration, employeeId }) {
  const company = await Company.findById(companyId)
    .select("schedule slotTime slotMode slotInterval scheduleMode owner ownerEmployeeProfile.schedule")
    .lean();
  if (!company) return { slots: [], closed: true, reason: "company_not_found" };

  const duration = Number(serviceDuration) > 0 ? Number(serviceDuration) : company.slotTime || 30;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayDate = new Date(y, m - 1, d);
  const weekdayIndex = dayDate.getDay();

  const grid = await buildGrid({ company, dateStr, weekdayIndex, employeeId, duration });
  if (grid.closed) return { slots: [], closed: true, reason: grid.reason, duration };

  // On charge une seule fois ce qui occupe la journée, puis on filtre en
  // mémoire — même résultat que d'appeler checkBookingConflict par créneau,
  // sans en payer le coût en requêtes.
  const specificEmp = employeeId && employeeId !== "all";
  const team = await getBookableTeam(companyId);
  const courses = await getCoursesForDate(companyId, dateStr);

  const dayBookings = await Booking.find({
    company: companyId,
    date: new Date(dateStr),
    status: { $ne: "canceled" },
  }).select("startTime slotTime employee").lean();

  // Plages occupées par employé (RDV + cours collectifs).
  const busyByEmployee = new Map();
  team.forEach((mem) => busyByEmployee.set(mem.id, courseRangesFor(courses, mem.id)));
  const busyForSpecific = specificEmp ? courseRangesFor(courses, employeeId).slice() : null;

  dayBookings.forEach((b) => {
    const bStart = hhmmToMinutes(b.startTime);
    const range = [bStart, bStart + (b.slotTime || duration)];
    if (b.employee == null) {
      // RDV non assigné : bloque tout le monde.
      team.forEach((mem) => busyByEmployee.get(mem.id).push(range));
      if (busyForSpecific) busyForSpecific.push(range);
    } else {
      const empId = String(b.employee);
      if (busyByEmployee.has(empId)) busyByEmployee.get(empId).push(range);
      if (specificEmp && empId === String(employeeId)) busyForSpecific.push(range);
    }
  });

  const overlaps = (ranges, s, e) => ranges.some(([rs, re]) => s < re && e > rs);

  // Sur aujourd'hui, on masque les créneaux déjà passés.
  const now = new Date();
  const isToday =
    now.getFullYear() === y && now.getMonth() === m - 1 && now.getDate() === d;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const free = grid.slots.filter((start) => {
    const end = start + duration;
    if (isToday && start < nowMinutes) return false;

    if (specificEmp) return !overlaps(busyForSpecific, start, end);

    // Sans employé choisi : libre tant qu'AU MOINS un membre est disponible.
    // Équipe vide → aucun créneau (cohérent avec checkBookingConflict).
    return team.some((mem) => !overlaps(busyByEmployee.get(mem.id) || [], start, end));
  });

  return { slots: free.map(minutesToHhmm), closed: false, duration };
}

module.exports = { getAvailableSlots, hhmmToMinutes, minutesToHhmm };
