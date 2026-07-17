const Booking  = require("../db/models/book.model");
const User     = require("../db/models/user.model");
const Company  = require("../db/models/company/company.model");
const Service  = require("../db/models/company/service.model");
const { addEventToCalendar, deleteEventFromCalendar, getBusyIntervals } = require("../utils/googleCalendarSync");
const DaysOff  = require("../db/models/company/daysOff.model");
const { getAppointments } = require("../queries/booking.queries");
const pug  = require("pug");
const path = require("path");
const { getLimit, atLeast } = require("../utils/planLimits");
const { sendEmail } = require("../utils/mailer");
const { isFeatureEnabled } = require("../middlewares/featureFlag");
const { getCoursesForDate, courseRangesFor } = require("../utils/recurringCourses");
const { getBookableTeam } = require("../utils/bookableTeam");
const { log } = require("console");

const Stripe = require("stripe");
const _env = require(`../environment/${process.env.NODE_ENV || "development"}`);
const _stripeKey = _env.stripeSecretKey || process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY_LOCAL || "";
const stripe = _stripeKey ? new Stripe(_stripeKey) : null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert EUR float → integer cents for Stripe */
const toCents = (eur) => Math.round(Number(eur) * 100);

/** Hours between now and a booking date+time string */
function hoursUntil(bookingDate, startTime) {
  const [h, m] = startTime.split(":").map(Number);
  const dt = new Date(bookingDate);
  dt.setHours(h, m, 0, 0);
  return (dt - Date.now()) / 3_600_000;
}

/**
 * Montant des frais à retenir/prélever pour une réservation.
 * Si le service a des frais d'annulation/no-show personnalisés (ex: 30€ fixe
 * plutôt que les 50%/100% de la politique globale), ils remplacent le montant
 * "fallback" calculé depuis la politique globale — mais seulement quand cette
 * dernière aurait déjà appliqué des frais (fallbackAmount > 0). Si la politique
 * globale ne prélève rien à ce moment (ex: annulation > 24h avant), aucun frais
 * personnalisé n'est appliqué non plus.
 */
function resolveFeeAmount(serviceDoc, totalAmount, fallbackAmount) {
  if (!fallbackAmount || fallbackAmount <= 0) return fallbackAmount;
  const fee = serviceDoc?.cancellationFee;
  if (!fee?.enabled || fee.value === null || fee.value === undefined) return fallbackAmount;
  if (fee.type === "amount") return Math.min(totalAmount, fee.value);
  return totalAmount * (Math.min(100, fee.value) / 100);
}

// ── Stripe: create PaymentIntent for booking (immediate charge) ───────────────
exports.createBookingPaymentIntent = async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe non configuré." });
    const { email, name, amountEur, currency, companyId, serviceName } = req.body;
    if (!email)      return res.status(400).json({ error: "Email requis." });
    if (!amountEur || Number(amountEur) <= 0) {
      return res.status(400).json({ error: "Montant invalide." });
    }

    const amountCents = toCents(amountEur);
    if (amountCents < 50) return res.status(400).json({ error: "Montant minimum 0.50 €." });

    // ── Créer le PaymentIntent sur le compte plateforme BranShee ─────────────
    const pi = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: (currency || "eur").toLowerCase(),
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description:   serviceName ? `Réservation — ${serviceName}` : "Réservation en ligne",
      receipt_email: email.trim().toLowerCase(),
      metadata: {
        companyId:   String(companyId || ""),
        serviceName: serviceName || "",
        clientEmail: email.trim().toLowerCase(),
        clientName:  name || "",
      },
    });

    console.log("[PaymentIntent] Created:", pi.id);
    res.json({ clientSecret: pi.client_secret, paymentIntentId: pi.id });
  } catch (err) {
    console.error("createBookingPaymentIntent error:", err.message, err.raw?.message || "");
    res.status(500).json({ error: err.raw?.message || err.message || "Erreur Stripe." });
  }
};

// ── Stripe: créer un SetupIntent (enregistre la carte, 0€ prélevé) ────────────
// Le client autorise l'enregistrement de sa carte. Aucun montant n'est débité
// à la réservation : en cas d'annulation tardive, des frais sont prélevés sur
// cette carte selon la politique d'annulation du professionnel.
exports.createBookingSetupIntent = async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe non configuré." });
    const { email, name, companyId } = req.body;
    if (!email) return res.status(400).json({ error: "Email requis." });

    const customer = await stripe.customers.create({
      email: email.trim().toLowerCase(),
      name:  name || undefined,
    });

    const setupIntent = await stripe.setupIntents.create({
      customer:             customer.id,
      payment_method_types: ["card"],
      usage:                "off_session",
      metadata: {
        companyId:   String(companyId || ""),
        clientEmail: email.trim().toLowerCase(),
        clientName:  name || "",
      },
    });

    res.json({
      clientSecret:  setupIntent.client_secret,
      setupIntentId: setupIntent.id,
    });
  } catch (err) {
    console.error("createBookingSetupIntent error:", err.message, err.raw?.message || "");
    res.status(500).json({ error: err.raw?.message || err.message || "Erreur Stripe." });
  }
};

