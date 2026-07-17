const router  = require("express").Router();
const Review  = require("../db/models/review.model");
const Client  = require("../db/models/client.model");
const Company = require("../db/models/company/company.model");

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

module.exports = router;
