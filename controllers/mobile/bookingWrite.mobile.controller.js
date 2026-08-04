// ── API mobile : écritures sur l'agenda ───────────────────────────────────
//   GET    /bookings/slots        créneaux libres d'un jour
//   POST   /bookings              créer un rendez-vous
//   POST   /bookings/block        poser une absence / bloquer un créneau
//   PATCH  /bookings/:id          reprogrammer / éditer / notes
//   PATCH  /bookings/:id/cancel   annuler (statut "canceled")
//   PATCH  /bookings/:id/no-show  marquer une absence client
//
// Reproduit fidèlement les contrôleurs web (createAdminBooking,
// createAdminBlock, cancelBooking, historyEditRowPatch) : mêmes validations,
// même détection de chevauchement partagée, mêmes effets de bord.
const pug = require("pug");
const path = require("path");
const Booking = require("../../db/models/book.model");
const Company = require("../../db/models/company/company.model");
const Service = require("../../db/models/company/service.model");
const User = require("../../db/models/user.model");
const { checkBookingConflict } = require("../../utils/bookingConflict");
const { getBookableTeam } = require("../../utils/bookableTeam");
const { getAvailableSlots, hhmmToMinutes, minutesToHhmm } = require("../../utils/mobileSlots");
const { sendEmail } = require("../../utils/mailer");
const { identityFor } = require("../../utils/establishmentIdentity");
const {
  addEventToCalendar,
  deleteEventFromCalendar,
  updateEventInCalendar,
} = require("../../utils/googleCalendarSync");
const { logActivity } = require("../../utils/activityLog");
const { serializeBooking, cancelBookingSideEffects } = require("./_helpers");

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Un identifiant mal formé passé tel quel à Mongoose lève une CastError, donc
// un 500 avec trace dans les logs là où un 404 suffit.
const OBJECT_ID = /^[a-f0-9]{24}$/i;

