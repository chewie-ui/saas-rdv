const Company = require("../db/models/company/company.model");
const DaysOff = require("../db/models/company/daysOff.model");
const CompanyMembership = require("../db/models/company/companyMembership.model");
const { atLeast } = require("../utils/planLimits");

// Endpoint PUBLIC (page de réservation, sans authentification) — ne doit
// renvoyer QUE ce que le calendrier client a besoin de connaître (durée des
// créneaux, délai minimum de réservation). Avant, le document Company
// complet était renvoyé tel quel, exposant l'IBAN/BIC et les identifiants
// Stripe Connect de l'établissement (payoutInfo, stripeConnect,
// acceptedPayments.bankTransfer) à quiconque devinait un companyId.
exports.companyInfos = async (req, res) => {
  const { companyId } = req.params;
  const doc = await Company.findById(companyId).select("slotTime slotMode slotInterval minBookingLeadTime");
  if (!doc) return res.status(404).json({ error: "Établissement introuvable." });
  return res.json(doc);
};

exports.getDaysOff = async (req, res) => {
  const result = await DaysOff.findOne({
    company: res.locals.currentCompany._id,
  });
  return res.json(result);
};

exports.addDaysOff = async (req, res) => {
  const { dateKey, employeeIds } = req.body;

  const result = await DaysOff.findOneAndUpdate(
    { company: res.locals.currentCompany._id },
    {
      $push: {
        dates: {
          date: new Date(dateKey),
          workingHours: [],
          dayOff: true,
          employees: Array.isArray(employeeIds) ? employeeIds : [],
        },
      },
    },
    { upsert: true, new: true },
  );

  // Find the newly added date entry to return its _id
  const searchDateStr = new Date(dateKey).toISOString().split("T")[0];

  const newEntry = result.dates
    .slice()
    .reverse()
    .find(
      (d) => new Date(d.date).toISOString().split("T")[0] === searchDateStr,
    );

  return res.json({ success: true, dateEntry: newEntry });
};

exports.removeDaysOff = async (req, res) => {
  const { dateKey } = req.body;

  const cleanDate = new Date(dateKey);

  await DaysOff.updateOne(
    { company: res.locals.currentCompany._id },
    {
      $pull: {
        dates: { date: cleanDate },
      },
    },
  );

  res.json({ success: true });
};

exports.removeDayOff = async (req, res) => {
  const { dayId } = req.params;
  console.log("ID", dayId);
  console.log(res.locals.currentCompany._id);

  await DaysOff.updateOne(
    {
      company: res.locals.currentCompany._id,
    },
    {
      $pull: {
        dates: { _id: dayId },
      },
    },
  );

  return res.json({ success: true });
};

exports.deleteTimeSlot = async (req, res) => {
  try {
    const { weekdayIndex, slotId } = req.body;
    const companyId = res.locals.currentCompany._id;

    console.log(weekdayIndex);
    console.log(slotId);
    console.log(companyId);

    await Company.updateOne(
      {
        _id: companyId,
        "schedule.weekdayIndex": weekdayIndex,
      },
      {
        $pull: {
          "schedule.$.workingHours": {
            _id: slotId,
          },
        },
      },
    );

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
};

exports.scheduleDayOff = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const { schedule, slots, dateId } = req.body;

    // Le client est la source de vérité : il envoie la liste COMPLÈTE des
    // créneaux (`slots`, multi-créneaux). On garde la rétro-compatibilité avec
    // l'ancienne page qui envoyait un objet unique `schedule`.
    // HH:MM zéro-paddé → l'ordre lexicographique == ordre chronologique.
    let hours = [];
    if (Array.isArray(slots)) {
      hours = slots
        .filter((s) => s && s.start && s.end)
        .map((s) => ({ start: String(s.start), end: String(s.end) }))
        .filter((s) => s.start < s.end);
    } else if (schedule && schedule.start && schedule.end) {
      hours = [{ start: schedule.start, end: schedule.end }];
    }

    // Rejeter les chevauchements (défensif — le client valide déjà). HH:MM
    // zéro-paddé → comparaison lexicographique == comparaison chronologique.
    const sortedHours = [...hours].sort((a, b) =>
      a.start < b.start ? -1 : a.start > b.start ? 1 : 0,
    );
    for (let i = 1; i < sortedHours.length; i++) {
      if (sortedHours[i].start < sortedHours[i - 1].end) {
        return res.status(400).json({ success: false, error: "overlap" });
      }
    }

    if (hours.length === 0) {
      // Aucun créneau → congé total
      await DaysOff.findOneAndUpdate(
        { company: companyId, "dates._id": dateId },
        { $set: { "dates.$.workingHours": [], "dates.$.dayOff": true } },
      );
    } else {
      await DaysOff.findOneAndUpdate(
        { company: companyId, "dates._id": dateId },
        { $set: { "dates.$.workingHours": hours, "dates.$.dayOff": false } },
      );
    }
    return res.json({ success: true, count: hours.length });
  } catch (err) {
    console.error(err);
    return res.json(err);
  }
};

exports.updateDayOffEmployees = async (req, res) => {
  try {
    const { dayId } = req.params;
    const { employeeIds } = req.body;
    await DaysOff.updateOne(
      { company: res.locals.currentCompany._id, "dates._id": dayId },
      { $set: { "dates.$.employees": Array.isArray(employeeIds) ? employeeIds : [] } }
    );
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false });
  }
};

