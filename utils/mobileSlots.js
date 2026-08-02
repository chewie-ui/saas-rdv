// ── Créneaux disponibles (API mobile) & grille horaire partagée ────────────
// Reproduit la grille horaire du web (booking.controller.js#getSchedule) puis
// en retire les créneaux occupés en appliquant EXACTEMENT les mêmes règles de
// chevauchement que la création (utils/bookingConflict.js) — un créneau
// proposé ici doit toujours être acceptable par POST /bookings.
//
// `buildGrid` sert aussi au site public via `isSlotOpenInSchedule` (voir plus
// bas) : c'est le seul endroit qui relit les absences/congés au moment de la
// confirmation d'une réservation.
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

  // `periods` = les plages de travail RÉELLEMENT retenues pour ce jour (horaire
  // individuel ou commun, remplacé le cas échéant par les horaires spéciaux
  // d'une exception). Exposé pour `isSlotOpenInSchedule`, qui raisonne en
  // plages et non en créneaux — cf. le commentaire de cette fonction.
  return { slots, periods: target.workingHours, closed: false };
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

// ── Le créneau choisi tient-il TOUJOURS dans la grille du jour ? ───────────
// Entre l'affichage des créneaux et la confirmation, le pro a pu poser une
// absence ou modifier son horaire : personne ne le relisait à la soumission,
// la réservation passait quand même. On rejoue donc `buildGrid` (le même code
// que la liste de créneaux : horaire individuel, congés DaysOff ciblés ou
// globaux, horaires spéciaux) au moment du POST.
//
// On ne regarde volontairement PAS les RDV déjà pris : les appelants ont déjà
// leur propre anti double-booking, plus strict car il applique en plus les
// temps tampon. Doubler la vérification ici ferait diverger les deux.
async function isSlotOpenInSchedule({ companyId, dateStr, startTime, duration, employeeId }) {
  // `buildGrid` découpe la date à la main : un objet Date ou un ISO complet
  // produirait une grille silencieusement fausse. Dans le doute on ne bloque
  // rien — refuser une réservation valide coûte plus cher que de laisser
  // passer un cas que les autres contrôles couvrent déjà.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""))) return { ok: true, reason: "unchecked" };
  if (!/^\d{1,2}:\d{2}$/.test(String(startTime || ""))) return { ok: true, reason: "unchecked" };

  const company = await Company.findById(companyId)
    .select("schedule slotTime slotMode slotInterval scheduleMode owner ownerEmployeeProfile.schedule")
    .lean();
  if (!company) return { ok: true, reason: "unchecked" };

  const slotDuration = Number(duration) > 0 ? Number(duration) : company.slotTime || 30;
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekdayIndex = new Date(y, m - 1, d).getDay();

  // "", "null" et "all" veulent tous dire « pas de préférence » selon
  // l'appelant : sans cette normalisation, buildGrid partirait chercher
  // l'horaire individuel d'un employé nommé "null".
  const emp = employeeId && !["all", "null", ""].includes(String(employeeId)) ? employeeId : null;

  const grid = await buildGrid({ company, dateStr, weekdayIndex, employeeId: emp, duration: slotDuration });
  if (grid.closed) return { ok: false, reason: grid.reason };

  // On vérifie que la prestation TIENT DANS une plage de travail, pas qu'elle
  // tombe pile sur un créneau de la grille. Mesuré en lecture seule sur la
  // base de production (90 jours) : 18 RDV sur 124 démarrent à une minute qui
  // n'est pas un multiple du pas (ex: 10h40 avec un pas de 30) — des RDV calés
  // à la main par le pro. Exiger l'alignement exact ferait de ces horaires
  // parfaitement valides des refus, pour ne rien protéger de plus : le pro
  // reste couvert par l'anti double-booking juste après.
  const start = hhmmToMinutes(startTime);
  const tientDansUnePlage = (grid.periods || []).some(
    (p) => start >= hhmmToMinutes(p.start) && start + slotDuration <= hhmmToMinutes(p.end),
  );
  return tientDansUnePlage ? { ok: true } : { ok: false, reason: "out_of_hours" };
}

module.exports = { getAvailableSlots, isSlotOpenInSchedule, hhmmToMinutes, minutesToHhmm };