// ── GET /bookings/slots ───────────────────────────────────────────────────
exports.slots = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const dateStr = String(req.query.date || "");
    if (!ISO_DATE.test(dateStr)) {
      return res.status(400).json({ error: "invalid_date", message: "Date attendue au format AAAA-MM-JJ." });
    }

    let duration = Number(req.query.duration) || 0;
    if (req.query.serviceId && !duration) {
      const svc = await Service.findOne({ _id: req.query.serviceId, company: companyId })
        .select("duration").lean();
      duration = svc?.duration || 0;
    }

    const result = await getAvailableSlots({
      companyId,
      dateStr,
      serviceDuration: duration,
      employeeId: req.query.employeeId,
    });
    res.json({ date: dateStr, ...result });
  } catch (err) {
    console.error("[mobile slots]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── POST /bookings ────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const currentCompany = req.companyCtx.currentCompany._id;
    const { date, startTime, name, surname, phone, message, serviceId } = req.body;
    let { employeeId } = req.body;
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!date || !startTime || !name || !email) {
      return res.status(400).json({
        error: "missing_fields",
        message: "Date, heure, nom et email sont obligatoires.",
      });
    }
    if (!ISO_DATE.test(date) || !HHMM.test(startTime)) {
      return res.status(400).json({ error: "invalid_format", message: "Date ou heure invalide." });
    }

    const company = await Company.findById(currentCompany);
    if (!company) return res.status(404).json({ error: "company_not_found", message: "Établissement introuvable." });

    // Durée : celle du service choisi, sinon celle passée, sinon le défaut.
    let serviceName = "";
    let serviceColor = "";
    let actualDuration = (Number(req.body.duration) > 0 ? Number(req.body.duration) : null) || company.slotTime || 60;
    let serviceDoc = null;
    if (serviceId) {
      serviceDoc = await Service.findOne({ _id: serviceId, company: currentCompany })
        .select("name duration color type capacity recurring sessions").lean();
      if (serviceDoc) {
        serviceName = serviceDoc.name || "";
        serviceColor = serviceDoc.color || "";
        actualDuration = serviceDoc.duration || actualDuration;
      }
    }

    // Cours collectif : on vérifie la capacité restante au lieu du chevauchement.
    let isGroup = !!(serviceDoc && serviceDoc.type === "group");
    if (isGroup) {
      const bookingDateObj = new Date(date);
      const occurrenceValid = serviceDoc.recurring?.enabled
        ? (serviceDoc.recurring.weekdays || []).includes(bookingDateObj.getDay())
          && serviceDoc.recurring.startTime === startTime
        : (serviceDoc.sessions || []).some((s) => {
            const sd = new Date(s.date);
            return sd.getFullYear() === bookingDateObj.getFullYear()
              && sd.getMonth() === bookingDateObj.getMonth()
              && sd.getDate() === bookingDateObj.getDate()
              && s.startTime === startTime;
          });
      if (occurrenceValid) {
        const capacity = serviceDoc.capacity || 1;
        const participants = await Booking.countDocuments({
          company: currentCompany, service: serviceId, date: bookingDateObj, startTime, status: "confirmed",
        });
        if (participants >= capacity) {
          return res.status(409).json({ error: "session_full", message: "Cette session est complète." });
        }
      } else {
        isGroup = false; // horaire hors séance planifiée → RDV individuel
      }
    }

    // Employé : validé contre l'équipe, ou auto-assigné au premier libre.
    let employeeName = "";
    if (!isGroup) {
      const team = await getBookableTeam(currentCompany);
      if (employeeId) {
        const emp = team.find((m) => m.id === String(employeeId));
        if (emp) employeeName = `${emp.firstName} ${emp.lastName}`.trim();
        else employeeId = null; // id inconnu de cette équipe → non assigné
      } else if (team.length >= 1) {
        const startMin = hhmmToMinutes(startTime);
        const endMin = startMin + actualDuration;
        const dayBookings = await Booking.find({
          company: currentCompany,
          date: new Date(date),
          status: { $ne: "canceled" },
          $or: [{ employee: { $in: team.map((x) => x.id) } }, { employee: null }],
        }).select("startTime slotTime employee").lean();
        const busy = new Set();
        dayBookings.forEach((b) => {
          const bs = hhmmToMinutes(b.startTime);
          const be = bs + (b.slotTime || actualDuration);
          if (startMin < be && endMin > bs) {
            if (b.employee == null) team.forEach((x) => busy.add(x.id));
            else busy.add(String(b.employee));
          }
        });
        const free = team.find((x) => !busy.has(x.id));
        if (free) {
          employeeId = free.id;
          employeeName = `${free.firstName} ${free.lastName}`.trim();
        }
      }
    } else {
      employeeId = null;
    }

    const startTimeInMinutes = hhmmToMinutes(startTime);
    const endTimeInMinutes = startTimeInMinutes + actualDuration;
    const endTime = minutesToHhmm(endTimeInMinutes);

    if (!isGroup) {
      const conflict = await checkBookingConflict({
        Booking, currentCompany, date, startTimeInMinutes, endTimeInMinutes, employeeId, actualDuration,
      });
      if (conflict) return res.status(409).json({ error: "conflict", message: conflict });
    }

    const newBooking = await Booking.create({
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

    // ── Effets de bord (email, WhatsApp/SMS, Google Calendar) ──────────────
    // Best-effort : un échec de notification ne doit jamais annuler le RDV.
    sendBookingSideEffects({ company, newBooking, date, startTime, endTime, actualDuration, name, surname, email, phone, message, serviceName, employeeName })
      .catch((e) => console.error("[mobile create booking] effets de bord:", e.message));

    res.status(201).json({ booking: serializeBooking(newBooking.toObject()) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: "conflict", message: "Ce créneau vient d'être pris." });
    }
    console.error("[mobile create booking]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// Email de confirmation + notifications + synchro agenda, comme le web.
async function sendBookingSideEffects({ company, newBooking, date, startTime, endTime, actualDuration, name, surname, email, phone, message, serviceName, employeeName }) {
  const companyOwner = company.owner ? await User.findById(company.owner).lean() : null;

  // Adresse et téléphone appartiennent à l'ÉTABLISSEMENT : lus sur le compte,
  // un RDV créé depuis l'app pour le second établissement envoyait le client à
  // l'adresse du premier.
  const identity = identityFor(company, companyOwner);

  let locationText = "";
  const loc = identity.location;
  if (loc?.serviceType === "en_ligne") locationText = "En ligne";
  else if (loc?.address || loc?.city) locationText = [loc.address, loc.city].filter(Boolean).join(", ");

  const baseUrl = process.env.BASE_URL || "https://www.branshee.com";
  const cancelUrl = `${baseUrl}/cancel-booking/${newBooking._id}?token=${newBooking.cancelToken}`;
  const formattedDate = new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  try {
    const html = pug.renderFile(
      path.join(__dirname, "../../views/templates/emails/booking-confirmed.pug"),
      {
        name, surname, date, formattedDate,
        startHour: startTime, endHour: endTime, slotTime: actualDuration,
        message, serviceName, employeeName, formAnswers: [], locationText,
        // Nom de l'ÉTABLISSEMENT (repli compte pour les fiches historiques).
        businessName: (company?.name || companyOwner?.businessName || "").trim(),
        businessPhone: (identity.phonePro || "").trim(),
        cancelUrl, bookingId: newBooking._id, cancelToken: newBooking.cancelToken,
        // Message libre du pro (Personnaliser > Rappels), affiché tel quel.
        ownerMessage: (companyOwner?.calendarSettings?.confirmationMessage || "").trim(),
      },
    );
    await sendEmail(email, "Confirmation de votre rendez-vous — BranShee", html);
  } catch (e) {
    console.error("email confirmation:", e.message);
  }

  // WhatsApp prioritaire, repli SMS — mêmes réglages d'établissement que le web.
  try {
    const cs = companyOwner?.calendarSettings || {};
    // Nom de l'ÉTABLISSEMENT (règle 8) ; espaces normalisés car Meta rejette
    // un paramètre de template contenant un saut de ligne.
    const bizName = (company?.name || companyOwner?.businessName || companyOwner?.fullName || "")
      .replace(/\s+/g, " ")
      .trim();
    // Quota inclus SMS/WhatsApp = propriété du forfait de l'établissement.
    const { billingUserFor } = require("../../utils/planLimits");
    const billingPlan = billingUserFor(company, companyOwner).subscription.plan;
    if (phone && (cs.whatsappConfirmationEnabled || cs.smsConfirmationEnabled)) {
      const { isWhatsappConfigured, sendWhatsappIfAllowed, WA_TPL_CONFIRMATION } = require("../../utils/whatsapp");
      let sent = false;
      if (cs.whatsappConfirmationEnabled && isWhatsappConfigured()) {
        const wa = await sendWhatsappIfAllowed(companyOwner, phone, {
          plan: billingPlan,
          template: WA_TPL_CONFIRMATION,
          params: [(name || "").trim() || (surname || "").trim() || "", bizName || "votre établissement", formattedDate, startTime || ""],
        }).catch(() => ({ sent: false }));
        sent = Boolean(wa && wa.sent);
      }
      if (!sent && cs.smsConfirmationEnabled) {
        const { sendBillableSmsIfAllowed } = require("../../utils/sms");
        await sendBillableSmsIfAllowed(
          companyOwner, phone,
          `${bizName ? bizName + " : " : ""}votre rendez-vous est confirmé pour le ${formattedDate} à ${startTime}.`,
          { plan: billingPlan },
        ).catch(() => {});
      }
    }
  } catch (e) {
    console.error("notif confirmation:", e.message);
  }

  try {
    if (companyOwner?.googleCalendar?.connected && companyOwner.googleCalendar.refreshToken) {
      const eventId = await addEventToCalendar(companyOwner.googleCalendar.refreshToken, newBooking);
      if (eventId) await Booking.findByIdAndUpdate(newBooking._id, { googleEventId: eventId });
    }
  } catch (e) {
    console.error("google calendar:", e.message);
  }
}

// ── POST /bookings/block ──────────────────────────────────────────────────
exports.block = async (req, res) => {
  try {
    const currentCompany = req.companyCtx.currentCompany._id;
    const { date, startTime, endTime, employeeId, note } = req.body;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({ error: "missing_fields", message: "Date et horaires requis." });
    }
    if (!ISO_DATE.test(date) || !HHMM.test(startTime) || !HHMM.test(endTime)) {
      return res.status(400).json({ error: "invalid_format", message: "Date ou heure invalide." });
    }

    const startTimeInMinutes = hhmmToMinutes(startTime);
    const endTimeInMinutes = hhmmToMinutes(endTime);
    if (endTimeInMinutes <= startTimeInMinutes) {
      return res.status(400).json({ error: "invalid_range", message: "L'heure de fin doit être après l'heure de début." });
    }
    const actualDuration = endTimeInMinutes - startTimeInMinutes;

    // Même règle que `create` : un identifiant inconnu de CETTE équipe est
    // remis à null. Sans cela le bloc était enregistré avec `employee` pointant
    // sur un compte étranger, et GET /bookings repeuplait son nom et sa photo —
    // une fuite d'identité inter-établissements.
    let employeeName = "";
    let blockEmployeeId = employeeId || null;
    if (blockEmployeeId) {
      const team = await getBookableTeam(currentCompany);
      const emp = team.find((m) => m.id === String(blockEmployeeId));
      if (emp) employeeName = `${emp.firstName} ${emp.lastName}`.trim();
      else blockEmployeeId = null;
    }

    const conflict = await checkBookingConflict({
      Booking, currentCompany, date, startTimeInMinutes, endTimeInMinutes,
      employeeId: blockEmployeeId, actualDuration,
    });
    if (conflict) return res.status(409).json({ error: "conflict", message: conflict });

    const block = await Booking.create({
      date: new Date(date),
      startTime,
      endTime,
      company: currentCompany,
      name: "Absent",
      message: String(note || "").trim().slice(0, 200),
      slotTime: actualDuration,
      status: "confirmed",
      isBlock: true,
      employee: blockEmployeeId,
      employeeName,
      payment: { method: "none", status: "none", amount: 0, currency: "eur" },
    });

    res.status(201).json({ booking: serializeBooking(block.toObject()) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: "conflict", message: "Ce créneau vient d'être pris." });
    }
    console.error("[mobile block]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── PATCH /bookings/:id/cancel ────────────────────────────────────────────
exports.cancel = async (req, res) => {
  try {
    const currentCompany = req.companyCtx.currentCompany._id;
    if (!OBJECT_ID.test(String(req.params.id))) {
      return res.status(404).json({ error: "not_found", message: "RDV introuvable." });
    }
    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, company: currentCompany },
      { status: "canceled" },
      { new: false },
    ).lean();

    if (!booking) return res.status(404).json({ error: "not_found", message: "RDV introuvable." });

    // Agenda Google, journal, email au client — partagés avec le retrait d'un
    // participant d'un cours collectif (groupSessions.mobile.controller).
    await cancelBookingSideEffects({
      booking,
      user: req.mobileUser,
      role: req.companyCtx.role,
    });

    res.json({ ok: true, id: String(booking._id) });
  } catch (err) {
    console.error("[mobile cancel]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── PATCH /bookings/:id ───────────────────────────────────────────────────
// Reprogrammation et édition. Toute modification d'horaire repasse par la
// vérification de chevauchement, en excluant le RDV déplacé lui-même.
exports.update = async (req, res) => {
  try {
    const currentCompany = req.companyCtx.currentCompany._id;
    if (!OBJECT_ID.test(String(req.params.id))) {
      return res.status(404).json({ error: "not_found", message: "RDV introuvable." });
    }
    const existing = await Booking.findOne({ _id: req.params.id, company: currentCompany }).lean();
    if (!existing) return res.status(404).json({ error: "not_found", message: "RDV introuvable." });

    const updates = {};
    const { name, surname, email, phone, message, adminNotes, status } = req.body;

    if (name !== undefined) updates.name = String(name);
    if (surname !== undefined) updates.surname = String(surname);
    if (email !== undefined) updates.email = String(email).trim().toLowerCase();
    if (phone !== undefined) updates.phone = String(phone);
    if (message !== undefined) updates.message = String(message);
    if (adminNotes !== undefined) updates.adminNotes = String(adminNotes);
    if (status !== undefined) {
      if (!["confirmed", "canceled"].includes(status)) {
        return res.status(400).json({ error: "invalid_status", message: "Statut invalide." });
      }
      // Cette route n'exige que `appointments.manage`. Annuler par ce chemin
      // contournerait donc le droit dédié exigé par PATCH /bookings/:id/cancel
      // (et enverrait l'email d'annulation au client au passage).
      if (status === "canceled" && !req.companyCtx.permissions?.appointments?.cancelDelete) {
        return res.status(403).json({
          error: "forbidden",
          message: "Vous n'êtes pas autorisé à annuler un rendez-vous.",
        });
      }
      updates.status = status;
    }

    // Service : on refige nom, couleur et durée au moment du changement.
    let duration = existing.slotTime;
    if (req.body.serviceId !== undefined) {
      if (req.body.serviceId) {
        const svc = await Service.findOne({ _id: req.body.serviceId, company: currentCompany })
          .select("name color duration").lean();
        if (!svc) return res.status(400).json({ error: "invalid_service", message: "Service introuvable." });
        updates.service = svc._id;
        updates.serviceName = svc.name || "";
        updates.serviceColor = svc.color || "";
        duration = svc.duration || duration;
      } else {
        updates.service = null;
        updates.serviceName = "";
        updates.serviceColor = "";
      }
    }

    // Employé : validé contre l'équipe bookable.
    let employeeId = existing.employee ? String(existing.employee) : null;
    if (req.body.employeeId !== undefined) {
      if (req.body.employeeId) {
        const team = await getBookableTeam(currentCompany);
        const emp = team.find((m) => m.id === String(req.body.employeeId));
        if (!emp) return res.status(400).json({ error: "invalid_employee", message: "Praticien introuvable." });
        employeeId = emp.id;
        updates.employee = emp.id;
        updates.employeeName = `${emp.firstName} ${emp.lastName}`.trim();
      } else {
        employeeId = null;
        updates.employee = null;
        updates.employeeName = "";
      }
    }

    const date = req.body.date !== undefined ? String(req.body.date) : null;
    const startTime = req.body.startTime !== undefined ? String(req.body.startTime) : null;

    if (date && !ISO_DATE.test(date)) {
      return res.status(400).json({ error: "invalid_format", message: "Date invalide." });
    }
    if (startTime && !HHMM.test(startTime)) {
      return res.status(400).json({ error: "invalid_format", message: "Heure invalide." });
    }

    // Si l'horaire, la date, la durée ou l'employé changent → revérifier le créneau.
    const timeChanged = Boolean(date || startTime || req.body.serviceId !== undefined || req.body.employeeId !== undefined);
    const effectiveDate = date || new Date(existing.date).toISOString().split("T")[0];
    const effectiveStart = startTime || existing.startTime;

    if (timeChanged && updates.status !== "canceled" && existing.status !== "canceled") {
      const startMin = hhmmToMinutes(effectiveStart);
      const endMin = startMin + duration;

      if (!existing.isGroup) {
        const conflict = await checkBookingConflict({
          Booking,
          currentCompany,
          date: effectiveDate,
          startTimeInMinutes: startMin,
          endTimeInMinutes: endMin,
          employeeId,
          actualDuration: duration,
          excludeBookingId: existing._id,
        });
        if (conflict) return res.status(409).json({ error: "conflict", message: conflict });
      }

      updates.date = new Date(effectiveDate);
      updates.startTime = effectiveStart;
      updates.endTime = minutesToHhmm(endMin);
      updates.slotTime = duration;
    }

    const updated = await Booking.findOneAndUpdate(
      { _id: req.params.id, company: currentCompany },
      updates,
      { new: true },
    ).lean();

    // Refléter le changement dans l'agenda Google du gérant.
    try {
      const companyDoc = await Company.findById(currentCompany).lean();
      const owner = companyDoc ? await User.findById(companyDoc.owner).lean() : null;
      if (owner?.googleCalendar?.connected && owner.googleCalendar.refreshToken) {
        if (updated.status === "canceled" && updated.googleEventId) {
          await deleteEventFromCalendar(owner.googleCalendar.refreshToken, updated.googleEventId);
          await Booking.findByIdAndUpdate(updated._id, { googleEventId: "" });
        } else if (updated.status !== "canceled") {
          const eventId = await updateEventInCalendar(owner.googleCalendar.refreshToken, updated.googleEventId, updated);
          if (eventId && eventId !== updated.googleEventId) {
            await Booking.findByIdAndUpdate(updated._id, { googleEventId: eventId });
          }
        }
      }
    } catch (e) {
      console.error("[mobile update] google:", e.message);
    }

    // `cancel` journalise, pas `update` : une modification (voire une
    // annulation par ce chemin) ne laissait aucune trace dans le journal.
    logActivity({
      company: currentCompany,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: updates.status === "canceled" ? "booking.cancel" : "booking.update",
      description:
        updates.status === "canceled"
          ? `a annulé le RDV de ${updated.name || ""} ${updated.surname || ""}`.trim()
          : `a modifié le RDV de ${updated.name || ""} ${updated.surname || ""}`.trim(),
    });

    res.json({ booking: serializeBooking(updated) });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({ error: "conflict", message: "Ce créneau vient d'être pris." });
    }
    console.error("[mobile update booking]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── PATCH /bookings/:id/no-show ───────────────────────────────────────────
// Marque l'absence du client. Le prélèvement éventuel des frais reste géré
// côté web (flux Stripe) : ici on ne pose que le constat.
exports.noShow = async (req, res) => {
  try {
    const currentCompany = req.companyCtx.currentCompany._id;
    if (!OBJECT_ID.test(String(req.params.id))) {
      return res.status(404).json({ error: "not_found", message: "RDV introuvable." });
    }
    const reason = req.body.reason;
    if (!["valid", "invalid", ""].includes(reason)) {
      return res.status(400).json({
        error: "invalid_reason",
        message: 'Raison attendue : "valid" (justifiée) ou "invalid" (sans motif).',
      });
    }

    const booking = await Booking.findOneAndUpdate(
      { _id: req.params.id, company: currentCompany },
      { noShow: reason !== "", noShowReason: reason },
      { new: true },
    ).lean();
    if (!booking) return res.status(404).json({ error: "not_found", message: "RDV introuvable." });

    res.json({ booking: serializeBooking(booking) });
  } catch (err) {
    console.error("[mobile no-show]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
