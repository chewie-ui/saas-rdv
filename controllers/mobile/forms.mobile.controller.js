// ── API mobile : formulaire de pré-réservation ────────────────────────────
//   GET /forms   le formulaire de l'établissement (état + questions)
//   PUT /forms   enregistrer le formulaire complet (activation + questions)
//
// Réplique la logique du web (controllers/admin.controller.js → formsIndex /
// saveForm) : un seul formulaire par établissement (upsert), et la limite du
// forfait sur le nombre de questions appliquée côté serveur.
const Form = require("../../db/models/form.model");
const { getLimit } = require("../../utils/planLimits");
const { logActivity } = require("../../utils/activityLog");

// Types tels que stockés en base (db/models/form.model.js).
const TYPES = ["text", "yes_no", "choice"];

function serialize(form, maxQuestions) {
  return {
    active: !!(form && form.active),
    questions: (form && Array.isArray(form.questions) ? form.questions : [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((q, i) => ({
        id: String(q._id || i),
        label: q.label || "",
        type: TYPES.includes(q.type) ? q.type : "text",
        required: !!q.required,
        options: Array.isArray(q.options) ? q.options : [],
        order: i,
      })),
    maxQuestions: Number.isFinite(maxQuestions) ? maxQuestions : 0,
  };
}

// Normalise et valide les questions envoyées par l'app.
// Renvoie { error } (message destiné à l'utilisateur) ou { questions }.
function buildQuestions(input) {
  if (!Array.isArray(input)) return { error: "La liste des questions est invalide." };

  const questions = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i] || {};
    const label = String(raw.label || "").trim();
    if (!label) return { error: `La question n°${i + 1} n'a pas d'intitulé.` };
    if (label.length > 300) return { error: `L'intitulé de la question n°${i + 1} est trop long.` };

    const type = TYPES.includes(raw.type) ? raw.type : "text";

    // Les options n'ont de sens que pour un choix multiple — comme sur le web,
    // on les vide pour les autres types.
    let options = [];
    if (type === "choice") {
      options = (Array.isArray(raw.options) ? raw.options : [])
        .map((o) => String(o || "").trim())
        .filter(Boolean)
        .slice(0, 20);
      if (options.length < 2) {
        return { error: `La question « ${label} » doit proposer au moins deux options.` };
      }
    }

    questions.push({ label, type, required: !!raw.required, options, order: i });
  }
  return { questions };
}

// GET /api/v1/forms
exports.get = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const maxQuestions = getLimit("formQuestions", req.companyCtx.billingUser);
    const form = await Form.findOne({ company: companyId }).lean();

    res.json({ form: serialize(form, maxQuestions) });
  } catch (err) {
    console.error("[mobile forms get]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// PUT /api/v1/forms
exports.save = async (req, res) => {
  try {
    const companyId = req.companyCtx.currentCompany._id;
    const maxQuestions = getLimit("formQuestions", req.companyCtx.billingUser);

    if (!maxQuestions) {
      return res.status(403).json({
        error: "plan_limit",
        message: "Votre forfait ne permet pas d'utiliser le formulaire de pré-réservation.",
      });
    }

    const built = buildQuestions(req.body.questions);
    if (built.error) return res.status(400).json({ error: "invalid_input", message: built.error });

    // Le web tronque silencieusement ; ici on refuse explicitement pour que
    // l'app puisse expliquer la limite au lieu de perdre des questions.
    if (built.questions.length > maxQuestions) {
      return res.status(403).json({
        error: "plan_limit",
        message: `Votre forfait permet ${maxQuestions} question${maxQuestions > 1 ? "s" : ""} au maximum. Passez à un forfait supérieur pour en ajouter.`,
      });
    }

    const active = !!req.body.active;
    const form = await Form.findOneAndUpdate(
      { company: companyId },
      { active, questions: built.questions },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    logActivity({
      company: companyId,
      user: req.mobileUser,
      role: req.companyCtx.role,
      action: "form.update",
      description: `a enregistré le formulaire de pré-réservation (${built.questions.length} question${built.questions.length > 1 ? "s" : ""}, ${active ? "activé" : "désactivé"})`,
    });

    res.json({ form: serialize(form, maxQuestions) });
  } catch (err) {
    console.error("[mobile forms save]", err);
    res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