// ── Marquer une absence (no-show) ────────────────────────────────────────────
// L'admin choisit la raison :
//  - "valid"   → raison valable (urgence, hôpital...) : aucun frais, la
//                pré-autorisation est libérée / le paiement est remboursé.
//  - "invalid" → oubli / sans raison : on prélève 100% de la prestation sur
//                la carte enregistrée (ou on garde le paiement déjà capturé).
exports.markNoShow = async (req, res) => {
  try {
    // IDOR CRITIQUE : cet endpoint déclenche un prélèvement/remboursement
    // Stripe. Scopé à l'établissement courant → impossible d'agir sur la carte
    // enregistrée du client d'un autre établissement.
    const booking = await Booking.findOne({ _id: req.params.id, company: res.locals.currentCompany?._id });
    if (!booking) return res.status(404).json({ error: "Réservation introuvable." });

    const reason = req.body.reason === "valid" ? "valid" : "invalid";
    booking.noShow = true;
    booking.noShowReason = reason;

    // "method" peut être "online" (prépaiement) OU "on_site" (carte enregistrée
    // en garantie) — dans les deux cas une carte Stripe peut être prélevée ici.
    // On se base sur le statut réel du paiement, pas sur le libellé de la
    // méthode choisie par le client.
    const hasStripePayment = ["authorized", "paid"].includes(booking.payment?.status);
    if (!hasStripePayment) {
      await booking.save();
      return res.json({ success: true, charged: false });
    }

    // ── Raison valable : aucun frais ────────────────────────────────────────
    if (reason === "valid") {
      if (booking.payment.status === "authorized") {
        booking.payment.status = "none";
      } else if (booking.payment.status === "paid" && stripe && booking.payment.stripePaymentIntentId) {
        try {
          await stripe.refunds.create({
            payment_intent:   booking.payment.stripePaymentIntentId,
            reason:           "requested_by_customer",
                      });
          booking.payment.status = "refunded";
        } catch (stripeErr) {
          console.error("No-show refund error:", stripeErr.message);
        }
      }
      await booking.save();
      return res.json({ success: true, charged: false });
    }

    // ── Raison non valable : encaisser 100% ─────────────────────────────────
    if (booking.payment.status === "paid") {
      await booking.save();
      return res.json({ success: true, charged: true, amount: booking.payment.amount, info: "Paiement déjà encaissé." });
    }

    if (booking.payment.status === "authorized" &&
        booking.payment.stripeCustomerId &&
        booking.payment.stripePaymentMethodId) {
      if (!stripe) return res.status(500).json({ error: "Stripe non configuré." });

      const amount = booking.payment.amount || 0;
      const serviceDoc = booking.service
        ? await Service.findById(booking.service).select("cancellationFee").lean()
        : null;
      const feeAmount = resolveFeeAmount(serviceDoc, amount, amount);
      const amountCents = toCents(feeAmount);
      if (amountCents < 50) {
        await booking.save();
        return res.json({ success: false, error: "Montant trop faible pour être prélevé." });
      }

      try {
        const pi = await stripe.paymentIntents.create({
          amount:         amountCents,
          currency:       booking.payment.currency || "eur",
          customer:       booking.payment.stripeCustomerId,
          payment_method: booking.payment.stripePaymentMethodId,
          off_session:    true,
          confirm:        true,
          description:    `Absence non excusée — ${booking.serviceName || "Réservation"}`,
        });

        booking.payment.status = "penalty";
        booking.payment.stripePaymentIntentId = pi.id;
        booking.payment.penaltyAmount = feeAmount;
        booking.payment.paidAt = new Date();
        await booking.save();

        return res.json({ success: true, charged: true, amount: feeAmount });
      } catch (stripeErr) {
        console.error("markNoShow off-session error:", stripeErr.message);
        booking.payment.status = "failed";
        await booking.save();
        return res.json({ success: false, error: stripeErr.raw?.message || stripeErr.message || "Échec du prélèvement." });
      }
    }

    await booking.save();
    res.json({ success: false, error: "Aucun paiement à encaisser." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── Revoir des frais d'annulation prélevés automatiquement ───────────────────
// Quand un client annule < 24h/12h, le système prélève automatiquement la
// pénalité sur la carte enregistrée (payment.status = "penalty"). L'admin peut
// ensuite revoir ce prélèvement :
//  - "refunded" → raison valable (urgence, hôpital...) : on rembourse le client
//  - "kept"     → raison non valable : l'établissement garde les frais
exports.reviewCancellationPenalty = async (req, res) => {
  try {
    // IDOR CRITIQUE : déclenche un remboursement Stripe. Scopé à
    // l'établissement courant.
    const booking = await Booking.findOne({ _id: req.params.id, company: res.locals.currentCompany?._id });
    if (!booking) return res.status(404).json({ error: "Réservation introuvable." });

    const decision = req.body.decision === "refunded" ? "refunded" : "kept";

    if (booking.payment?.status !== "penalty") {
      return res.status(400).json({ error: "Aucun frais d'annulation à revoir pour cette réservation." });
    }

    if (decision === "refunded") {
      if (!stripe || !booking.payment.stripePaymentIntentId) {
        return res.status(500).json({ error: "Stripe non configuré ou prélèvement introuvable." });
      }
      try {
        await stripe.refunds.create({
          payment_intent:   booking.payment.stripePaymentIntentId,
          reason:           "requested_by_customer",
                  });
        booking.payment.status = "refunded";
      } catch (stripeErr) {
        console.error("reviewCancellationPenalty refund error:", stripeErr.message);
        return res.status(500).json({ error: stripeErr.raw?.message || stripeErr.message || "Échec du remboursement." });
      }
    }

    booking.payment.cancellationReviewDecision = decision;
    booking.payment.cancellationReviewedAt = new Date();
    await booking.save();

    res.json({ success: true, decision, status: booking.payment.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createBooking = async (req, res) => {
  try {
    const { date, startTime, company, name, surname, email: rawEmail, phone, message, formAnswers,
            serviceId, serviceName, serviceDuration, serviceCategory,
            paymentMethod, stripePaymentIntentId, stripeSetupIntentId, servicePrice } = req.body;

    // Normaliser l'email (trim + minuscule) — c'est le format utilisé partout
    // ailleurs pour faire correspondre les réservations à un compte client
    // (ex: lien automatique des RDV "invité" lors de l'inscription dans
    // postRegister, ou la recherche "Mes réservations" par email). Sans ça,
    // une réservation faite avec "Jean.Dupont@Gmail.com" ne matchait jamais
    // le compte créé juste après avec l'email normalisé "jean.dupont@gmail.com"
    // → le RDV n'apparaissait pas dans "Mes rendez-vous" une fois connecté.
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : rawEmail;

    // ── Client bloqué par cet établissement → ne peut plus réserver ─────────
    if (email) {
      const ClientDossier = require("../db/models/clientDossier.model");
      const dossier = await ClientDossier.findOne({ company, email, blocked: true }).select("_id").lean();
      if (dossier) {
        return res.json({
          success: false,
          error: "client_blocked",
          message: "Ce professionnel n'accepte plus de réservation de votre part. Merci de le contacter directement.",
        });
      }
    }

    // employeeId / employeeName may be auto-resolved below — use let
    let employeeId   = req.body.employeeId   || null;
    let employeeName = req.body.employeeName || "";

    const response = await Company.findById(company);
    const companySlotTime = response.slotTime;

    // ── Délai minimum de réservation — revalidé côté serveur : la liste de
    // créneaux affichée au client respecte déjà ce délai, mais on ne fait
    // jamais confiance uniquement au frontend pour une règle métier. ───────
    if (response.minBookingLeadTime?.enabled) {
      const leadMinutes = Math.max(0, Number(response.minBookingLeadTime.minutes) || 0);
      const slotDateTime = new Date(date);
      const [slotH, slotM] = startTime.split(":").map(Number);
      slotDateTime.setHours(slotH, slotM, 0, 0);
      if (slotDateTime.getTime() < Date.now() + leadMinutes * 60000) {
        return res.json({
          success: false,
          error: "lead_time_not_met",
          message: "Ce créneau est trop proche pour être réservé. Merci de choisir un horaire plus tard.",
        });
      }
    }

    // ── Plan gate: monthly bookings cap for basic (free) plan ─────────────
    if (response.owner) {
      const companyOwner = await User.findById(response.owner).lean();
      const monthlyLimit = getLimit("monthlyBookings", companyOwner);
      if (monthlyLimit !== Infinity) {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthlyCount = await Booking.countDocuments({
          company,
          date:   { $gte: startOfMonth },
          status: { $ne: "canceled" },
        });
        if (monthlyCount >= monthlyLimit) {
          // ── Alerte admin : un client vient de se faire refuser ─────────────
          // Signal distinct de "limite atteinte" (déjà envoyé plus haut quand
          // LEUR propre réservation a fait passer le cap) — ici c'est "vous
          // venez concrètement de perdre un client". Throttlé à 1x/mois pour
          // ne pas spammer si plusieurs clients se font refuser le même mois.
          (async () => {
            try {
              const now = new Date();
              const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
              if (response.limitBlockedNotifiedMonth === monthKey) return;
              await Company.findByIdAndUpdate(company, { limitBlockedNotifiedMonth: monthKey });
              const owner = await User.findById(response.owner).lean();
              const adminEmail = owner?.emailPro || owner?.email;
              if (adminEmail) {
                const html = pug.renderFile(
                  path.join(__dirname, "../views/templates/emails/blocked-booking-attempt.pug"),
                  {
                    ownerName:   owner.fullName || "",
                    companyName: owner.businessName || owner.fullName || "",
                    monthlyLimit,
                  },
                );
                await sendEmail(adminEmail, "🚫 Un client n'a pas pu réserver — limite atteinte | BranShee", html);
              }
            } catch (blockedNotifErr) {
              console.error("Blocked booking notification email error:", blockedNotifErr.message);
            }
          })();

          return res.json({
            success: false,
            error: "monthly_limit_reached",
            message: "Ce professionnel a atteint la limite mensuelle de réservations.",
          });
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    // Use service duration if provided, otherwise fall back to company slot time
    const actualDuration = (serviceDuration && Number(serviceDuration) > 0)
      ? Number(serviceDuration)
      : companySlotTime;

    const [hours, minutes] = startTime.split(":").map(Number);
    const startTimeInMinutes = hours * 60 + minutes;
    const endTimeInMinutes   = startTimeInMinutes + actualDuration;
    const endHours   = Math.floor(endTimeInMinutes / 60);
    const endMinutes = endTimeInMinutes % 60;
    const endTime = `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;

    // ── Service "collectif" : plusieurs clients peuvent réserver le même
    // créneau, jusqu'à la capacité définie sur le service. Pas d'assignation
    // d'employé ni de vérification de chevauchement individuelle. ──────────
    let serviceDoc = null;
    if (serviceId) {
      serviceDoc = await Service.findById(serviceId).select("type capacity color recurring sessions location duration price").lean();
    }
    const isGroup = !!(serviceDoc && serviceDoc.type === "group");

    if (isGroup) {
      // ── Défense en profondeur : le (date, startTime) envoyé doit
      // correspondre à une vraie occurrence du cours (récurrente ou
      // ponctuelle) — on ne fait jamais confiance uniquement au frontend
      // pour une règle métier (même principe que minBookingLeadTime
      // ci-dessus). Empêche de réserver un créneau de cours qui n'existe
      // plus (date supprimée par l'admin) ou n'a jamais existé. ──────────
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
      if (!occurrenceValid) {
        return res.json({
          success: false,
          error: "invalid_session",
          message: "Cette session n'existe plus, merci de rafraîchir la page.",
        });
      }

      const capacity = serviceDoc.capacity || 1;
      const participantCount = await Booking.countDocuments({
        company,
        service: serviceId,
        date: new Date(date),
        startTime,
        status: "confirmed",
      });
      if (participantCount >= capacity) {
        return res.json({
          success: false,
          error: "session_full",
          message: "Cette session est complète, merci de choisir un autre horaire.",
        });
      }
      employeeId   = null;
      employeeName = "";
    }

    // ── Anti double-booking — revalidé côté serveur dans tous les cas ───────
    // Le frontend ne propose déjà que des créneaux libres, mais on ne fait
    // jamais confiance uniquement à l'UI pour une règle métier (même
    // principe que minBookingLeadTime plus haut). Couvre les 3 cas : un
    // employé précis a été choisi, aucun employé n'a été précisé (auto-
    // assignation parmi les employés actifs), ou l'établissement n'a aucun
    // employé enregistré (solo) — les trois chemins étaient auparavant
    // traités différemment et seul le 2e vérifiait vraiment les conflits,
    // ce qui permettait deux réservations qui se chevauchent dès qu'un
    // employé précis était sélectionné ou qu'il n'y avait aucun employé.
    if (!isGroup) {
      // Temps tampon (cf. exports.getBooking plus bas, qui l'applique déjà à
      // l'affichage des créneaux) — revalidé ici aussi, sinon deux clients
      // qui réservent la même minute (ou un client avec une liste de
      // créneaux périmée) peuvent créer deux RDV collés malgré le tampon
      // configuré (ex: RDV 17h-17h30 immédiatement suivi d'un RDV à 17h30).
      const bufferBefore = response.bufferBefore ?? response.bufferTime ?? 0;
      const bufferAfter  = response.bufferAfter  ?? response.bufferTime ?? 0;

      function overlapsRange(b) {
        const [bh, bm] = b.startTime.split(":").map(Number);
        const bStart = bh * 60 + bm;
        const bEnd = bStart + (b.slotTime || actualDuration);
        return startTimeInMinutes < bEnd + bufferAfter && endTimeInMinutes > bStart - bufferBefore;
      }

      if (employeeId) {
        // Employé précis choisi par le client — vérifier que CET employé
        // est bien libre. On inclut aussi les RDV sans employé assigné
        // (employee: null) car ils bloquent toute l'équipe.
        const overlapping = await Booking.find({
          company,
          date: new Date(date),
          status: { $ne: "canceled" },
          $or: [{ employee: employeeId }, { employee: null }],
        }).select("startTime slotTime").lean();
        if (overlapping.some(overlapsRange)) {
          return res.json({ success: false, error: "no_employee_available" });
        }
        const coursesForThisDate = await getCoursesForDate(company, date);
        const courseConflict = courseRangesFor(coursesForThisDate, employeeId)
          .some(([rs, re]) => startTimeInMinutes < re && endTimeInMinutes > rs);
        if (courseConflict) {
          return res.json({ success: false, error: "no_employee_available" });
        }
      } else {
        const team = await getBookableTeam(company);

        if (team.length === 0) {
          // Personne n'est marqué bookable (patron désactivé, aucun
          // collaborateur "employé") — aucune réservation possible.
          return res.json({ success: false, error: "no_employee_available" });
        }

        // Aucun employé précisé — auto-assigner le premier qui est libre.
        // On inclut les RDV sans employé (null) qui bloquent toute l'équipe.
        const overlapping = await Booking.find({
          company,
          date: new Date(date),
          status: { $ne: "canceled" },
          $or: [
            { employee: { $in: team.map((m) => m.id) } },
            { employee: null },
          ],
        }).select("employee startTime slotTime").lean();

        const busyIds = new Set();
        overlapping.forEach((b) => {
          if (!overlapsRange(b)) return;
          if (b.employee == null) {
            team.forEach((m) => busyIds.add(m.id));
          } else {
            busyIds.add(String(b.employee));
          }
        });

        // Un employé en cours collectif à ce moment-là n'est pas disponible
        // pour un autre service, même sans RDV individuel enregistré.
        const coursesForThisDate = await getCoursesForDate(company, date);
        team.forEach((m) => {
          const blocked = courseRangesFor(coursesForThisDate, m.id)
            .some(([rs, re]) => startTimeInMinutes < re && endTimeInMinutes > rs);
          if (blocked) busyIds.add(m.id);
        });

        const free = team.find((m) => !busyIds.has(m.id));
        if (!free) {
          return res.json({ success: false, error: "no_employee_available" });
        }
        employeeId   = free.id;
        employeeName = `${free.firstName} ${free.lastName}`;
      }
    }

    // ── Carte enregistrée via SetupIntent (nouveau flux : 0€ prélevé) ───────
    // Valable aussi pour "on_site" : la carte est enregistrée en garantie pour
    // permettre le prélèvement de frais d'annulation/no-show selon la politique.
    let paymentExtra = {};
    if ((paymentMethod === "online" || paymentMethod === "on_site") && stripeSetupIntentId && stripe) {
      try {
        const si = await stripe.setupIntents.retrieve(stripeSetupIntentId);
        if (si.status === "succeeded") {
          let cardLast4 = "", cardBrand = "";
          try {
            const pm = await stripe.paymentMethods.retrieve(si.payment_method);
            cardLast4 = pm.card?.last4 || "";
            cardBrand = pm.card?.brand || "";
          } catch (_) {}
          paymentExtra = {
            status:                "authorized",
            stripeSetupIntentId:   si.id,
            stripeCustomerId:      si.customer || "",
            stripePaymentMethodId: si.payment_method || "",
            cardLast4,
            cardBrand,
          };
        }
      } catch (siErr) {
        console.error("SetupIntent retrieve error:", siErr.message);
      }
    }

    // ── Paiement en ligne : VÉRIFICATION SERVEUR du PaymentIntent ───────────
    // FAILLE CRITIQUE CORRIGÉE : avant, on marquait le RDV "payé" en se fiant
    // AVEUGLÉMENT à `stripePaymentIntentId` et `servicePrice` envoyés par le
    // navigateur → un client pouvait forger un id, payer 0,50 € un service à
    // 60 €, ou enregistrer un RDV "payé" sans payer du tout. On récupère
    // désormais le PaymentIntent auprès de Stripe, on exige qu'il soit
    // réellement "succeeded", et on vérifie que le montant reçu couvre bien le
    // prix du service (issu de la BASE, jamais du body). Montant stocké =
    // celui confirmé par Stripe.
    let onlinePayment = null;
    if (paymentMethod === "online" && stripePaymentIntentId && stripe) {
      try {
        const pi = await stripe.paymentIntents.retrieve(stripePaymentIntentId);
        const receivedCents = pi ? (pi.amount_received ?? pi.amount ?? 0) : 0;
        const expectedCents = serviceDoc && Number(serviceDoc.price) > 0
          ? toCents(serviceDoc.price)
          : 0;
        const succeeded = pi && pi.status === "succeeded";
        const amountOk = expectedCents === 0 || receivedCents >= expectedCents;
        if (succeeded && amountOk) {
          onlinePayment = {
            stripePaymentIntentId: pi.id,
            amount:  receivedCents / 100,
            paidAt:  new Date(),
          };
        } else {
          // Paiement en ligne réclamé mais non vérifiable (forgé, échoué, ou
          // montant insuffisant) → on refuse la réservation plutôt que de
          // créer un RDV faussement "payé".
          console.error("Paiement en ligne non vérifié:", { piStatus: pi?.status, receivedCents, expectedCents });
          return res.json({
            success: false,
            error: "payment_unverified",
            message: "Le paiement n'a pas pu être vérifié. Réessayez ou contactez l'établissement.",
          });
        }
      } catch (piErr) {
        console.error("PaymentIntent verify error:", piErr.message);
        return res.json({
          success: false,
          error: "payment_unverified",
          message: "Le paiement n'a pas pu être vérifié. Réessayez ou contactez l'établissement.",
        });
      }
    }

    const newBooking = await Booking.create({
      date: new Date(date),
      startTime,
      company,
      name,
      surname,
      email,
      phone,
      message,
      slotTime: actualDuration,   // store the ACTUAL duration, not the default slot
      endTime,
      status: "confirmed",
      formAnswers: Array.isArray(formAnswers) ? formAnswers : [],
      // Identité unifiée (cf. plan d'unification) : un User connecté compte
      // comme son propre "client" — repli sur l'ancien compte Client séparé
      // tant que tous les comptes n'ont pas été fusionnés.
      clientRef: req.user?._id || req.session?.clientId || null,
      service:      serviceId   || null,
      serviceName:  serviceName || "",
      serviceColor: serviceDoc?.color || "",
      employee:     employeeId  || null,
      employeeName: employeeName || "",
      isGroup,
      // ── Payment ────────────────────────────────────────────────────────────
      // Statut "paid" UNIQUEMENT si onlinePayment a été vérifié côté serveur
      // ci-dessus. Sinon on retombe sur le montant informatif (méthodes hors
      // ligne) sans jamais prétendre que c'est payé.
      payment: {
        method: ["online", "on_site", "bank_transfer", "paypal"].includes(paymentMethod) ? paymentMethod : "none",
        status: onlinePayment ? "paid" : "none",
        stripePaymentIntentId: onlinePayment ? onlinePayment.stripePaymentIntentId : "",
        amount:   onlinePayment ? onlinePayment.amount : (servicePrice ? Number(servicePrice) : 0),
        currency: "eur",
        paidAt:   onlinePayment ? onlinePayment.paidAt : null,
        ...paymentExtra,
      },
    });

    // ── Fetch owner for location + Google Calendar ──────────────────────────
    const companyOwner = await User.findById(response.owner).lean();

    // ── Alerte admin : limite mensuelle de RDV atteinte (plan Starter) ─────
    // On envoie l'email une seule fois par mois, dès que la réservation qui
    // vient d'être créée fait passer le compteur au-delà de la limite du plan.
    try {
      if (companyOwner) {
        const monthlyLimitForAlert = getLimit("monthlyBookings", companyOwner);
        if (monthlyLimitForAlert !== Infinity) {
          const now = new Date();
          const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
          if (response.limitReachedNotifiedMonth !== monthKey) {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const monthlyCountAfter = await Booking.countDocuments({
              company,
              date:   { $gte: startOfMonth },
              status: { $ne: "canceled" },
            });
            if (monthlyCountAfter >= monthlyLimitForAlert) {
              const adminEmail = companyOwner.emailPro || companyOwner.email;
              if (adminEmail) {
                const limitHtml = pug.renderFile(
                  path.join(__dirname, "../views/templates/emails/monthly-limit-reached.pug"),
                  {
                    ownerName:   companyOwner.fullName || "",
                    companyName: companyOwner.businessName || companyOwner.fullName || "",
                    monthlyLimit: monthlyLimitForAlert,
                  },
                );
                await sendEmail(adminEmail, "⚠️ Limite mensuelle de rendez-vous atteinte — BranShee", limitHtml);
              }
              // On marque le mois comme notifié pour ne pas spammer l'admin
              await Company.findByIdAndUpdate(company, { limitReachedNotifiedMonth: monthKey });
            }
          }
        }
      }
    } catch (limitNotifErr) {
      console.error("Monthly limit notification email error:", limitNotifErr.message);
    }

    // Build location text — un cours collectif peut avoir un lieu spécifique
    // (ex: studio loué pour un atelier) qui remplace l'adresse par défaut.
    let locationText = serviceDoc?.location || "";
    if (!locationText) {
      const loc = companyOwner?.location;
      if (loc?.serviceType === "en_ligne") {
        locationText = "En ligne";
      } else if (loc?.address || loc?.city) {
        locationText = [loc.address, loc.city].filter(Boolean).join(", ");
      }
    }

    // Cancel URL
    const baseUrl = process.env.BASE_URL || "https://www.branshee.com";
    const cancelUrl = `${baseUrl}/cancel-booking/${newBooking._id}?token=${newBooking.cancelToken}`;

    // Formatted date (fr-FR)
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
        serviceName:     serviceName     || "",
        serviceCategory: serviceCategory || "",
        servicePrice:    (servicePrice !== null && servicePrice !== undefined && servicePrice !== "") ? Number(servicePrice) : null,
        employeeName:    employeeName    || "",
        formAnswers:     (Array.isArray(formAnswers) ? formAnswers : []).filter(
                           (a) => a.required || (a.answer !== undefined && a.answer !== null && String(a.answer).trim() !== "")
                         ),
        locationText,
        businessName:  (companyOwner?.businessName || "").trim(),
        businessPhone: (companyOwner?.phonePro || "").trim(),
        cancelUrl,
        bookingId:   newBooking._id,
        cancelToken: newBooking.cancelToken,
      },
    );

    await sendEmail(email, "Confirmation de votre rendez-vous — BranShee", htmlTemplate);

    // ── SMS de confirmation au client (fonctionnalité cachée, désactivée par défaut) ──
    try {
      if (phone && (await isFeatureEnabled("sms_notifications"))) {
        const { sendSms } = require("../utils/sms");
        await sendSms(
          phone,
          `BranShee : votre rendez-vous est confirmé pour le ${formattedDate} à ${startTime}.`,
        );
      }
    } catch (smsErr) {
      console.error("SMS confirmation error:", smsErr.message);
    }

    // ── Email de notification à l'admin (si activé) ────────────────────────
    try {
      if (companyOwner && companyOwner.notifications?.newBooking !== false) {
        const adminEmail = companyOwner.emailPro || companyOwner.email;
        if (adminEmail) {
          const adminHtml = pug.renderFile(
            path.join(__dirname, "../views/templates/emails/admin-new-booking.pug"),
            {
              name,
              surname,
              email,
              phone:         phone        || "",
              formattedDate,
              startHour:     startTime,
              endHour:       endTime,
              serviceName:   serviceName  || "",
              employeeName:  employeeName || "",
              locationText,
              message:       message      || "",
            },
          );
          const clientDisplay = [name, surname].filter(Boolean).join(" ") || email;
          await sendEmail(adminEmail, `📅 Nouveau RDV — ${clientDisplay}`, adminHtml);
        }
      }
    } catch (notifErr) {
      console.error("Admin notification email error:", notifErr.message);
    }

    // Sync Google Calendar
    try {
      if (companyOwner?.googleCalendar?.connected && companyOwner.googleCalendar.refreshToken) {
        const eventId = await addEventToCalendar(companyOwner.googleCalendar.refreshToken, newBooking);
        if (eventId) {
          await Booking.findByIdAndUpdate(newBooking._id, { googleEventId: eventId });
        }
      }
    } catch (gcalErr) {
      console.error("Google Calendar sync error (create):", gcalErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: "this booking is unavailable" });
  }
};

// Convertit des minutes-depuis-minuit en chaîne "HH:MM"
function minutesToTimeStr(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// Deux plages [aStart, aEnd) et [bStart, bEnd) se chevauchent-elles ?
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

// ── Cours collectif : prochaines occurrences réservables ─────────────────────
// Génère les occurrences futures d'un cours récurrent (weekdays + startTime,
// fin calculée depuis la durée du service — pas de fin propre stockée pour ce
// mode). Horizon volontairement large (90 jours / 12 occurrences, le premier
// plafond atteint) pour couvrir aussi les cours à plusieurs jours/semaine.
const GROUP_SESSIONS_MAX_OCCURRENCES = 12;
const GROUP_SESSIONS_HORIZON_DAYS = 90;

function generateRecurringOccurrences(recurring, duration, maxCount, horizonDays) {
  const out = [];
  const now = new Date();
  const [h, m] = (recurring.startTime || "00:00").split(":").map(Number);
  const endMin = h * 60 + m + (duration || 60);
  const endTime = minutesToTimeStr(endMin);
  for (let i = 0; i < horizonDays && out.length < maxCount; i++) {
    // Jour calendaire local "aujourd'hui + i" — un constructeur par composants
    // (y,m,d) est nécessaire ici pour déterminer le bon jour de semaine en
    // heure locale. On le convertit ensuite en chaîne "YYYY-MM-DD" puis on la
    // reparse : c'est la MÊME convention que `sanitizeSessions` (dates
    // ponctuelles) et `createBooking` (new Date("YYYY-MM-DD") = minuit UTC,
    // jamais minuit local) — sans ça, sur un serveur en UTC+1/+2, la date
    // stockée ici se décale d'un jour par rapport aux vraies réservations et
    // le comptage de places ne matche jamais rien (vérifié : la clé de
    // comptage retombait sur la veille).
    const probe = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if ((recurring.weekdays || []).includes(probe.getDay())) {
      const ymd = `${probe.getFullYear()}-${String(probe.getMonth() + 1).padStart(2, "0")}-${String(probe.getDate()).padStart(2, "0")}`;
      out.push({ date: new Date(ymd), startTime: recurring.startTime, endTime });
    }
  }
  return out;
}

// ── API publique : liste des prochaines séances réservables pour un service
// collectif (récurrent ou dates ponctuelles), avec places restantes — alimente
// la liste affichée côté client à la place du calendrier classique. ──────────
exports.getGroupSessions = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const service = await Service.findById(serviceId)
      .select("type capacity name color recurring sessions location duration company")
      .lean();
    if (!service || service.type !== "group") {
      return res.status(404).json({ success: false, error: "service_not_found" });
    }

    const company = await Company.findById(service.company).select("minBookingLeadTime owner").lean();
    const leadConfig = company?.minBookingLeadTime;
    const leadCutoffMs = Date.now() + (leadConfig?.enabled ? Math.max(0, Number(leadConfig.minutes) || 0) * 60000 : 0);

    let occurrences = service.recurring?.enabled
      ? generateRecurringOccurrences(service.recurring, service.duration, GROUP_SESSIONS_MAX_OCCURRENCES, GROUP_SESSIONS_HORIZON_DAYS)
      : (service.sessions || []).map((s) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime }));

    // Passé + délai minimum de réservation (même règle que createBooking/getBooking)
    occurrences = occurrences
      .filter((o) => {
        const [oh, om] = o.startTime.split(":").map(Number);
        const dt = new Date(o.date);
        dt.setHours(oh, om, 0, 0);
        return dt.getTime() >= leadCutoffMs;
      })
      .sort((a, b) => new Date(a.date) - new Date(b.date) || a.startTime.localeCompare(b.startTime));

    // Compter les réservations confirmées par occurrence (une seule requête,
    // puis on rapproche en mémoire — le volume par service reste minime).
    const minDate = occurrences.length
      ? new Date(Math.min(...occurrences.map((o) => new Date(o.date).getTime())))
      : null;
    const existingBookings = minDate
      ? await Booking.find({ company: service.company, service: serviceId, status: "confirmed", isGroup: true, date: { $gte: minDate } })
          .select("date startTime").lean()
      : [];
    const counts = new Map(); // `${yyyy-mm-dd}|${startTime}` → nb de réservations
    existingBookings.forEach((b) => {
      const key = `${new Date(b.date).toISOString().split("T")[0]}|${b.startTime}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const capacity = service.capacity || null;
    const sessions = occurrences.map((o) => {
      const key = `${new Date(o.date).toISOString().split("T")[0]}|${o.startTime}`;
      const booked = counts.get(key) || 0;
      const remaining = capacity !== null ? Math.max(0, capacity - booked) : null;
      return { date: o.date, startTime: o.startTime, endTime: o.endTime, capacity, remaining, full: capacity !== null && remaining === 0 };
    });

    // Lieu : surcharge du cours, sinon adresse par défaut du compte.
    let locationText = service.location || "";
    if (!locationText && company?.owner) {
      const owner = await User.findById(company.owner).select("location").lean();
      const loc = owner?.location;
      if (loc?.serviceType === "en_ligne") locationText = "En ligne";
      else if (loc?.address || loc?.city) locationText = [loc.address, loc.city].filter(Boolean).join(", ");
    }

    res.json({ success: true, sessions, capacity, locationText, serviceName: service.name, serviceColor: service.color });
  } catch (err) {
    console.error("getGroupSessions error:", err);
    res.status(500).json({ success: false, error: "Erreur serveur." });
  }
};

exports.getBooking = async (req, res) => {
  const { date, companyId, employeeId, serviceDuration, serviceId } = req.query;

  const specificEmployee = employeeId && employeeId !== "null" && employeeId !== "";

  const baseQuery = {
    company: companyId,
    date: new Date(date),
    status: { $ne: "canceled" },
    isGroup: { $ne: true },
  };

  // ── Block past time slots when the requested date is today ───────────────
  const requestedDate = new Date(date);
  const now = new Date();
  const isToday =
    requestedDate.getFullYear() === now.getFullYear() &&
    requestedDate.getMonth()    === now.getMonth()    &&
    requestedDate.getDate()     === now.getDate();
  const nowMinutes = isToday ? now.getHours() * 60 + now.getMinutes() : -1;

  // Get company config so we can compute slot granularity / buffer / mode.
  const [companyDoc, team] = await Promise.all([
    Company.findById(companyId).select("slotTime bufferTime bufferBefore bufferAfter slotMode slotInterval owner smartGrouping minBookingLeadTime").lean(),
    // Inutile quand un employé précis est filtré.
    specificEmployee ? Promise.resolve([]) : getBookableTeam(companyId),
  ]);

  // ── Délai minimum de réservation ──────────────────────────────────────────
  // "On vous propose un créneau dans 5 min, pas le temps de vous préparer" —
  // si activé, aucun créneau ne peut être réservé avant `now + leadMinutes`,
  // quel que soit le jour demandé (peut donc bloquer des jours entiers si le
  // délai dépasse 24h). On exprime ce seuil en minutes depuis minuit DU JOUR
  // DEMANDÉ pour pouvoir le combiner avec les boucles de blocage existantes.
  const leadConfig = companyDoc?.minBookingLeadTime;
  const leadMinutesConfig = leadConfig?.enabled ? Math.max(0, Number(leadConfig.minutes) || 0) : 0;
  const leadCutoffMs = now.getTime() + leadMinutesConfig * 60000;
  const requestedMidnightMs = new Date(requestedDate.getFullYear(), requestedDate.getMonth(), requestedDate.getDate()).getTime();
  const leadCutoffMinutesForDay = Math.ceil((leadCutoffMs - requestedMidnightMs) / 60000);

  // ── Service "collectif" : la disponibilité dépend du nombre de places
  // restantes par créneau, indépendamment des plannings employés/buffer. ───
  if (serviceId && serviceId !== "null" && serviceId !== "") {
    const service = await Service.findById(serviceId).select("type capacity").lean();
    if (service && service.type === "group") {
      const capacity = service.capacity || 1;

      const groupBookings = await Booking.find({
        company: companyId,
        service: serviceId,
        date: new Date(date),
        status: "confirmed",
        isGroup: true,
      }).select("startTime").lean();

      const counts = {};
      groupBookings.forEach((b) => {
        counts[b.startTime] = (counts[b.startTime] || 0) + 1;
      });

      const blockedSet = new Set();
      const groupAvailability = {};

      Object.keys(counts).forEach((startTime) => {
        groupAvailability[startTime] = { booked: counts[startTime], capacity };
        if (counts[startTime] >= capacity) blockedSet.add(startTime);
      });

      // Block past slots + délai minimum (every minute mark — the client
      // only checks the exact slot strings returned by /get-schedule).
      const cutoffG = Math.min(Math.max(nowMinutes, leadCutoffMinutesForDay), 24 * 60);
      if (cutoffG > 0) {
        for (let t = 0; t < cutoffG; t += 5) {
          blockedSet.add(minutesToTimeStr(t));
        }
      }

      return res.json({ bookedTimes: Array.from(blockedSet), groupAvailability, capacity });
    }
  }

  // Cours collectifs récurrents ce jour-là — leurs créneaux bloquent les
  // employés assignés (ou tout le monde, si aucun employé n'est assigné) pour
  // les AUTRES services. Calculé une fois, réutilisé par les 3 cas ci-dessous.
  const coursesToday = await getCoursesForDate(companyId, date);

  // Durée de la prestation demandée (utilisée pour vérifier les chevauchements).
  const newDuration = (serviceDuration && Number(serviceDuration) > 0)
    ? Number(serviceDuration)
    : (companyDoc?.slotTime || 30);

  // Pas d'itération entre deux créneaux candidats (doit correspondre à getSchedule).
  const step = (companyDoc?.slotMode === "interval")
    ? (companyDoc?.slotInterval || 30)
    : newDuration;

  // Temps tampon (en minutes) à respecter avant et après chaque RDV existant
  // (modulables indépendamment, ex: 0 min avant / 30 min après).
  const bufferBefore = companyDoc?.bufferBefore ?? companyDoc?.bufferTime ?? 0;
  const bufferAfter  = companyDoc?.bufferAfter  ?? companyDoc?.bufferTime ?? 0;

  // Construit, pour une liste de réservations, la liste des plages occupées
  // [début - bufferBefore, fin + bufferAfter) en minutes depuis minuit.
  function buildOccupiedRanges(bookings) {
    return bookings.map((b) => {
      const [h, m] = b.startTime.split(":").map(Number);
      const startMin = h * 60 + m;
      const endMin   = startMin + (b.slotTime || newDuration);
      return [Math.max(0, startMin - bufferBefore), Math.min(24 * 60, endMin + bufferAfter)];
    });
  }

  // Pour chaque créneau candidat [t, t + newDuration), bloque t s'il
  // chevauche au moins une des plages occupées fournies.
  function blockedFromRanges(blockedSet, ranges) {
    if (ranges.length === 0) return;
    for (let t = 0; t < 24 * 60; t += step) {
      if (ranges.some(([rs, re]) => rangesOverlap(t, t + newDuration, rs, re))) {
        blockedSet.add(minutesToTimeStr(t));
      }
    }
  }

  // Helper: bloque les créneaux passés ET ceux trop proches dans le temps
  // (délai minimum de réservation configuré par l'admin) — peut couvrir la
  // journée entière si le délai dépasse les heures restantes de ce jour.
  function blockPastSlots(blockedSet) {
    const cutoff = Math.min(Math.max(nowMinutes, leadCutoffMinutesForDay), 24 * 60);
    if (cutoff <= 0) return;
    for (let t = 0; t < cutoff; t += step) {
      blockedSet.add(minutesToTimeStr(t));
    }
  }

  // ── Regroupement des rendez-vous ("smart grouping") ─────────────────────
  // Si activé, on calcule les créneaux "proches" d'un RDV déjà confirmé ce
  // jour-là pour les mettre en avant côté widget client — JAMAIS pour bloquer
  // un créneau, uniquement pour suggérer un ordre d'affichage qui évite de
  // fragmenter la journée d'un indépendant qui débute (peu de clients).
  const smartGrouping = companyDoc?.smartGrouping;
  // blockedSet est passé une fois entièrement construit par chaque cas
  // ci-dessous, afin de ne JAMAIS recommander un créneau déjà pris/passé.
  // Si la fenêtre configurée ne contient aucun créneau libre (ex: elle est
  // presque entièrement recouverte par le RDV existant lui-même), on
  // l'élargit progressivement par tranches de 60 min jusqu'à trouver au
  // moins un créneau disponible — sinon le client ne voit qu'un mur de
  // créneaux barrés sans rien à réserver.
  // Jours où le regroupement s'applique (vide = tous les jours).
  const smartGroupingWeekdays = smartGrouping?.weekdays || [];
  const smartGroupingActiveToday = smartGroupingWeekdays.length === 0
    || smartGroupingWeekdays.includes(requestedDate.getDay());

  function computeRecommendedTimes(anchorBookings, blockedSet) {
    if (!smartGrouping?.enabled || !smartGroupingActiveToday || !anchorBookings || anchorBookings.length === 0) return null;
    const baseWindowMin = Math.max(1, Number(smartGrouping.windowHours) || 3) * 60;
    const anchors = anchorBookings.map((b) => {
      const [h, m] = b.startTime.split(":").map(Number);
      return h * 60 + m;
    });
    for (let windowMin = baseWindowMin; windowMin <= 24 * 60; windowMin += 60) {
      const recommended = new Set();
      for (let t = 0; t < 24 * 60; t += step) {
        const timeStr = minutesToTimeStr(t);
        if (blockedSet.has(timeStr)) continue;
        if (anchors.some((a) => Math.abs(t - a) <= windowMin)) recommended.add(timeStr);
      }
      if (recommended.size > 0) return Array.from(recommended);
    }
    return null; // toute la journée est prise — rien à recommander
  }

  // ── Agenda Google personnel : si le pro a connecté son agenda perso, on
  // bloque aussi les créneaux occupés par ses RDV persos (visio, médical, etc.) ──
  let googleRanges = [];
  if (companyDoc?.owner) {
    try {
      const ownerUser = await User.findById(companyDoc.owner).select("googleCalendar").lean();
      const gcal = ownerUser?.googleCalendar;
      if (gcal?.connected && gcal?.refreshToken) {
        const dateStr = new Date(date).toISOString().split("T")[0];
        const busyIntervals = await getBusyIntervals(gcal.refreshToken, dateStr);
        busyIntervals.forEach((interval) => {
          const startMin = interval.start.getHours() * 60 + interval.start.getMinutes();
          let endMin = interval.end.getHours() * 60 + interval.end.getMinutes();
          if (endMin <= startMin) endMin = 24 * 60; // événement traversant minuit / journée entière
          googleRanges.push([Math.max(0, startMin - bufferBefore), Math.min(24 * 60, endMin + bufferAfter)]);
        });
      }
    } catch (err) {
      console.error("[GCal] Erreur lors de la vérification de l'agenda perso:", err.message);
    }
  }

  // ── Case 1: specific employee selected → block only their slots ──────────
  if (specificEmployee) {
    // Include employee: null bookings (admin-created, no assignment) — they block everyone.
    const bookings = await Booking.find({ ...baseQuery, $or: [{ employee: employeeId }, { employee: null }] }).select("startTime slotTime").lean();
    const blockedSet = new Set();
    blockedFromRanges(blockedSet, buildOccupiedRanges(bookings));
    blockedFromRanges(blockedSet, googleRanges);
    blockedFromRanges(blockedSet, courseRangesFor(coursesToday, employeeId));
    blockPastSlots(blockedSet);
    return res.json({ bookedTimes: Array.from(blockedSet), recommendedTimes: computeRecommendedTimes(bookings, blockedSet) });
  }

  // ── Case 2: no filter → block slot only when EVERY bookable membre is busy.
  // Réduit naturellement au cas "solo" (équipe d'1 seule personne = le
  // patron) et au cas "personne n'est bookable" (équipe vide → tout bloqué,
  // .every() sur un tableau vide retourne toujours true) sans branche à part.
  // On inclut les RDV employee:null (créés admin sans assignation) qui
  // occupent TOUS les membres, donc font basculer "allBusy" à true.
  const bookings = await Booking.find({
    ...baseQuery,
    $or: [
      { employee: { $in: team.map((m) => m.id) } },
      { employee: null },
    ],
  }).select("startTime slotTime employee").lean();

  // Group bookings per employee, then build their occupied ranges — pré-rempli
  // avec les cours collectifs qui occupent chaque employé ce jour-là.
  const rangesByEmployee = new Map(); // employeeId string → ranges[]
  team.forEach((m) => rangesByEmployee.set(m.id, courseRangesFor(coursesToday, m.id)));
  bookings.forEach((b) => {
    const ranges = buildOccupiedRanges([b]);
    if (b.employee == null) {
      // RDV sans employé assigné → bloque TOUTE l'équipe
      team.forEach((m) => rangesByEmployee.get(m.id).push(...ranges));
    } else {
      const empId = String(b.employee);
      if (rangesByEmployee.has(empId)) {
        rangesByEmployee.get(empId).push(...ranges);
      }
    }
  });

  // Block a candidate slot only when EVERY active team member has an
  // overlapping occupied range at that time.
  const blockedSet = new Set();
  for (let t = 0; t < 24 * 60; t += step) {
    const allBusy = team.every((m) => {
      const ranges = rangesByEmployee.get(m.id) || [];
      return ranges.some(([rs, re]) => rangesOverlap(t, t + newDuration, rs, re));
    });
    if (allBusy) blockedSet.add(minutesToTimeStr(t));
  }

  // L'agenda Google perso bloque le pro entièrement, peu importe les employés.
  blockedFromRanges(blockedSet, googleRanges);
  blockPastSlots(blockedSet);

  res.json({ bookedTimes: Array.from(blockedSet), recommendedTimes: computeRecommendedTimes(bookings, blockedSet) });
};

function formatFutureDate(date) {
  const now = new Date();
  const d = new Date(date);

  const diffMs = d - now;
  const diffMinutes = Math.round(diffMs / (1000 * 60));
  const diffHours = Math.round(diffMs / (1000 * 60 * 60));

  // passé (sécurité)
  if (diffMs < 0) {
    return d.toLocaleDateString("fr-BE");
  }

  // moins de 1 heure
  if (diffMinutes < 60) {
    return `dans ${diffMinutes} min`;
  }

  // moins de 24h
  if (diffHours < 24) {
    return `dans ${diffHours} h`;
  }

  // demain
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  if (d.toDateString() === tomorrow.toDateString()) {
    return `demain à ${d.toLocaleTimeString("fr-BE", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  // sinon date complète
  return d.toLocaleDateString("fr-BE");
}

exports.renderAppointments = async (req, res, next) => {
  const appointments = await getAppointments();
  const futureAppointments = [];

  const now = new Date();

  appointments.forEach((appointment) => {
    const [h, m] = appointment.startTime.split(":").map(Number);

    const appointmentDate = new Date(appointment.date);
    appointmentDate.setHours(h, m, 0, 0);

    if (appointmentDate > now) {
      futureAppointments.push({
        ...appointment.toObject(),
        displayDate: appointmentDate.toLocaleDateString("fr-BE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
      });
    }
  });

  req.appointments = futureAppointments;
  next();
};

exports.getSchedule = async (req, res) => {
  const { index, COMPANY_ID, date, serviceDuration, employeeId, serviceId } = req.body;
  const jsWeekdayIndex = parseInt(index);

  // ── Cours collectif (planning récurrent fixe) : pas de grille horaire — un
  // seul créneau possible, celui du cours, et seulement les jours où il a lieu.
  if (serviceId) {
    const courseService = await Service.findById(serviceId).select("type recurring").lean();
    if (courseService?.type === "group" && courseService.recurring?.enabled) {
      const onThisWeekday = (courseService.recurring.weekdays || []).includes(jsWeekdayIndex);
      return res.json({ slots: onThisWeekday ? [courseService.recurring.startTime] : [] });
    }
  }

  // 1. Récupérer la config de base (pour le slotTime et les horaires par défaut)
  const company = await Company.findById(COMPANY_ID)
    .select("schedule slotTime slotMode slotInterval scheduleMode owner ownerEmployeeProfile.schedule")
    .lean();

  // 2. CHERCHER UNE EXCEPTION (DaysOff) — filtrée par employé si précisé
  const searchDateStr = new Date(date).toISOString().split("T")[0];
  const specificEmp   = employeeId && employeeId !== "null" && employeeId !== "";

  const exceptionsDoc = await DaysOff.findOne({ company: COMPANY_ID });

  // ── Horaire individuel (cf. plan grades/permissions) ───────────────────────
  // Si un employé précis est choisi et que la company est en mode
  // "perEmployee", la grille de créneaux se base sur SON horaire (avec repli
  // sur le commun si pas encore configuré) au lieu du Company.schedule.
  let baseSchedule = company.schedule;
  if (specificEmp && company.scheduleMode === "perEmployee") {
    let individualSchedule;
    if (String(company.owner) === String(employeeId)) {
      individualSchedule = company.ownerEmployeeProfile?.schedule;
    } else {
      const CompanyMembership = require("../db/models/company/companyMembership.model");
      const membership = await CompanyMembership.findOne({ company: COMPANY_ID, user: employeeId }).select("schedule").lean();
      individualSchedule = membership?.schedule;
    }
    if (individualSchedule && individualSchedule.length > 0) baseSchedule = individualSchedule;
  }

  let target = baseSchedule.find((d) => d.weekdayIndex === jsWeekdayIndex);

  if (exceptionsDoc && exceptionsDoc.dates) {
    // Trouver une exception pertinente pour cet employé (ou pour tous si pas d'employé)
    const relevantException = exceptionsDoc.dates.find((d) => {
      if (new Date(d.date).toISOString().split("T")[0] !== searchDateStr) return false;
      const empIds = (d.employees || []).map((e) => String(e));
      if (specificEmp) {
        // Exception pertinente si : tous les employés (vide) OU cet employé
        return empIds.length === 0 || empIds.includes(String(employeeId));
      } else {
        // Pas de préférence : ne bloquer que si l'exception concerne TOUS les employés
        return empIds.length === 0;
      }
    });

    if (relevantException) {
      if (
        relevantException.workingHours &&
        relevantException.workingHours.length > 0 &&
        relevantException.workingHours[0].start
      ) {
        target = relevantException; // Journée avec horaires spéciaux
      } else {
        return res.json({ slots: [] }); // Jour bloqué pour cet employé/tous
      }
    }
  }

  // 3. GENERATION DES SLOTS (Ta logique actuelle, mais avec le bon "target")
  if (
    !target ||
    target.dayOff ||
    (target.workingHours && target.workingHours.length === 0)
  ) {
    return res.json({ slots: [] });
  }

  // Durée réelle de la prestation demandée (utilisée pour vérifier qu'un
  // créneau a la place de se terminer avant la fin de la plage horaire).
  const duration = (serviceDuration && Number(serviceDuration) > 0)
    ? Number(serviceDuration)
    : company.slotTime;

  // Pas d'itération entre deux créneaux proposés :
  //  - "fixed"    : un créneau par tranche de `duration` (ex: 9h00, 9h30, 10h00…)
  //  - "interval" : un créneau toutes les `slotInterval` minutes, peu importe
  //                  la durée de la prestation (ex: 9h00, 9h10, 9h20…)
  const step = (company.slotMode === "interval")
    ? (company.slotInterval || 30)
    : duration;

  let allSlots = [];
  target.workingHours.forEach((period) => {
    const [startH, startM] = period.start.split(":").map(Number);
    const [endH, endM] = period.end.split(":").map(Number);

    let current = startH * 60 + startM;
    const endTotal = endH * 60 + endM;

    // La prestation doit pouvoir se terminer avant la fin de la plage horaire.
    while (current + duration <= endTotal) {
      const h = Math.floor(current / 60);
      const m = current % 60;
      allSlots.push(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      );
      current += step;
    }
  });

  res.json({ slots: allSlots });
};

// - Saturday no schedule

exports.getDaysOff = async (req, res) => {
  const { COMPANY_ID, employeeId } = req.body;
  const company = await Company.findById(COMPANY_ID)
    .select("schedule scheduleMode owner ownerEmployeeProfile.schedule")
    .lean();

  const specificEmp = employeeId && employeeId !== "null" && employeeId !== "";

  if (company?.scheduleMode === "perEmployee") {
    const CompanyMembership = require("../db/models/company/companyMembership.model");

    if (specificEmp) {
      // Employé sélectionné → son horaire individuel
      let individualSchedule;
      if (String(company.owner) === String(employeeId)) {
        individualSchedule = company.ownerEmployeeProfile?.schedule;
      } else {
        const membership = await CompanyMembership.findOne({ company: COMPANY_ID, user: employeeId }).select("schedule").lean();
        individualSchedule = membership?.schedule;
      }
      if (individualSchedule && individualSchedule.length > 0) {
        return res.json({ result: { schedule: individualSchedule } });
      }
    } else {
      // "Pas de préférence" → union : un jour est grisé seulement si TOUS les employés l'ont en dayOff
      const memberships = await CompanyMembership.find({ company: COMPANY_ID, isEmployee: true, status: "accepted" }).select("schedule").lean();

      const allSchedules = [];
      // Patron
      const ownerSched = company.ownerEmployeeProfile?.schedule;
      allSchedules.push(ownerSched && ownerSched.length > 0 ? ownerSched : company.schedule || []);
      // Collaborateurs employés
      for (const mem of memberships) {
        allSchedules.push(mem.schedule && mem.schedule.length > 0 ? mem.schedule : company.schedule || []);
      }

      if (allSchedules.length > 0 && company.schedule && company.schedule.length > 0) {
        const unionSchedule = company.schedule.map(day => {
          const allOff = allSchedules.every(sched => {
            const d = sched.find(s => s.weekdayIndex === day.weekdayIndex);
            return !d || d.dayOff;
          });
          return { ...day, dayOff: allOff };
        });
        return res.json({ result: { schedule: unionSchedule } });
      }
    }
  }

  return res.json({ result: company });
};

exports.getDisabledDays = async (req, res) => {
  const { companyId } = req.params;
  const employeeId  = req.query.employeeId;
  const specificEmp = employeeId && employeeId !== "null" && employeeId !== "";

  const doc = await DaysOff.findOne({ company: companyId }).select("dates");
  if (!doc) return res.json([]);

  const filtered = doc.dates.filter((d) => {
    const empIds = (d.employees || []).map((e) => String(e));
    if (specificEmp) {
      // Bloquer ce jour si l'exception concerne tous (vide) OU cet employé
      return empIds.length === 0 || empIds.includes(String(employeeId));
    } else {
      // Pas de préférence : griser le jour seulement si tous les employés sont off (tableau vide)
      return empIds.length === 0;
    }
  });

  return res.json(filtered);
};

exports.getBookingC = async (req, res) => {
  try {
    const { companyId } = req.params;

    // ── FAILLE CRITIQUE CORRIGÉE (endpoint PUBLIC, sans auth) ─────────────
    // Avant, cette route renvoyait les documents COMPLETS de tous les RDV
    // d'un établissement : PII client (nom/email/téléphone/message) ET
    // métadonnées de paiement (cardLast4, cardBrand, stripeCustomerId…).
    // Énumérer les companyId exfiltrait toute la clientèle. Le widget de
    // réservation n'a besoin QUE de la date + du créneau pour calculer le
    // taux de remplissage → projection minimale, aucune donnée sensible.
    // On borne aussi aux RDV futurs (les seuls réservables) + une limite.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const doc = await Booking.find({
      company: companyId,
      status: { $ne: "canceled" },
      date: { $gte: startOfToday },
    })
      .select("date startTime endTime slotTime -_id")
      .limit(2000)
      .lean();

    res.json(doc);
  } catch (err) {
    console.error("getBookingC error:", err.message);
    res.status(500).json([]);
  }
};

// ── GET : page interstitielle de confirmation (ne modifie RIEN) ───────────────
// FAILLE CORRIGÉE : l'ancien GET annulait (et prélevait des frais Stripe !) dès
// le chargement du lien. Les aperçus de liens des messageries (Outlook, WhatsApp,
// antivirus) préchargent les URL → annulations/prélèvements fantômes. Le GET se
// contente désormais d'AFFICHER une page de confirmation ; l'annulation réelle
// n'a lieu qu'après un POST explicite (exports.cancelBooking ci-dessous).
exports.cancelBookingPage = async (req, res) => {
  try {
    const { userId } = req.params;
    const { token } = req.query;

    const booking = await Booking.findOne({ _id: userId, cancelToken: token })
      .select("name surname date startTime endTime serviceName status company payment")
      .lean();

    if (!booking) {
      return res.status(404).render("client/404.pug", {
        message: "Lien d'annulation invalide ou déjà utilisé.",
      });
    }
    if (booking.status === "canceled") {
      return res.render("client/cancel-confirm", { alreadyCanceled: true, booking, token, feeInfo: null });
    }

    // Frais éventuels affichés AVANT confirmation (transparence).
    const company = await Company.findById(booking.company).select("cancellationPolicy").lean();
    const rule = company?.cancellationPolicy?.rule || "free";
    const hrs = hoursUntil(booking.date, booking.startTime);
    const price = booking.payment?.amount || 0;
    let feePct = 0;
    if (rule === "half_24h") feePct = hrs < 24 ? 0.5 : 0;
    else if (rule === "full_12h") feePct = hrs < 12 ? 1 : (hrs < 24 ? 0.5 : 0);
    const feeInfo = (feePct > 0 && price > 0 && ["authorized", "paid"].includes(booking.payment?.status))
      ? { pct: Math.round(feePct * 100), amount: (price * feePct).toFixed(2) }
      : null;

    return res.render("client/cancel-confirm", { alreadyCanceled: false, booking, token, feeInfo });
  } catch (err) {
    console.error("cancelBookingPage error:", err.message);
    return res.status(500).render("client/404.pug", { message: "Une erreur est survenue." });
  }
};

// ── POST : annulation réelle (mutation, prélèvements, emails) ──────────────────
exports.cancelBooking = async (req, res) => {
  const { userId } = req.params;
  const { token } = req.query;

  const canceledBooking = await Booking.findOneAndUpdate(
    { _id: userId, cancelToken: token },
    { status: "canceled" },
    { new: false },
  ).lean();

  if (!canceledBooking) {
    return res.status(404).render("client/404.pug", {
      message: "Lien d'annulation invalide ou déjà utilisé.",
    });
  }

  const company = await Company.findById(canceledBooking.company);
  const coach   = await User.findById(company.owner);
  const policyRule = company?.cancellationPolicy?.rule || "free";
  const serviceDoc = canceledBooking.service
    ? await Service.findById(canceledBooking.service).select("cancellationFee").lean()
    : null;

  // ── % des frais retenus / prélevés selon la politique d'annulation ────────
  function penaltyPct(rule, hrs) {
    if (hrs < 0) return 0; // RDV déjà passé : rien à prélever ici (cf. no-show)
    if (rule === "half_24h") return hrs < 24 ? 0.5 : 0;
    if (rule === "full_12h") return hrs < 12 ? 1 : (hrs < 24 ? 0.5 : 0);
    return 0; // "free"
  }

  let chargeResult = null;

  // "method" peut être "online" (prépaiement) OU "on_site" (carte enregistrée
  // en garantie, cf. politique d'annulation) — dans les deux cas Stripe doit
  // potentiellement prélever/rembourser. On se base donc sur le statut réel
  // du paiement, pas sur le libellé de la méthode choisie par le client.
  const hadStripePayment = ["authorized", "paid"].includes(canceledBooking.payment?.status);
  if (stripe && hadStripePayment) {
    const hrs    = hoursUntil(canceledBooking.date, canceledBooking.startTime);
    const amount = canceledBooking.payment.amount || 0;

    // ── Nouveau flux : carte enregistrée, 0€ prélevé à la réservation ───────
    if (canceledBooking.payment?.status === "authorized" &&
        canceledBooking.payment?.stripeCustomerId &&
        canceledBooking.payment?.stripePaymentMethodId) {

      const pct = penaltyPct(policyRule, hrs);
      const feeAmount = resolveFeeAmount(serviceDoc, amount, amount * pct);
      const chargeCents = toCents(feeAmount);

      if (pct > 0 && feeAmount > 0 && chargeCents >= 50) {
        try {
          const pi = await stripe.paymentIntents.create({
            amount:         chargeCents,
            currency:       canceledBooking.payment.currency || "eur",
            customer:       canceledBooking.payment.stripeCustomerId,
            payment_method: canceledBooking.payment.stripePaymentMethodId,
            off_session:    true,
            confirm:        true,
            description:    `Frais d'annulation — ${canceledBooking.serviceName || "Réservation"}`,
          });
          await Booking.findByIdAndUpdate(canceledBooking._id, {
            "payment.status": "penalty",
            "payment.stripePaymentIntentId": pi.id,
            "payment.penaltyAmount": feeAmount,
            "payment.paidAt": new Date(),
          });
          chargeResult = { charged: true, pct: Math.round((feeAmount / amount) * 100), amount: feeAmount };
        } catch (stripeErr) {
          console.error("Penalty charge error:", stripeErr.message);
          await Booking.findByIdAndUpdate(canceledBooking._id, { "payment.status": "failed" });
          chargeResult = { charged: false, error: true };
        }
      } else {
        // Aucun frais à prélever → la pré-autorisation est simplement abandonnée
        await Booking.findByIdAndUpdate(canceledBooking._id, { "payment.status": "none" });
        chargeResult = { charged: false, pct: 0 };
      }

    // ── Ancien flux : montant total déjà capturé → remboursement ────────────
    } else if (canceledBooking.payment?.status === "paid" && canceledBooking.payment?.stripePaymentIntentId) {
      const piId = canceledBooking.payment.stripePaymentIntentId;
      const pct  = penaltyPct(policyRule, hrs); // % retenu par l'établissement (avant override service)
      const keptAmount = resolveFeeAmount(serviceDoc, amount, amount * pct);
      const refundAmount = Math.max(0, amount - keptAmount);

      try {
        if (keptAmount <= 0) {
          await stripe.refunds.create({ payment_intent: piId, reason: "requested_by_customer" });
          await Booking.findByIdAndUpdate(canceledBooking._id, { "payment.status": "refunded", "payment.keptAmount": 0 });
          chargeResult = { refunded: true, pct: 100, amount, kept: 0 };
        } else if (refundAmount > 0) {
          // Remboursement partiel : une partie revient au client, le reste à l'admin
          const refundCents = toCents(refundAmount);
          if (refundCents >= 50) {
            await stripe.refunds.create({ payment_intent: piId, amount: refundCents, reason: "requested_by_customer" });
            await Booking.findByIdAndUpdate(canceledBooking._id, {
              "payment.status":     "partial",
              "payment.keptAmount": keptAmount,
            });
            chargeResult = { refunded: true, pct: Math.round((refundAmount / amount) * 100), amount: refundAmount, kept: keptAmount };
          } else {
            // Montant du remboursement trop faible (<0,50€) → on rembourse tout pour éviter les frais
            await stripe.refunds.create({ payment_intent: piId, reason: "requested_by_customer" });
            await Booking.findByIdAndUpdate(canceledBooking._id, { "payment.status": "refunded", "payment.keptAmount": 0 });
            chargeResult = { refunded: true, pct: 100, amount, kept: 0 };
          }
        } else {
          // keptAmount >= amount (pénalité 100%) : rien à rembourser, l'établissement garde tout
          await Booking.findByIdAndUpdate(canceledBooking._id, { "payment.keptAmount": keptAmount });
          chargeResult = { refunded: false, pct: 0, kept: keptAmount };
        }
      } catch (stripeErr) {
        console.error("Refund error:", stripeErr.message);
      }
    }
  }

  // Sync Google Calendar
  if (canceledBooking.googleEventId) {
    try {
      if (coach?.googleCalendar?.connected && coach.googleCalendar.refreshToken) {
        await deleteEventFromCalendar(coach.googleCalendar.refreshToken, canceledBooking.googleEventId);
      }
    } catch (gcalErr) {
      console.error("Google Calendar sync error (public cancel):", gcalErr.message);
    }
  }

  // ── Emails de confirmation d'annulation (client + admin) ─────────────────
  // Couvre les deux points d'entrée : lien d'annulation reçu par email ET
  // bouton "Annuler" depuis l'espace client — les deux passent par cette
  // même route /cancel-booking/:userId.
  try {
    const formattedCancelDate = new Date(canceledBooking.date).toLocaleDateString("fr-FR", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric",
    });
    const clientDisplay = [canceledBooking.name, canceledBooking.surname].filter(Boolean).join(" ") || canceledBooking.email;

    if (canceledBooking.email) {
      const clientHtml = pug.renderFile(
        path.join(__dirname, "../views/templates/emails/booking-canceled-client.pug"),
        {
          name: canceledBooking.name,
          surname: canceledBooking.surname,
          formattedDate: formattedCancelDate,
          startHour: canceledBooking.startTime,
          endHour: canceledBooking.endTime,
          serviceName: canceledBooking.serviceName || "",
          chargeResult,
        },
      );
      await sendEmail(canceledBooking.email, "Votre rendez-vous a été annulé — BranShee", clientHtml);
    }

    if (coach && coach.notifications?.cancellation !== false) {
      const adminEmail = coach.emailPro || coach.email;
      if (adminEmail) {
        const adminHtml = pug.renderFile(
          path.join(__dirname, "../views/templates/emails/admin-booking-canceled.pug"),
          {
            name: canceledBooking.name,
            surname: canceledBooking.surname,
            email: canceledBooking.email,
            formattedDate: formattedCancelDate,
            startHour: canceledBooking.startTime,
            endHour: canceledBooking.endTime,
            serviceName: canceledBooking.serviceName || "",
            chargeResult,
          },
        );
        await sendEmail(adminEmail, `❌ Annulation — ${clientDisplay}`, adminHtml);
      }
    }
  } catch (emailErr) {
    console.error("Cancellation email error:", emailErr.message);
  }

  res.render("client/cancel-confirmation.pug", {
    chargeResult,
    company,
    coach,
  });
};

// ─── CLIENT PANEL ───────────────────────────────────────────────────────────
exports.getClientPanel = async (req, res) => {
  res.render("client/my-bookings", {
    title: "Mes rendez-vous — BranShee",
    alwaysSticky: true,
    bookings: null,
    email: null,
    error: null,
  });
};

exports.postClientPanel = async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes("@")) {
    return res.render("client/my-bookings", {
      title: "Mes rendez-vous — BranShee",
      alwaysSticky: true,
      bookings: null,
      email: null,
      error: "Veuillez entrer une adresse email valide.",
    });
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const allBookings = await Booking.find({ email: email.toLowerCase().trim() })
    .populate("company", "fullName profilePicture")
    .sort({ date: -1 })
    .lean();

  const upcoming = allBookings.filter(
    (b) => new Date(b.date) >= now && b.status === "confirmed"
  );
  const past = allBookings.filter(
    (b) => new Date(b.date) < now || b.status === "canceled"
  );

  return res.render("client/my-bookings", {
    title: "Mes rendez-vous — BranShee",
    alwaysSticky: true,
    bookings: { upcoming, past },
    email,
    error: null,
  });
};
