const router  = require("express").Router();
const crypto  = require("crypto");
const rateLimit = require("express-rate-limit");
const Review  = require("../db/models/review.model");
const ReviewReport = require("../db/models/review-report.model");
const Client  = require("../db/models/client.model");
const Company = require("../db/models/company/company.model");

// Motifs proposés à l'utilisateur (doivent rester alignés sur l'enum du modèle).
const MOTIFS = ["insulting", "false", "spam", "personal", "other"];

// Le signalement est ouvert aux visiteurs non connectés : sans garde-fou, un
// robot pourrait en générer des milliers. 10 signalements par heure et par IP.
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de signalements envoyés. Réessayez plus tard." },
});

// ── Middleware : reviewer connecté (compte unifié User OU ancien compte Client)
// Résout `req.reviewer` = { id, name, picture } quelle que soit la source, pour
// que les comptes unifiés (req.user) puissent aussi laisser/supprimer un avis.
async function requireReviewer(req, res, next) {
  try {
    if (req.user) {
      req.reviewer = {
        id:      req.user._id,
        name:    req.user.fullName || "Anonyme",
        picture: req.user.profilePicture || "/images/no-user.webp",
      };
      return next();
    }
    if (req.session && req.session.clientId) {
      const client = await Client.findById(req.session.clientId).lean();
      if (!client) return res.status(401).json({ error: "Session invalide." });
      req.reviewer = {
        id:      client._id,
        name:    client.fullName || "Anonyme",
        picture: client.profilePicture || "/images/no-user.webp",
      };
      return next();
    }
    return res.status(401).json({ error: "Vous devez être connecté pour laisser un avis." });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur." });
  }
}

// ── POST /reviews/:companyId  — soumettre un avis ─────────────────────────────
router.post("/:companyId", requireReviewer, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { rating, comment } = req.body;

    const r = Number(rating);
    if (!r || r < 1 || r > 5) {
      return res.status(400).json({ error: "Note invalide (1 à 5)." });
    }

    // Vérifier que la company existe
    const company = await Company.findById(companyId).lean();
    if (!company) return res.status(404).json({ error: "Établissement introuvable." });

    // Le propriétaire ne peut pas s'auto-évaluer
    if (String(company.owner) === String(req.reviewer.id)) {
      return res.status(403).json({ error: "Vous ne pouvez pas laisser un avis sur votre propre établissement." });
    }

    // Vérifier doublon
    const existing = await Review.findOne({ company: companyId, client: req.reviewer.id });
    if (existing) {
      return res.status(409).json({ error: "Vous avez déjà laissé un avis pour cet établissement." });
    }

    const review = await Review.create({
      company:       companyId,
      client:        req.reviewer.id,
      clientName:    req.reviewer.name,
      clientPicture: req.reviewer.picture,
      rating:        r,
      comment:       (comment || "").trim().slice(0, 800),
    });

    return res.json({ success: true, review });
  } catch (err) {
    console.error("POST /reviews error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
});

// ── DELETE /reviews/:companyId/:reviewId  — supprimer son avis ────────────────
router.delete("/:companyId/:reviewId", requireReviewer, async (req, res) => {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review) return res.status(404).json({ error: "Avis introuvable." });
    if (String(review.client) !== String(req.reviewer.id)) {
      return res.status(403).json({ error: "Accès refusé." });
    }
    await review.deleteOne();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur." });
  }
});

// ── POST /reviews/:companyId/:reviewId/report — signaler un avis ─────────────
// Ouvert à tous (visiteur non connecté compris) : un avis insultant doit
// pouvoir être remonté par n'importe qui, pas seulement par le professionnel.
// Personne ne supprime directement — le superadmin tranche.
router.post("/:companyId/:reviewId/report", reportLimiter, async (req, res) => {
  try {
    const { companyId, reviewId } = req.params;
    const { reason, message } = req.body;

    if (!MOTIFS.includes(reason)) {
      return res.status(400).json({ error: "Motif invalide." });
    }

    const review = await Review.findOne({ _id: reviewId, company: companyId }).lean();
    if (!review) return res.status(404).json({ error: "Avis introuvable." });

    const company = await Company.findById(companyId).select("owner").lean();
    if (!company) return res.status(404).json({ error: "Établissement introuvable." });

    // Qui signale ?
    let kind = "visitor";
    let id = null;
    let name = "Visiteur";
    if (req.user) {
      id = req.user._id;
      name = req.user.fullName || "Utilisateur";
      kind = String(company.owner) === String(req.user._id) ? "owner" : "user";
    } else if (req.session && req.session.clientId) {
      const client = await Client.findById(req.session.clientId).select("fullName").lean();
      id = req.session.clientId;
      name = (client && client.fullName) || "Client";
      kind = "user";
    }

    // Empreinte : identifiant du compte, sinon IP + navigateur. Sert à empêcher
    // qu'une même personne signale dix fois le même avis pour faire nombre.
    const empreinte = id
      ? "u:" + String(id)
      : "v:" + crypto
          .createHash("sha256")
          .update(String(req.ip || "") + "|" + String(req.get("user-agent") || ""))
          .digest("hex")
          .slice(0, 32);

    const deja = await ReviewReport.findOne({ review: reviewId, reporterFingerprint: empreinte }).lean();
    if (deja) {
      return res.status(409).json({ error: "Vous avez déjà signalé cet avis. Il est en cours d'examen." });
    }

    await ReviewReport.create({
      review: reviewId,
      company: companyId,
      reporterKind: kind,
      reporterId: id,
      reporterName: name,
      reporterFingerprint: empreinte,
      reason,
      message: (message || "").trim().slice(0, 1000),
      snapshot: {
        clientName: review.clientName,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
      },
    });

    return res.json({
      success: true,
      message:
        kind === "owner"
          ? "Votre demande de suppression a été transmise. Elle sera examinée sous peu."
          : "Merci, ce signalement a été transmis à notre équipe.",
    });
  } catch (err) {
    // L'index unique peut lever une 11000 en cas de double envoi simultané.
    if (err && err.code === 11000) {
      return res.status(409).json({ error: "Vous avez déjà signalé cet avis." });
    }
    console.error("POST /reviews report error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
});

module.exports = router;
