const Service = require("../db/models/company/service.model");
const Company = require("../db/models/company/company.model");
const User = require("../db/models/user.model");
const { getLimit } = require("../utils/planLimits");
const { nextAvailableColor } = require("../utils/serviceColors");
const { logActivity } = require("../utils/activityLog");
const fs = require("fs");
const path = require("path");

const UPLOADS_DIR = path.join(__dirname, "..", "public", "uploads", "profiles");

// ── Frais d'annulation/no-show personnalisés (par service) ────────────────────
function sanitizeCancellationFee(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const enabled = !!raw.enabled;
  const type = raw.type === "amount" ? "amount" : "percent";
  let value = raw.value !== undefined && raw.value !== "" ? Number(raw.value) : null;
  if (value !== null && !Number.isFinite(value)) value = null;
  if (value !== null) {
    value = type === "percent" ? Math.max(0, Math.min(100, value)) : Math.max(0, value);
  }
  return { enabled: enabled && value !== null, type, value };
}

// ── Réponse de la "question préalable" pour laquelle ce service est
// proposé — "all" = visible pour tout le monde. ─────────────────────────────
function sanitizeAnswerVisibility(raw) {
  return ["new", "existing"].includes(raw) ? raw : "all";
}

// ── Ciblage par question (« Afficher ce service pour… ») ──────────────────────
// Règles : [{ questionId, optionIds:[…] }]. Une question absente = « Tous »
// (aucune restriction). On ne valide que le format (ObjectId hex 24) + tailles ;
// le tunnel public applique un ET entre les questions présentes.
const OID_RE = /^[a-f0-9]{24}$/i;
function sanitizeQuestionRules(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw.slice(0, 20)) {
    if (!r || !OID_RE.test(String(r.questionId || ""))) continue;
    const opts = Array.isArray(r.optionIds)
      ? [...new Set(r.optionIds.map(String).filter((o) => OID_RE.test(o)))].slice(0, 30)
      : [];
    if (opts.length === 0) continue; // 0 option sélectionnée = « Tous » → pas de règle
    out.push({ questionId: r.questionId, optionIds: opts });
  }
  return out;
}

// ── Durée approximative ("30-40 min") — borne haute optionnelle, doit
// toujours être strictement supérieure à la durée de base. ──────────────────
function sanitizeDurationMax(baseDuration, raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const max = Number(raw);
  if (!Number.isFinite(max) || max <= baseDuration) return null;
  return max;
}

// ── Page admin ────────────────────────────────────────────────────────────────
exports.servicesPage = async (req, res) => {
  const [services, companyDoc] = await Promise.all([
    Service.find({ company: res.locals.currentCompany._id })
      .populate("employees", "fullName profilePicture")
      .sort("order")
      .lean(),
    Company.findById(res.locals.currentCompany._id).select("bookingQuestion").lean(),
  ]);

  // ── Rattrapage : services sans couleur (créés avant cette fonctionnalité,
  // ou via un autre chemin) — sans ça, ils retombent tous sur LE MÊME vert
  // par défaut à l'affichage (`svc.color || '#1e7a4e'`), donnant l'impression
  // que plusieurs services partagent une couleur alors qu'aucune n'est
  // réellement assignée. On leur attribue une vraie couleur unique ici, une
  // fois pour toutes (persisté, pas juste à l'affichage). ───────────────────
  const missingColor = services.filter((s) => !s.color);
  if (missingColor.length > 0) {
    const usedColors = services.map((s) => s.color).filter(Boolean);
    for (const s of missingColor) {
      const newColor = nextAvailableColor(usedColors);
      usedColors.push(newColor);
      s.color = newColor;
      await Service.updateOne({ _id: s._id }, { $set: { color: newColor } });
    }
  }

  const maxServices = getLimit("services", res.locals.billingUser);
  // Catégories portées par l'ÉTABLISSEMENT et non par le compte : deux
  // établissements d'un même patron ne partagent rien.
  const _co = res.locals.currentCompany || {};
  const categories  = _co.categories || [];
  const bookingCategoryStyle = _co.bookingCategoryStyle || "pills";
  res.render("admin/services-old", {
    pageName: "ServicesOld",
    title: "Services",
    services,
    maxServices,
    categories,
    bookingCategoryStyle,
    bookingQuestion: companyDoc?.bookingQuestion || {
      enabled: false,
      question: "Est-ce la première fois que vous nous consultez ?",
      newLabel: "Oui, je suis nouveau",
      existingLabel: "Non, j'ai déjà consulté",
    },
  });
};

