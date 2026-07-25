// ── API mobile : horaires & congés ────────────────────────────────────────
//   GET    /schedule              horaires de la semaine + réglages créneaux
//   PATCH  /schedule/:weekdayIndex  éditer un jour (plages ou fermé)
//   GET    /timeoff               congés et horaires spéciaux à venir
//   POST   /timeoff               poser un congé ou un horaire spécial
//   DELETE /timeoff/:dateId       retirer
//
// Les permissions suivent le web : modifier l'horaire commun exige
// `availability.manageShared`; poser un congé pour soi seul suffit avec
// `manageOwnTimeOff`, dès que d'autres sont concernés il faut
// `manageOthersTimeOff`.
const Company = require("../../db/models/company/company.model");
const DaysOff = require("../../db/models/company/daysOff.model");
const { getBookableTeam } = require("../../utils/bookableTeam");
const { getLimit } = require("../../utils/planLimits");

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const WEEKDAYS = [
  { index: 1, label: "Lundi" },
  { index: 2, label: "Mardi" },
  { index: 3, label: "Mercredi" },
  { index: 4, label: "Jeudi" },
  { index: 5, label: "Vendredi" },
  { index: 6, label: "Samedi" },
  { index: 0, label: "Dimanche" },
];

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Valide une liste de plages : format correct, fin après début, pas de
// chevauchement entre elles.
function validateRanges(ranges) {
  if (!Array.isArray(ranges)) return "Format des plages horaires invalide.";
  for (const r of ranges) {
    if (!r || !HHMM.test(r.start || "") || !HHMM.test(r.end || "")) {
      return "Heures attendues au format HH:MM.";
    }
    if (toMinutes(r.end) <= toMinutes(r.start)) {
      return `La plage ${r.start}–${r.end} se termine avant de commencer.`;
    }
  }
  const sorted = [...ranges].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  for (let i = 1; i < sorted.length; i++) {
    if (toMinutes(sorted[i].start) < toMinutes(sorted[i - 1].end)) {
      return `Les plages ${sorted[i - 1].start}–${sorted[i - 1].end} et ${sorted[i].start}–${sorted[i].end} se chevauchent.`;
    }
  }
  return null;
}