exports.setScheduleDayOff = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const { dateId, time, type } = req.body;

    if (!["start", "end"].includes(type)) {
      return res.status(400).json({ success: false, error: "Type undefined" });
    }

    const fieldPath = `dates.$.workingHours.0.${type}`;

    const updated = await DaysOff.findOneAndUpdate(
      { company: companyId, "dates._id": dateId },
      {
        $set: {
          [fieldPath]: time,
          "dates.$.dayOff": false,
        },
      },
      { new: true },
    );

    if (!updated) {
      return res.status(404).json({ success: false, error: "Date not found" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

exports.updateBuffer = async (req, res) => {
  try {
    // Déclaré Pro dans LIMITS.availability mais jamais vérifié ici jusqu'à
    // présent — un compte gratuit pouvait déjà activer ce réglage.
    if (!atLeast(res.locals.billingUser, "pro")) {
      return res.status(403).json({ success: false, error: "Fonctionnalité réservée au forfait Pro." });
    }
    const { bufferBefore, bufferAfter } = req.body;
    const before = Math.max(0, Math.min(120, Number(bufferBefore) || 0));
    const after  = Math.max(0, Math.min(120, Number(bufferAfter) || 0));
    await Company.findByIdAndUpdate(res.locals.currentCompany._id, { bufferBefore: before, bufferAfter: after });
    return res.json({ success: true, bufferBefore: before, bufferAfter: after });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

exports.updateSlotMode = async (req, res) => {
  try {
    // Même bug que updateBuffer : "slotDuration" est déclaré Pro dans
    // LIMITS.availability mais n'était jamais réellement vérifié.
    if (!atLeast(res.locals.billingUser, "pro")) {
      return res.status(403).json({ success: false, error: "Fonctionnalité réservée au forfait Pro." });
    }
    const { slotMode, slotInterval } = req.body;
    const update = {};

    if (slotMode === "fixed" || slotMode === "interval") {
      update.slotMode = slotMode;
    }
    if (slotInterval !== undefined) {
      update.slotInterval = Math.max(5, Math.min(120, Number(slotInterval) || 30));
    }

    await Company.findByIdAndUpdate(res.locals.currentCompany._id, update);
    return res.json({ success: true, ...update });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ── Regroupement des rendez-vous ("smart grouping") ────────────────────────
exports.updateSmartGrouping = async (req, res) => {
  try {
    const { enabled, windowHours, weekdays } = req.body;
    const update = {};

    if (enabled !== undefined) update["smartGrouping.enabled"] = !!enabled;
    if (windowHours !== undefined) {
      update["smartGrouping.windowHours"] = Math.max(1, Math.min(12, Number(windowHours) || 3));
    } else if (enabled) {
      // Première activation : si l'utilisateur n'a jamais choisi de fenêtre, défaut à 1h (pas 3h).
      const existing = await Company.findById(res.locals.currentCompany._id).select("smartGrouping").lean();
      if (existing?.smartGrouping?.windowHours === undefined) {
        update["smartGrouping.windowHours"] = 1;
      }
    }
    if (weekdays !== undefined) {
      update["smartGrouping.weekdays"] = Array.isArray(weekdays)
        ? [...new Set(weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
        : [];
    }

    await Company.findByIdAndUpdate(res.locals.currentCompany._id, { $set: update });
    return res.json({ success: true, ...update });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ── Délai minimum de réservation ────────────────────────────────────────────
// `minutes` est toujours exprimé en minutes côté backend — l'admin choisit
// une valeur + une unité (minutes/heures/jours) côté UI, convertie en minutes
// avant l'envoi. Plafonné à 90 jours, largement suffisant ("même 1 mois").
exports.updateBookingLeadTime = async (req, res) => {
  try {
    const { enabled, minutes } = req.body;
    const update = {};
    const MAX_MINUTES = 90 * 24 * 60;

    if (minutes !== undefined) {
      const m = Math.max(0, Math.min(MAX_MINUTES, Math.round(Number(minutes)) || 0));
      update["minBookingLeadTime.minutes"] = m;
      // Si l'admin ne précise pas explicitement enabled, on le déduit de la
      // valeur : « Aucun » (0 min) = désactivé, toute valeur > 0 = activé.
      // (Sans ça, choisir « 1 jour » enregistrait les minutes mais laissait
      // enabled=false → le délai n'était jamais appliqué.)
      if (enabled === undefined) update["minBookingLeadTime.enabled"] = m > 0;
    }
    if (enabled !== undefined) update["minBookingLeadTime.enabled"] = !!enabled;

    await Company.findByIdAndUpdate(res.locals.currentCompany._id, { $set: update });
    return res.json({ success: true, ...update });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ── Horaire commun pour tous les employés VS horaire propre à chacun ───────
// Au tout premier passage en "perEmployee", chaque employé dont le schedule
// individuel est encore vide reçoit une COPIE de l'horaire commun actuel
// (cf. plan grades/permissions) — ensuite modifiable indépendamment. Un
// retour à "shared" ne supprime jamais les horaires individuels (juste
// dormants, cf. risques du plan).
exports.updateScheduleMode = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const mode = req.body.scheduleMode === "perEmployee" ? "perEmployee" : "shared";

    const company = await Company.findById(companyId).select("schedule ownerEmployeeProfile").lean();
    if (!company) return res.status(404).json({ success: false, error: "Établissement introuvable." });

    if (mode === "perEmployee") {
      if (!company.ownerEmployeeProfile?.schedule?.length) {
        await Company.updateOne(
          { _id: companyId },
          { $set: { "ownerEmployeeProfile.schedule": company.schedule || [] } }
        );
      }
      // Initialise tous les membres (schedule vide OU champ absent)
      await CompanyMembership.updateMany(
        { company: companyId, isEmployee: true, $or: [{ schedule: { $size: 0 } }, { schedule: { $exists: false } }] },
        { $set: { schedule: company.schedule || [] } }
      );
    }

    await Company.updateOne({ _id: companyId }, { $set: { scheduleMode: mode } });
    return res.json({ success: true, scheduleMode: mode });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};