// ── Services (page principale) ────────────────────────────────────────────────
// Nouvelle mise en page (barre d'outils + tableau + questionnaire), servie sur
// /services. L'ancienne page reste accessible sur /services-old (servicesPage).
exports.servicesV2 = async (req, res) => {
  const { getBookableTeam } = require("../utils/bookableTeam");
  const [services, companyDoc, employees] = await Promise.all([
    Service.find({ company: res.locals.currentCompany._id })
      .populate("employees", "fullName profilePicture")
      .sort("order")
      .lean(),
    Company.findById(res.locals.currentCompany._id)
      .select("serviceQuestionnaire bookingQuestion")
      .lean(),
    getBookableTeam(res.locals.currentCompany._id),
  ]);

  // Questionnaire à afficher dans le constructeur. Si la nouvelle version n'a
  // pas encore de questions mais que l'ancienne question (oui/non) était active,
  // on la présente convertie (sans _id) pour que l'admin la retrouve et puisse
  // l'enregistrer dans le nouveau format. La vraie migration des règles par
  // service se fait à l'étape suivante.
  let questionnaire = companyDoc?.serviceQuestionnaire || { enabled: false, questions: [] };
  if ((!questionnaire.questions || questionnaire.questions.length === 0) && companyDoc?.bookingQuestion?.enabled) {
    const bq = companyDoc.bookingQuestion;
    questionnaire = {
      enabled: true,
      questions: [{
        question: bq.question || "Est-ce la première fois que vous nous consultez ?",
        options: [
          { label: bq.newLabel || "Oui, je suis nouveau" },
          { label: bq.existingLabel || "Non, j'ai déjà consulté" },
        ],
      }],
    };
  }

  const maxServices = getLimit("services", res.locals.billingUser);

  // Catégories (avec emoji) du sélecteur de la modale. Portées par
  // l'ÉTABLISSEMENT : un patron avec deux établissements ne doit pas voir les
  // catégories de l'un apparaître dans l'autre.
  const categories = (res.locals.currentCompany && res.locals.currentCompany.categories) || [];
  // Couleurs déjà prises par chaque service — pour la palette (« déjà utilisée »).
  const serviceColors = services.map((s) => ({ id: String(s._id), color: s.color || "" }));

  res.render("admin/services", {
    pageName: "Services",
    title: "Services",
    services,
    questionnaire,
    maxServices,
    categories,
    serviceColors,
    // Équipe réservable — pour l'assignation d'employés aux cours collectifs.
    employees,
    // Colonnes masquées par l'utilisateur (préférence persistée) — le tableau
    // s'affiche déjà dans le bon état, sans attendre le JS.
    hiddenCols: (req.user && req.user.uiPrefs && Array.isArray(req.user.uiPrefs.servicesHiddenCols))
      ? req.user.uiPrefs.servicesHiddenCols
      : [],
  });
};

// ── API : ordre des services (glisser-déposer) ────────────────────────────────
// Le client envoie la liste ORDONNÉE des services tels qu'affichés :
// [{ id, category }]. On écrit `order` = index dans cette liste, et on met à
// jour `category` quand un service a été déposé dans un autre groupe.
// Le filtre inclut toujours `company` : impossible de toucher les services d'un
// autre établissement, même en falsifiant les identifiants.
exports.reorderServices = async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, error: "items manquant" });
    }
    const companyId = res.locals.currentCompany._id;
    const ops = items
      .filter((it) => it && it.id)
      .map((it, idx) => {
        const set = { order: idx };
        if (typeof it.category === "string") set.category = it.category;
        return {
          updateOne: {
            filter: { _id: it.id, company: companyId },
            update: { $set: set },
          },
        };
      });
    if (ops.length) await Service.bulkWrite(ops);
    return res.json({ success: true, count: ops.length });
  } catch (err) {
    console.error("reorderServices:", err.message);
    return res.status(500).json({ success: false });
  }
};