// GET /api/v1/schedule
exports.get = async (req, res) => {
  try {
    const company = await Company.findById(req.companyCtx.currentCompany._id)
      .select("schedule slotTime slotMode slotInterval scheduleMode bufferBefore bufferAfter")
      .lean();
    if (!company) return res.status(404).json({ error: "not_found", message: "Établissement introuvable." });

    const byIndex = {};
    (company.schedule || []).forEach((d) => { byIndex[d.weekdayIndex] = d; });

    // On renvoie toujours les 7 jours dans l'ordre lundi→dimanche, même si
    // certains n'existent pas encore en base — l'app affiche une semaine complète.
    const days = WEEKDAYS.map((w) => {
      const d = byIndex[w.index];
      const ranges = (d?.workingHours || []).map((h) => ({ start: h.start, end: h.end }));
      return {
        weekdayIndex: w.index,
        label: w.label,
        closed: !d || d.dayOff === true || ranges.length === 0,
        ranges,
      };
    });

    res.json({
      days,
      settings: {
        slotTime: company.slotTime || 30,
        slotMode: company.slotMode || "fixed",
        slotInterval: company.slotInterval || 30,
        scheduleMode: company.scheduleMode || "shared",
      },
      // Ce que le forfait autorise, pour griser les options dans l'app.
      planFeatures: {
        multipleRanges: Boolean(getLimit("availability", req.companyCtx.billingUser)?.ranges),
        buffer: Boolean(getLimit("availability", req.companyCtx.billingUser)?.buffer),
        slotDuration: Boolean(getLimit("availability", req.companyCtx.billingUser)?.slotDuration),
      },
    });
  } catch (err) {
    console.error("[mobile schedule get]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PATCH /api/v1/schedule/:weekdayIndex
exports.updateDay = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const weekdayIndex = Number(req.params.weekdayIndex);
    if (!Number.isInteger(weekdayIndex) || weekdayIndex < 0 || weekdayIndex > 6) {
      return res.status(400).json({ error: "invalid_weekday", message: "Jour invalide (0 à 6)." });
    }

    const closed = Boolean(req.body.closed);
    const ranges = closed ? [] : req.body.ranges || [];

    if (!closed) {
      const err = validateRanges(ranges);
      if (err) return res.status(400).json({ error: "invalid_ranges", message: err });
      if (ranges.length === 0) {
        return res.status(400).json({
          error: "invalid_ranges",
          message: "Ajoutez au moins une plage horaire, ou marquez le jour comme fermé.",
        });
      }
      // Plages multiples réservées aux forfaits payants, comme sur le site.
      const canMultiple = Boolean(getLimit("availability", req.companyCtx.billingUser)?.ranges);
      if (ranges.length > 1 && !canMultiple) {
        return res.status(403).json({
          error: "plan_limit",
          message: "Les plages horaires multiples sont réservées aux forfaits Pro et Business.",
        });
      }
    }

    const company = await Company.findById(companyId).select("schedule").lean();
    const schedule = company?.schedule ? [...company.schedule] : [];
    const idx = schedule.findIndex((d) => d.weekdayIndex === weekdayIndex);
    const entry = {
      weekdayIndex,
      dayOff: closed,
      workingHours: ranges.map((r) => ({ start: r.start, end: r.end })),
    };
    if (idx >= 0) schedule[idx] = entry;
    else schedule.push(entry);

    await Company.updateOne({ _id: companyId }, { $set: { schedule } });

    res.json({ day: { weekdayIndex, closed, ranges: entry.workingHours } });
  } catch (err) {
    console.error("[mobile schedule update]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// GET /api/v1/timeoff — congés à venir (les dates passées sont masquées).
exports.listTimeOff = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const doc = await DaysOff.findOne({ company: companyId }).lean();

    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const dates = (doc?.dates || [])
      .filter((d) => new Date(d.date) >= from)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((d) => ({
        id: String(d._id),
        date: new Date(d.date).toISOString().slice(0, 10),
        // Une exception sans plage horaire = journée bloquée ; avec plages =
        // horaires spéciaux ce jour-là.
        closed: !(d.workingHours || []).length,
        ranges: (d.workingHours || []).map((h) => ({ start: h.start, end: h.end })),
        employeeIds: (d.employees || []).map((e) => String(e)),
        appliesToAll: !(d.employees || []).length,
      }));

    res.json({ timeOff: dates });
  } catch (err) {
    console.error("[mobile timeoff list]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// POST /api/v1/timeoff
exports.addTimeOff = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const date = String(req.body.date || "");
    if (!ISO_DATE.test(date)) {
      return res.status(400).json({ error: "invalid_date", message: "Date attendue au format AAAA-MM-JJ." });
    }

    const closed = req.body.closed !== false; // par défaut : journée bloquée
    const ranges = closed ? [] : req.body.ranges || [];
    if (!closed) {
      const err = validateRanges(ranges);
      if (err) return res.status(400).json({ error: "invalid_ranges", message: err });
      if (!ranges.length) {
        return res.status(400).json({
          error: "invalid_ranges",
          message: "Indiquez les horaires spéciaux, ou marquez la journée comme non travaillée.",
        });
      }
    }

    // Employés concernés : liste vide = tout l'établissement.
    //
    // ⚠️ Le filtrage contre l'équipe réservable ne doit JAMAIS vider une liste
    // explicitement fournie : « liste vide » signifie « tout l'établissement ».
    // Un patron qui a décoché « je suis employé » n'apparaît pas dans
    // getBookableTeam ; son congé « Moi uniquement » devenait alors une
    // fermeture totale, sans le moindre avertissement, visible par tous ses
    // clients. On refuse explicitement plutôt que d'élargir la portée.
    const requested = Array.isArray(req.body.employeeIds) ? req.body.employeeIds.map(String) : [];
    let employees = requested;
    if (requested.length) {
      const team = await getBookableTeam(companyId);
      const valid = new Set(team.map((m) => String(m.id)));
      employees = requested.filter((id) => valid.has(id));
      if (!employees.length) {
        return res.status(400).json({
          error: "not_bookable",
          message:
            "Cette personne n'apparaît pas dans l'équipe réservable : le congé ne peut pas lui être attribué. Activez-la comme praticien, ou posez le congé pour tout l'établissement.",
        });
      }
    }

    // Permission : poser un congé pour soi seul suffit avec manageOwnTimeOff ;
    // dès que cela concerne quelqu'un d'autre (ou tout le monde), il faut
    // manageOthersTimeOff. Même règle que le site.
    const me = String(req.mobileUser._id);
    const onlyMyself = employees.length === 1 && employees[0] === me;
    const perms = req.companyCtx.permissions;
    const allowed = onlyMyself
      ? perms.availability.manageOwnTimeOff || perms.availability.manageOthersTimeOff
      : perms.availability.manageOthersTimeOff;
    if (!allowed) {
      return res.status(403).json({
        error: "forbidden",
        message: onlyMyself
          ? "Vous n'êtes pas autorisé à poser vos propres congés."
          : "Vous n'êtes pas autorisé à poser des congés pour l'équipe.",
      });
    }

    // ⚠️ Minuit UTC, PAS minuit local. Le calcul des créneaux compare les dates
    // via toISOString() ; stocker minuit local décalerait le congé d'un jour
    // dès que le serveur n'est pas sur UTC (ex: UTC+2 l'été → le 29 devient le
    // 28). `new Date("YYYY-MM-DD")` parse justement en UTC.
    const entry = {
      date: new Date(date),
      dayOff: closed,
      workingHours: ranges.map((r) => ({ start: r.start, end: r.end })),
      employees,
    };

    const doc = await DaysOff.findOneAndUpdate(
      { company: companyId },
      { $push: { dates: entry } },
      { upsert: true, new: true },
    ).lean();

    const created = doc.dates[doc.dates.length - 1];
    res.status(201).json({
      timeOff: {
        id: String(created._id),
        date,
        closed,
        ranges: entry.workingHours,
        employeeIds: employees,
        appliesToAll: !employees.length,
      },
    });
  } catch (err) {
    console.error("[mobile timeoff add]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// DELETE /api/v1/timeoff/:dateId
exports.removeTimeOff = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const dateId = req.params.dateId;
    if (!OBJECT_ID.test(dateId)) {
      return res.status(400).json({ error: "invalid_id", message: "Identifiant invalide." });
    }

    const doc = await DaysOff.findOne({ company: companyId }).lean();
    const target = (doc?.dates || []).find((d) => String(d._id) === dateId);
    if (!target) return res.status(404).json({ error: "not_found", message: "Congé introuvable." });

    // Même règle de permission qu'à la création.
    const me = String(req.mobileUser._id);
    const emps = (target.employees || []).map((e) => String(e));
    const onlyMyself = emps.length === 1 && emps[0] === me;
    const perms = req.companyCtx.permissions;
    const allowed = onlyMyself
      ? perms.availability.manageOwnTimeOff || perms.availability.manageOthersTimeOff
      : perms.availability.manageOthersTimeOff;
    if (!allowed) {
      return res.status(403).json({ error: "forbidden", message: "Vous n'êtes pas autorisé à retirer ce congé." });
    }

    await DaysOff.updateOne({ company: companyId }, { $pull: { dates: { _id: dateId } } });
    res.json({ ok: true, id: dateId });
  } catch (err) {
    console.error("[mobile timeoff remove]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
