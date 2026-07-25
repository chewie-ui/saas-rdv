// ── Helpers partagés des contrôleurs mobiles ──────────────────────────────
const pug = require("pug");
const path = require("path");
const Booking = require("../../db/models/book.model");
const Company = require("../../db/models/company/company.model");
const User = require("../../db/models/user.model");
const { sendEmail } = require("../../utils/mailer");
const { deleteEventFromCalendar } = require("../../utils/googleCalendarSync");
const { logActivity } = require("../../utils/activityLog");

// Bornes [minuit, minuit+1j) d'une date "YYYY-MM-DD" en heure locale serveur —
// même construction par composants que le dashboard web (admin.controller.js),
// car Booking.date est stocké à minuit (sans composante horaire).
function dayRange(dateStr) {
  let d;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, day] = dateStr.split("-").map(Number);
    d = new Date(y, m - 1, day);
  } else {
    const now = new Date();
    d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const start = d;
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

// Bornes [début du jour `from`, fin du jour `to`] pour une plage de dates
// "YYYY-MM-DD" incluse des deux côtés. Même construction par composants que
// dayRange, pour rester cohérent avec le stockage de Booking.date.
function rangeBounds(fromStr, toStr) {
  const parse = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const start = parse(fromStr);
  const end = new Date(parse(toStr).getTime() + 86400000); // borne exclusive
  return { start, end };
}

// Sérialise un booking (lean, populé clientRef/employee) pour l'app.
function serializeBooking(b) {
  const clientName =
    b.clientRef?.fullName ||
    [b.name, b.surname].filter(Boolean).join(" ").trim() ||
    "Client";
  return {
    id: String(b._id),
    date: b.date,
    startTime: b.startTime,
    endTime: b.endTime,
    slotTime: b.slotTime,
    status: b.status,
    isGroup: !!b.isGroup,
    isBlock: !!b.isBlock,
    noShow: !!b.noShow,
    serviceName: b.serviceName || "",
    serviceColor: b.serviceColor || "",
    employeeName: b.employeeName || b.employee?.fullName || "",
    employeeId: b.employee?._id ? String(b.employee._id) : b.employee ? String(b.employee) : null,
    client: {
      id: b.clientRef?._id ? String(b.clientRef._id) : null,
      name: clientName,
      email: b.clientRef?.email || b.email || "",
      phone: b.phone || "",
      profilePicture: b.clientRef?.profilePicture || null,
    },
    message: b.message || "",
    adminNotes: b.adminNotes || "",
    payment: {
      method: b.payment?.method || "none",
      status: b.payment?.status || "none",
      amount: b.payment?.amount || 0,
      currency: b.payment?.currency || "eur",
    },
  };
}

// ── Effets de bord d'une annulation ───────────────────────────────────────
// Extrait de bookingWrite.mobile.controller#cancel pour être rejoué à
// l'identique partout où l'app annule un rendez-vous (annulation depuis
// l'agenda, retrait d'un participant d'un cours collectif) : retrait de
// l'agenda Google du gérant, journal d'activité, email au client.
// `booking` est le document AVANT passage en "canceled" (lean).
// Best-effort de bout en bout : aucun échec ici ne doit remonter à l'appelant,
// l'annulation elle-même étant déjà écrite en base.
async function cancelBookingSideEffects({ booking, user, role, description }) {
  try {
    if (booking.googleEventId) {
      const companyDoc = await Company.findById(booking.company).lean();
      const owner = companyDoc ? await User.findById(companyDoc.owner).lean() : null;
      if (owner?.googleCalendar?.connected && owner.googleCalendar.refreshToken) {
        await deleteEventFromCalendar(owner.googleCalendar.refreshToken, booking.googleEventId);
      }
    }
  } catch (e) {
    console.error("[mobile cancel] google:", e.message);
  }

  logActivity({
    company: booking.company,
    user,
    role,
    action: "booking.cancel",
    description:
      description || `a annulé le RDV de ${booking.name || ""} ${booking.surname || ""}`.trim(),
  });

  // Jamais d'email pour un bloc d'indisponibilité : il n'a pas de client.
  if (booking.email && !booking.isBlock) {
    try {
      const html = pug.renderFile(
        path.join(__dirname, "../../views/templates/emails/booking-cancelled.pug"),
        {
          name: booking.name || "",
          surname: booking.surname || "",
          date: booking.date,
          startHour: booking.startTime || "",
          endHour: booking.endTime || "",
        },
      );
      sendEmail(booking.email, "Votre rendez-vous a été annulé", html).catch(() => {});
    } catch (e) {
      console.error("[mobile cancel] email:", e.message);
    }
  }
}

module.exports = { dayRange, rangeBounds, serializeBooking, cancelBookingSideEffects, Booking };
