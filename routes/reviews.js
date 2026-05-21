const router  = require("express").Router();
const Review  = require("../db/models/review.model");
const Client  = require("../db/models/client.model");
const Company = require("../db/models/company/company.model");

// ── Middleware : client connecté ──────────────────────────────────────────────
function requireClient(req, res, next) {
  if (!req.session || !req.session.clientId) {
    return res.status(401).json({ error: "Vous devez être connecté pour laisser un avis." });
  }
  next();
}

// ── POST /reviews/:companyId  — soumettre un avis ─────────────────────────────
router.post("/:companyId", requireClient, async (req, res) => {
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

    // Récupérer le client
    const client = await Client.findById(req.session.clientId).lean();
    if (!client) return res.status(401).json({ error: "Session invalide." });

    // Vérifier doublon
    const existing = await Review.findOne({ company: companyId, client: client._id });
    if (existing) {
      return res.status(409).json({ error: "Vous avez déjà laissé un avis pour cet établissement." });
    }

    const review = await Review.create({
      company:       companyId,
      client:        client._id,
      clientName:    client.fullName || "Anonyme",
      clientPicture: client.profilePicture || "/images/no-user.webp",
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
router.delete("/:companyId/:reviewId", requireClient, async (req, res) => {
  try {
    const review = await Review.findById(req.params.reviewId);
    if (!review) return res.status(404).json({ error: "Avis introuvable." });
    if (String(review.client) !== String(req.session.clientId)) {
      return res.status(403).json({ error: "Accès refusé." });
    }
    await review.deleteOne();
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur." });
  }
});

module.exports = router;
