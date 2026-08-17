// ── Détection de chevauchement de créneau ─────────────────────────────────
// Logique critique : c'est elle qui empêche de double-réserver un praticien.
// Extraite de controllers/admin.controller.js pour être partagée avec l'API
// mobile — les deux chemins de création DOIVENT appliquer exactement les mêmes
// règles, sinon l'app pourrait créer des RDV que le web refuserait.
//
// Retourne un message d'erreur en français, ou null si le créneau est libre.
const { getCoursesForDate, courseRangesFor } = require("./recurringCourses");
const { getBookableTeam } = require("./bookableTeam");

// Contrat historique conservé : renvoie un message d'erreur, ou null.
async function checkBookingConflict(options) {
  const { message } = await inspectBookingConflict(options);
  return message;
}

// Même logique, mais renvoie le détail : { message, hadConflict }.
// `hadConflict` sert au surbooking — quand l'établissement l'autorise, on
// laisse passer la réservation MAIS on doit savoir qu'elle chevauche pour la
// marquer `overbooked: true` (cf. l'index unique de book.model.js).
async function inspectBookingConflict({
  Booking,
  currentCompany,
  date,
  startTimeInMinutes,
  endTimeInMinutes,
  employeeId,
  actualDuration,
  excludeBookingId,
}) {
  const baseConflictQuery = { company: currentCompany, date: new Date(date), status: { $ne: "canceled" } };
  if (excludeBookingId) baseConflictQuery._id = { $ne: excludeBookingId };

  function overlapsRange(b) {
    const [bh, bm] = b.startTime.split(":").map(Number);
    const bStart = bh * 60 + bm;
    const bEnd = bStart + (b.slotTime || actualDuration);
    return startTimeInMinutes < bEnd && endTimeInMinutes > bStart;
  }

  if (employeeId) {
    // Inclut les RDV sans employé assigné (employee: null) — ils bloquent tout le monde.
    const overlapping = await Booking.find({
      ...baseConflictQuery,
      $or: [{ employee: employeeId }, { employee: null }],
    }).select("startTime slotTime").lean();
    if (overlapping.some(overlapsRange)) {
      return { message: "Cet employé a déjà un rendez-vous sur ce créneau.", hadConflict: true };
    }

    const coursesForThisDate = await getCoursesForDate(currentCompany, date);
    const courseConflict = courseRangesFor(coursesForThisDate, employeeId)
      .some(([rs, re]) => startTimeInMinutes < re && endTimeInMinutes > rs);
    if (courseConflict) {
      return { message: "Cet employé est en cours collectif sur ce créneau.", hadConflict: true };
    }
    return { message: null, hadConflict: false };
  }

  // Aucun employé précisé — bloqué seulement quand TOUTE l'équipe bookable est
  // occupée. Se réduit naturellement au cas solo (équipe d'1 = le patron) et au
  // cas "personne n'est bookable" (équipe vide → .every() sur un tableau vide
  // vaut toujours true, donc tout est bloqué) sans branche à part.
  const team = await getBookableTeam(currentCompany);

  const teamBookings = await Booking.find({
    ...baseConflictQuery,
    $or: [{ employee: { $in: team.map((m) => m.id) } }, { employee: null }],
  }).select("startTime slotTime employee").lean();

  const coursesForThisDate = await getCoursesForDate(currentCompany, date);
  const busyByEmployee = new Map();
  team.forEach((m) => busyByEmployee.set(m.id, courseRangesFor(coursesForThisDate, m.id)));
  teamBookings.forEach((b) => {
    const [bh, bm] = b.startTime.split(":").map(Number);
    const bStart = bh * 60 + bm;
    const range = [bStart, bStart + (b.slotTime || actualDuration)];
    if (b.employee == null) {
      // RDV sans employé → bloque toute l'équipe
      team.forEach((m) => busyByEmployee.get(m.id).push(range));
    } else {
      const empId = String(b.employee);
      if (!busyByEmployee.has(empId)) return;
      busyByEmployee.get(empId).push(range);
    }
  });

  const allBusy = team.every((m) => {
    const ranges = busyByEmployee.get(m.id) || [];
    return ranges.some(([rs, re]) => startTimeInMinutes < re && endTimeInMinutes > rs);
  });
  return allBusy
    ? { message: "Tous les employés sont déjà occupés sur ce créneau.", hadConflict: true }
    : { message: null, hadConflict: false };
}

module.exports = { checkBookingConflict, inspectBookingConflict };
