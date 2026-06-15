const Booking  = require("../db/models/book.model");
const User     = require("../db/models/user.model");
const Company  = require("../db/models/company/company.model");
const Employee = require("../db/models/company/employee.model");
const Service  = require("../db/models/company/service.model");
const { addEventToCalendar, deleteEventFromCalendar, getBusyIntervals } = require("../utils/googleCalendarSync");
const DaysOff  = require("../db/models/company/daysOff.model");
const { getAppointments } = require("../queries/booking.queries");
const pug  = require("pug");
const path = require("path");
const { getLimit, atLeast } = require("../utils/planLimits");
const { sendEmail } = require("../utils/mailer");
const { isFeatureEnabled } = require("../middlewares/featureFlag");
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

    // ── Récupérer le compte Stripe Connect + plan du coach ────────────────────
    let connectedAccountId = null;
    let coachPlan = "basic";

    if (companyId) {
      try {
        const comp = await Company.findById(companyId).select("stripeConnect owner").lean();
        if (comp?.stripeConnect?.status === "active" && comp.stripeConnect.accountId) {
          connectedAccountId = comp.stripeConnect.accountId;
        }
        // Récupérer le plan du propriétaire pour savoir si on prend des frais
        if (comp?.owner) {
          const owner = await User.findById(comp.owner).select("isPremium manualPremium subscription").lean();
          if (owner) {
            const { getPlan } = require("../utils/planLimits");
            coachPlan = getPlan(owner);
          }
        }
      } catch (_) {}
    }

    // En dev : jamais de transfer_data (les comptes test n'ont pas la capacité transfers)
    const isDevFallback = process.env.NODE_ENV !== "production";

    if (!connectedAccountId && process.env.NODE_ENV === "production") {
      return res.status(400).json({
        error: "stripe_not_connected",
        message: "Cet établissement n'a pas encore connecté Stripe. Choisissez un autre mode de paiement.",
      });
    }

    // ── Frais plateforme Branshee (5% — plan gratuit uniquement) ──────────────
    // Pro et Business → pas de frais
    const PLATFORM_FEE_PCT = 0.05; // 5%
    const applicationFee   = !isDevFallback && coachPlan === "basic"
      ? Math.round(amountCents * PLATFORM_FEE_PCT)
      : 0;

    // ── Créer le PaymentIntent ────────────────────────────────────────────────
    // En production avec un compte connecté : transfer_data vers le coach
    // En dev sans compte connecté : paiement direct (test uniquement)
    const piParams = {
      amount:               amountCents,
      currency:             (currency || "eur").toLowerCase(),
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description:          serviceName ? `Réservation — ${serviceName}` : "Réservation en ligne",
      receipt_email:        email.trim().toLowerCase(),
      ...(connectedAccountId && !isDevFallback && {
        transfer_data: { destination: connectedAccountId },
      }),
      ...(applicationFee > 0 && { application_fee_amount: applicationFee }),
      metadata: {
        companyId:          String(companyId || ""),
        connectedAccountId: connectedAccountId || "none",
        coachPlan,
        platformFee:        applicationFee > 0 ? `${(applicationFee / 100).toFixed(2)}€ (5%)` : "none",
        serviceName:        serviceName || "",
        clientEmail:        email.trim().toLowerCase(),
        clientName:         name || "",
      },
    };

    console.log("[PaymentIntent] Creating:", { amountCents, isDevFallback, connectedAccountId: connectedAccountId || "none" });

    let pi;
    try {
      pi = await stripe.paymentIntents.create(piParams);
    } catch (stripeErr) {
      // Si le compte connecté n'a pas encore les capacités (onboarding incomplet),
      // on retente sans transfer_data pour ne pas bloquer le client
      const isCapabilityError = stripeErr?.raw?.code === "account_invalid" ||
        (stripeErr?.message || "").toLowerCase().includes("capabilities") ||
        (stripeErr?.message || "").toLowerCase().includes("destination account");

      if (isCapabilityError && connectedAccountId) {
        console.warn("[PaymentIntent] Compte connecté sans capacité transfers — paiement direct (sans transfert)");
        const { transfer_data: _td, application_fee_amount: _af, ...fallbackParams } = piParams;
        pi = await stripe.paymentIntents.create(fallbackParams);
      } else {
        throw stripeErr;
      }
    }

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

    let connectedAccountId = null;
    if (companyId) {
      try {
        const comp = await Company.findById(companyId).select("stripeConnect").lean();
        if (comp?.stripeConnect?.status === "active" && comp.stripeConnect.accountId) {
          connectedAccountId = comp.stripeConnect.accountId;
        }
      } catch (_) {}
    }

    if (!connectedAccountId && process.env.NODE_ENV === "production") {
      return res.status(400).json({
        error: "stripe_not_connected",
        message: "Cet établissement n'a pas encore connecté Stripe. Choisissez un autre mode de paiement.",
      });
    }

    const customer = await stripe.customers.create({
      email: email.trim().toLowerCase(),
      name:  name || undefined,
    });

    const setupIntent = await stripe.setupIntents.create({
      customer:             customer.id,
      payment_method_types: ["card"],
      usage:                "off_session",
      metadata: {
        companyId:          String(companyId || ""),
        connectedAccountId: connectedAccountId || "none",
        clientEmail:        email.trim().toLowerCase(),
        clientName:         name || "",
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
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: "Réservation introuvable." });

    const reason = req.body.reason === "valid" ? "valid" : "invalid";
    booking.noShow = true;
    booking.noShowReason = reason;

    if (booking.payment?.method !== "online") {
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
            reverse_transfer: true,
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
      const amountCents = toCents(amount);
      if (amountCents < 50) {
        await booking.save();
        return res.json({ success: false, error: "Montant trop faible pour être prélevé." });
      }

      let connectedAccountId = null;
      try {
        const comp = await Company.findById(booking.company).select("stripeConnect").lean();
        if (comp?.stripeConnect?.status === "active" && comp.stripeConnect.accountId) {
          connectedAccountId = comp.stripeConnect.accountId;
        }
      } catch (_) {}
      const isDevFallback = process.env.NODE_ENV !== "production";

      try {
        const pi = await stripe.paymentIntents.create({
          amount:         amountCents,
          currency:       booking.payment.currency || "eur",
          customer:       booking.payment.stripeCustomerId,
          payment_method: booking.payment.stripePaymentMethodId,
          off_session:    true,
          confirm:        true,
          description:    `Absence non excusée — ${booking.serviceName || "Réservation"}`,
          ...(connectedAccountId && !isDevFallback && { transfer_data: { destination: connectedAccountId } }),
        });

        booking.payment.status = "penalty";
        booking.payment.stripePaymentIntentId = pi.id;
        booking.payment.penaltyAmount = amount;
        booking.payment.paidAt = new Date();
        await booking.save();

        return res.json({ success: true, charged: true, amount });
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
    const booking = await Booking.findById(req.params.id);
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
          reverse_transfer: true,
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

    // employeeId / employeeName may be auto-resolved below — use let
    let employeeId   = req.body.employeeId   || null;
    let employeeName = req.body.employeeName || "";

    const response = await Company.findById(company);
    const companySlotTime = response.slotTime;

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
      serviceDoc = await Service.findById(serviceId).select("type capacity").lean();
    }
    const isGroup = !!(serviceDoc && serviceDoc.type === "group");

    if (isGroup) {
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

    // ── Auto-assign an available employee when none was explicitly chosen ──
    if (!isGroup && !employeeId) {
      const activeEmployees = await Employee.find({ company, active: true }).lean();

      if (activeEmployees.length > 0) {
        // Find employees already booked at an overlapping slot on that date
        const overlapping = await Booking.find({
          company,
          date: new Date(date),
          status: { $ne: "canceled" },
          employee: { $in: activeEmployees.map((e) => e._id) },
        }).select("employee startTime slotTime").lean();

        const busyIds = new Set();
        overlapping.forEach((b) => {
          const [bh, bm] = b.startTime.split(":").map(Number);
          const bStart = bh * 60 + bm;
          const bEnd   = bStart + (b.slotTime || actualDuration);
          // Overlap: our window [startMin, endMin) intersects [bStart, bEnd)
          if (startTimeInMinutes < bEnd && endTimeInMinutes > bStart) {
            busyIds.add(String(b.employee));
          }
        });

        const free = activeEmployees.find((e) => !busyIds.has(String(e._id)));
        if (!free) {
          return res.json({ success: false, error: "no_employee_available" });
        }
        employeeId   = String(free._id);
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
          paymentExtra = {
            status:                "authorized",
            stripeSetupIntentId:   si.id,
            stripeCustomerId:      si.customer || "",
            stripePaymentMethodId: si.payment_method || "",
          };
        }
      } catch (siErr) {
        console.error("SetupIntent retrieve error:", siErr.message);
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
      clientRef: req.session?.clientId || null,
      service:      serviceId   || null,
      serviceName:  serviceName || "",
      employee:     employeeId  || null,
      employeeName: employeeName || "",
      isGroup,
      // ── Payment ────────────────────────────────────────────────────────────
      payment: {
        method: ["online", "on_site", "bank_transfer", "paypal"].includes(paymentMethod) ? paymentMethod : "none",
        status: paymentMethod === "online" && stripePaymentIntentId ? "paid" : "none",
        stripePaymentIntentId: stripePaymentIntentId || "",
        amount:   servicePrice ? Number(servicePrice) : 0,
        currency: "eur",
        paidAt:   paymentMethod === "online" && stripePaymentIntentId ? new Date() : null,
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

    // Build location text
    let locationText = "";
    const loc = companyOwner?.location;
    if (loc?.serviceType === "en_ligne") {
      locationText = "En ligne";
    } else if (loc?.address || loc?.city) {
      locationText = [loc.address, loc.city].filter(Boolean).join(", ");
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

      const isTodayG = isToday;
      const nowMinutesG = isTodayG ? now.getHours() * 60 + now.getMinutes() : -1;
      const blockedSet = new Set();
      const groupAvailability = {};

      Object.keys(counts).forEach((startTime) => {
        groupAvailability[startTime] = { booked: counts[startTime], capacity };
        if (counts[startTime] >= capacity) blockedSet.add(startTime);
      });

      // Block past slots for today (every minute mark — the client only
      // checks the exact slot strings returned by /get-schedule).
      if (nowMinutesG >= 0) {
        for (let t = 0; t < nowMinutesG; t += 5) {
          blockedSet.add(minutesToTimeStr(t));
        }
      }

      return res.json({ bookedTimes: Array.from(blockedSet), groupAvailability, capacity });
    }
  }

  // Get company config so we can compute slot granularity / buffer / mode.
  const [companyDoc, activeEmployeeCount] = await Promise.all([
    Company.findById(companyId).select("slotTime bufferTime slotMode slotInterval owner").lean(),
    // Only count employees when no specific one is filtered
    specificEmployee ? Promise.resolve(0) : Employee.countDocuments({ company: companyId, active: true }),
  ]);

  // Durée de la prestation demandée (utilisée pour vérifier les chevauchements).
  const newDuration = (serviceDuration && Number(serviceDuration) > 0)
    ? Number(serviceDuration)
    : (companyDoc?.slotTime || 30);

  // Pas d'itération entre deux créneaux candidats (doit correspondre à getSchedule).
  const step = (companyDoc?.slotMode === "interval")
    ? (companyDoc?.slotInterval || 30)
    : newDuration;

  // Temps tampon (en minutes) à respecter avant ET après chaque RDV existant.
  const buffer = companyDoc?.bufferTime || 0;

  // Construit, pour une liste de réservations, la liste des plages occupées
  // [début - buffer, fin + buffer) en minutes depuis minuit.
  function buildOccupiedRanges(bookings) {
    return bookings.map((b) => {
      const [h, m] = b.startTime.split(":").map(Number);
      const startMin = h * 60 + m;
      const endMin   = startMin + (b.slotTime || newDuration);
      return [Math.max(0, startMin - buffer), Math.min(24 * 60, endMin + buffer)];
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

  // Helper: mark all past slots for today as blocked
  function blockPastSlots(blockedSet) {
    if (nowMinutes < 0) return;
    for (let t = 0; t < nowMinutes; t += step) {
      blockedSet.add(minutesToTimeStr(t));
    }
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
          googleRanges.push([Math.max(0, startMin - buffer), Math.min(24 * 60, endMin + buffer)]);
        });
      }
    } catch (err) {
      console.error("[GCal] Erreur lors de la vérification de l'agenda perso:", err.message);
    }
  }

  // ── Case 1: specific employee selected → block only their slots ──────────
  if (specificEmployee) {
    const bookings = await Booking.find({ ...baseQuery, employee: employeeId }).select("startTime slotTime");
    const blockedSet = new Set();
    blockedFromRanges(blockedSet, buildOccupiedRanges(bookings));
    blockedFromRanges(blockedSet, googleRanges);
    blockPastSlots(blockedSet);
    return res.json({ bookedTimes: Array.from(blockedSet) });
  }

  // ── Case 2: no employees on this company → 1 booking blocks the slot ─────
  if (activeEmployeeCount === 0) {
    const bookings = await Booking.find(baseQuery).select("startTime slotTime");
    const blockedSet = new Set();
    blockedFromRanges(blockedSet, buildOccupiedRanges(bookings));
    blockedFromRanges(blockedSet, googleRanges);
    blockPastSlots(blockedSet);
    return res.json({ bookedTimes: Array.from(blockedSet) });
  }

  // ── Case 3: company has employees, no filter → block slot only when ALL are busy ──
  const activeEmployees = await Employee.find({ company: companyId, active: true }).select("_id").lean();

  const bookings = await Booking.find({
    ...baseQuery,
    employee: { $in: activeEmployees.map((e) => e._id) },
  }).select("startTime slotTime employee").lean();

  // Group bookings per employee, then build their occupied ranges.
  const rangesByEmployee = new Map(); // employeeId string → ranges[]
  activeEmployees.forEach((e) => rangesByEmployee.set(String(e._id), []));
  bookings.forEach((b) => {
    const empId = String(b.employee);
    const ranges = buildOccupiedRanges([b]);
    if (rangesByEmployee.has(empId)) {
      rangesByEmployee.get(empId).push(...ranges);
    }
  });

  // Block a candidate slot only when EVERY active employee has an overlapping
  // occupied range at that time.
  const blockedSet = new Set();
  for (let t = 0; t < 24 * 60; t += step) {
    const allBusy = activeEmployees.every((e) => {
      const ranges = rangesByEmployee.get(String(e._id)) || [];
      return ranges.some(([rs, re]) => rangesOverlap(t, t + newDuration, rs, re));
    });
    if (allBusy) blockedSet.add(minutesToTimeStr(t));
  }

  // L'agenda Google perso bloque le pro entièrement, peu importe les employés.
  blockedFromRanges(blockedSet, googleRanges);
  blockPastSlots(blockedSet);

  res.json({ bookedTimes: Array.from(blockedSet) });
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
  const { index, COMPANY_ID, date, serviceDuration, employeeId } = req.body;
  const jsWeekdayIndex = parseInt(index);
  // 1. Récupérer la config de base (pour le slotTime et les horaires par défaut)
  const company = await Company.findById(COMPANY_ID)
    .select("schedule slotTime slotMode slotInterval")
    .lean();

  // 2. CHERCHER UNE EXCEPTION (DaysOff) — filtrée par employé si précisé
  const searchDateStr = new Date(date).toISOString().split("T")[0];
  const specificEmp   = employeeId && employeeId !== "null" && employeeId !== "";

  const exceptionsDoc = await DaysOff.findOne({ company: COMPANY_ID });
  let target = company.schedule.find((d) => d.weekdayIndex === jsWeekdayIndex);

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
  const { COMPANY_ID } = req.body;
  const result = await Company.findById(COMPANY_ID).select("schedule");

  return res.json({ result });
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
  const { companyId } = req.params;

  const doc = await Booking.find({
    company: companyId,
    status: { $ne: "canceled" },
  });

  res.json(doc);
};

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

  // ── % des frais retenus / prélevés selon la politique d'annulation ────────
  function penaltyPct(rule, hrs) {
    if (hrs < 0) return 0; // RDV déjà passé : rien à prélever ici (cf. no-show)
    if (rule === "half_24h") return hrs < 24 ? 0.5 : 0;
    if (rule === "full_12h") return hrs < 12 ? 1 : (hrs < 24 ? 0.5 : 0);
    return 0; // "free"
  }

  let chargeResult = null;

  if (stripe && canceledBooking.payment?.method === "online") {
    const hrs    = hoursUntil(canceledBooking.date, canceledBooking.startTime);
    const amount = canceledBooking.payment.amount || 0;

    // ── Nouveau flux : carte enregistrée, 0€ prélevé à la réservation ───────
    if (canceledBooking.payment?.status === "authorized" &&
        canceledBooking.payment?.stripeCustomerId &&
        canceledBooking.payment?.stripePaymentMethodId) {

      const pct = penaltyPct(policyRule, hrs);
      const chargeCents = toCents(amount * pct);

      if (pct > 0 && amount > 0 && chargeCents >= 50) {
        let connectedAccountId = null;
        if (company?.stripeConnect?.status === "active" && company.stripeConnect.accountId) {
          connectedAccountId = company.stripeConnect.accountId;
        }
        const isDevFallback = process.env.NODE_ENV !== "production";

        try {
          const pi = await stripe.paymentIntents.create({
            amount:         chargeCents,
            currency:       canceledBooking.payment.currency || "eur",
            customer:       canceledBooking.payment.stripeCustomerId,
            payment_method: canceledBooking.payment.stripePaymentMethodId,
            off_session:    true,
            confirm:        true,
            description:    `Frais d'annulation — ${canceledBooking.serviceName || "Réservation"}`,
            ...(connectedAccountId && !isDevFallback && { transfer_data: { destination: connectedAccountId } }),
          });
          await Booking.findByIdAndUpdate(canceledBooking._id, {
            "payment.status": "penalty",
            "payment.stripePaymentIntentId": pi.id,
            "payment.penaltyAmount": amount * pct,
            "payment.paidAt": new Date(),
          });
          chargeResult = { charged: true, pct: pct * 100, amount: amount * pct };
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
      const pct  = penaltyPct(policyRule, hrs); // % retenu par l'établissement
      const refundPct = 1 - pct;

      try {
        if (refundPct >= 1) {
          await stripe.refunds.create({ payment_intent: piId, reason: "requested_by_customer", reverse_transfer: true });
          await Booking.findByIdAndUpdate(canceledBooking._id, { "payment.status": "refunded" });
          chargeResult = { refunded: true, pct: 100, amount };
        } else if (refundPct > 0 && amount > 0) {
          const refundCents = toCents(amount * refundPct);
          if (refundCents >= 50) {
            await stripe.refunds.create({ payment_intent: piId, amount: refundCents, reason: "requested_by_customer", reverse_transfer: true });
            await Booking.findByIdAndUpdate(canceledBooking._id, { "payment.status": "partial" });
            chargeResult = { refunded: true, pct: Math.round(refundPct * 100), amount: amount * refundPct, kept: amount * pct };
          } else {
            await Booking.findByIdAndUpdate(canceledBooking._id, { "payment.status": "refunded" });
            chargeResult = { refunded: true, pct: 100, amount };
          }
        }
        // refundPct === 0 (pénalité 100%) : rien à rembourser, l'établissement garde tout
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