// ── API : enregistrer les colonnes masquées du tableau des services ───────────
// Préférence purement personnelle (par utilisateur), sans impact sur les données
// métier — on ne valide donc que le format (liste de clés connues).
exports.updateServicesColumns = async (req, res) => {
  try {
    const ALLOWED = ["type", "emp", "dur", "price", "status"];
    const hidden = Array.isArray(req.body.hidden)
      ? [...new Set(req.body.hidden.filter((c) => ALLOWED.includes(c)))]
      : [];
    await User.updateOne({ _id: req.user._id }, { $set: { "uiPrefs.servicesHiddenCols": hidden } });
    return res.json({ success: true, hidden });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Une erreur est survenue." });
  }
};

// ── API : enregistrer le questionnaire de réservation (multi-questions) ───────
exports.updateQuestionnaire = async (req, res) => {
  try {
    const { enabled, questions } = req.body;
    const clean = (Array.isArray(questions) ? questions : []).slice(0, 10).map((q) => {
      const opts = (Array.isArray(q.options) ? q.options : [])
        .slice(0, 12)
        .map((o) => {
          const label = String(o && o.label || "").trim().slice(0, 80);
          const opt = { label };
          if (o && o._id && /^[a-f0-9]{24}$/i.test(String(o._id))) opt._id = o._id;
          return opt;
        })
        .filter((o) => o.label);
      const question = { question: String(q && q.question || "").trim().slice(0, 200), options: opts };
      if (q && q._id && /^[a-f0-9]{24}$/i.test(String(q._id))) question._id = q._id;
      return question;
    }).filter((q) => q.question && q.options.length);

    const company = await Company.findById(res.locals.currentCompany._id);
    if (!company) return res.status(404).json({ error: "Établissement introuvable." });
    company.serviceQuestionnaire = { enabled: !!enabled, questions: clean };
    await company.save(); // génère les _id manquants (nouvelles questions/réponses)

    res.json({ success: true, questionnaire: company.serviceQuestionnaire.toObject() });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : question préalable au choix du service ──────────────────────────────
exports.updateBookingQuestion = async (req, res) => {
  try {
    const { enabled, question, newLabel, existingLabel } = req.body;
    const update = {};
    if (enabled !== undefined) update["bookingQuestion.enabled"] = !!enabled;
    if (question !== undefined) update["bookingQuestion.question"] = String(question).trim().slice(0, 200);
    if (newLabel !== undefined) update["bookingQuestion.newLabel"] = String(newLabel).trim().slice(0, 80);
    if (existingLabel !== undefined) update["bookingQuestion.existingLabel"] = String(existingLabel).trim().slice(0, 80);
    await Company.findByIdAndUpdate(res.locals.currentCompany._id, { $set: update });
    return res.json({ success: true, ...update });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ── API : liste des services (public + admin) ─────────────────────────────────
exports.getServices = async (req, res) => {
  try {
    const { companyId, publicOnly } = req.query;
    const query = { company: companyId };
    if (publicOnly === "1") query.active = true;

    const services = await Service.find(query)
      .populate("employees", "fullName profilePicture")
      .sort("order")
      .lean();
    res.json({ success: true, services });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : créer un service ────────────────────────────────────────────────────
exports.createService = async (req, res) => {
  try {
    const companyId = res.locals.currentCompany._id;
    const maxServices = getLimit("services", res.locals.billingUser);

    if (maxServices === 0) {
      return res.status(403).json({ error: "plan_limit", message: "Votre plan ne permet pas de créer des services." });
    }

    const count = await Service.countDocuments({ company: companyId });

    if (count >= maxServices) {
      return res.status(403).json({ error: "plan_limit", message: `Limite de ${maxServices} services atteinte.` });
    }

    const { name, description, price, duration, durationMax, category, type, capacity, color, cancellationFee, answerVisibility, questionRules, active } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Le nom du service est requis." });
    }

    const baseDuration = duration ? Number(duration) : 30;

    const isGroup = type === "group";
    const cap = isGroup ? Math.max(1, Math.min(500, Number(capacity) || 1)) : null;

    const existingColors = (await Service.find({ company: companyId }).select("color").lean())
      .map((s) => s.color).filter(Boolean);

    let resolvedColor;
    // Couleur validée hexadécimale (#rrggbb) — évite toute injection CSS via le
    // style inline `background:${svc.color}` côté admin.
    if (color && /^#[0-9a-f]{6}$/i.test(color)) {
      if (existingColors.some((c) => c.toLowerCase() === color.toLowerCase())) {
        return res.status(400).json({ error: "color_taken", message: "Cette couleur est déjà utilisée par un autre service." });
      }
      resolvedColor = color;
    } else {
      resolvedColor = nextAvailableColor(existingColors);
    }

    const service = await Service.create({
      company: companyId,
      name: name.trim(),
      description: (description || "").trim(),
      price: price !== undefined && price !== "" ? Number(price) : null,
      duration: baseDuration,
      durationMax: sanitizeDurationMax(baseDuration, durationMax),
      category: (category || "").trim(),
      order: count,
      type: isGroup ? "group" : "individual",
      capacity: cap,
      color: resolvedColor,
      cancellationFee: sanitizeCancellationFee(cancellationFee),
      answerVisibility: sanitizeAnswerVisibility(answerVisibility),
      questionRules: sanitizeQuestionRules(questionRules),
      active: active === undefined ? true : !!active,
    });
    logActivity({
      company: companyId,
      user: req.user,
      role: res.locals.membershipRole,
      action: "service.create",
      description: `a créé le service "${service.name}"`,
    });
    res.json({ success: true, service });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : modifier un service ─────────────────────────────────────────────────
exports.updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, duration, durationMax, category, type, capacity, color, cancellationFee, answerVisibility, questionRules, active } = req.body;
    const update = {};
    if (active !== undefined) update.active = !!active;
    if (name !== undefined) update.name = name.trim();
    if (description !== undefined) update.description = description.trim();
    if (price !== undefined) update.price = price !== "" ? Number(price) : null;
    if (duration !== undefined) update.duration = Number(duration);
    if (durationMax !== undefined) {
      const baseDuration = duration !== undefined
        ? Number(duration)
        : (await Service.findOne({ _id: id, company: res.locals.currentCompany._id }).select("duration").lean())?.duration || 30;
      update.durationMax = sanitizeDurationMax(baseDuration, durationMax);
    }
    if (category !== undefined) update.category = category.trim();
    if (color !== undefined) {
      // Couleur validée hexadécimale (#rrggbb) — pas d'injection CSS possible.
      const validColor = color && /^#[0-9a-f]{6}$/i.test(color) ? color : null;
      if (validColor) {
        const existingColors = (await Service.find({ company: res.locals.currentCompany._id, _id: { $ne: id } }).select("color").lean())
          .map((s) => s.color).filter(Boolean);
        if (existingColors.some((c) => c.toLowerCase() === validColor.toLowerCase())) {
          return res.status(400).json({ error: "color_taken", message: "Cette couleur est déjà utilisée par un autre service." });
        }
      }
      update.color = validColor;
    }
    if (type !== undefined) {
      const isGroup = type === "group";
      update.type = isGroup ? "group" : "individual";
      update.capacity = isGroup ? Math.max(1, Math.min(500, Number(capacity) || 1)) : null;
    } else if (capacity !== undefined) {
      update.capacity = Math.max(1, Math.min(500, Number(capacity) || 1));
    }
    if (cancellationFee !== undefined) {
      update.cancellationFee = sanitizeCancellationFee(cancellationFee);
    }
    if (answerVisibility !== undefined) {
      update.answerVisibility = sanitizeAnswerVisibility(answerVisibility);
    }
    if (questionRules !== undefined) {
      update.questionRules = sanitizeQuestionRules(questionRules);
    }

    const service = await Service.findOneAndUpdate(
      { _id: id, company: res.locals.currentCompany._id },
      update,
      { new: true }
    ).populate("employees", "fullName profilePicture");

    if (!service) return res.status(404).json({ error: "Service non trouvé." });
    logActivity({
      company: res.locals.currentCompany._id,
      user: req.user,
      role: res.locals.membershipRole,
      action: "service.update",
      description: `a modifié le service "${service.name}"`,
    });
    res.json({ success: true, service });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : activer / désactiver TOUS les services ─────────────────────────────
exports.bulkToggleServices = async (req, res) => {
  try {
    const { active } = req.body;
    await Service.updateMany(
      { company: res.locals.currentCompany._id },
      { active: !!active }
    );
    res.json({ success: true, active: !!active });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : toggle actif/inactif ────────────────────────────────────────────────
exports.toggleService = async (req, res) => {
  try {
    const { id } = req.params;
    const service = await Service.findOne({ _id: id, company: res.locals.currentCompany._id });
    if (!service) return res.status(404).json({ error: "Service non trouvé." });
    service.active = !service.active;
    await service.save();
    res.json({ success: true, active: service.active });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : supprimer un service ────────────────────────────────────────────────
exports.deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Service.findOneAndDelete({ _id: id, company: res.locals.currentCompany._id });
    if (deleted) {
      logActivity({
        company: res.locals.currentCompany._id,
        user: req.user,
        role: res.locals.membershipRole,
        action: "service.delete",
        description: `a supprimé le service "${deleted.name}"`,
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : gérer les employés d'un service ────────────────────────────────────
exports.setServiceEmployees = async (req, res) => {
  try {
    const { id } = req.params;
    const { employees } = req.body; // array of user IDs
    const service = await Service.findOneAndUpdate(
      { _id: id, company: res.locals.currentCompany._id },
      { employees: employees || [] },
      { new: true }
    ).populate("employees", "fullName profilePicture");
    if (!service) return res.status(404).json({ error: "Service non trouvé." });
    res.json({ success: true, service });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : image d'un service ──────────────────────────────────────────────────
exports.updateServiceImage = async (req, res) => {
  try {
    if (!req.file || !req.file.filename) {
      return res.status(400).json({ error: "Aucune image reçue." });
    }
    const service = await Service.findOne({ _id: req.params.id, company: res.locals.currentCompany._id }).select("image").lean();
    if (!service) return res.status(404).json({ error: "Service non trouvé." });

    // Supprimer l'ancienne image si elle existe
    if (service.image) {
      const oldPath = path.join(UPLOADS_DIR, service.image);
      fs.unlink(oldPath, () => {});
    }

    const updated = await Service.findByIdAndUpdate(
      req.params.id,
      { image: req.file.filename },
      { new: true }
    ).lean();
    res.json({ success: true, image: updated.image });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
};

exports.deleteServiceImage = async (req, res) => {
  try {
    const service = await Service.findOne({ _id: req.params.id, company: res.locals.currentCompany._id }).select("image").lean();
    if (!service) return res.status(404).json({ error: "Service non trouvé." });

    if (service.image) {
      const filePath = path.join(UPLOADS_DIR, service.image);
      fs.unlink(filePath, () => {});
    }
    await Service.findByIdAndUpdate(req.params.id, { image: "" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};

// ── API : liste des employés de la company (pour la sélection dans un service) ─
exports.getCompanyEmployees = async (req, res) => {
  try {
    const { getBookableTeam } = require("../utils/bookableTeam");
    const employees = await getBookableTeam(res.locals.currentCompany._id);
    res.json({ success: true, employees });
  } catch (err) {
    res.status(500).json({ error: "Erreur serveur" });
  }
};
