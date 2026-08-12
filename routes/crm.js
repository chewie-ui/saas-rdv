/**
 * Export en lecture seule pour le CRM (~/Documents/crm).
 *
 * Le CRM vient chercher ici la liste des pros et l'état de leur abonnement,
 * une fois par jour, pour tenir à jour ses fiches clients et son revenu
 * récurrent. Rien n'est écrit : cette route ne fait que lire.
 *
 * Montée AVANT la session, comme l'API mobile : elle est sans état, ne pose
 * aucun cookie et n'a pas à traverser Passport.
 *
 * Sécurité :
 *  • l'en-tête `x-crm-secret` doit correspondre à CRM_SYNC_SECRET ;
 *  • sans variable d'environnement, la route répond 404 — elle n'existe pas ;
 *  • comparaison à temps constant, pour ne pas laisser deviner le secret ;
 *  • aucun mot de passe, aucun jeton, aucune donnée de rendez-vous ne sort.
 */
const crypto = require("crypto");
const router = require("express").Router();

const User = require("../db/models/user.model");
const Companies = require("../db/models/company/company.model");
const { getCompanyPlan } = require("../utils/planLimits");
const { revenuMensuel, FORFAITS } = require("../utils/tarifs");

const SECRET = process.env.CRM_SYNC_SECRET || "";

function secretValide(fourni) {
  if (!SECRET || !fourni) return false;
  const a = Buffer.from(String(fourni));
  const b = Buffer.from(SECRET);
  // `timingSafeEqual` exige des longueurs égales : on compare d'abord un
  // condensé, ce qui égalise la taille sans révéler celle du secret.
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

router.get("/api/crm/abonnes", async (req, res) => {
  if (!SECRET) return res.status(404).end();
  if (!secretValide(req.get("x-crm-secret"))) return res.status(403).json({ erreur: "Secret invalide" });

  try {
    const pros = await User.find({ accountIntent: "pro" })
      .select("_id fullName email phone businessName city country createdAt subscription addons manualPremium manualPremiumExpiry")
      .lean();

    const ids = pros.map((p) => p._id);
    const etablissements = await Companies.find({ owner: { $in: ids }, isDeleted: { $ne: true } })
      .select("_id owner name slug plan planStatus stripeSubscriptionId grantExpiry createdAt")
      .lean();

    const parOwner = new Map();
    for (const c of etablissements) {
      const cle = String(c.owner);
      if (!parOwner.has(cle)) parOwner.set(cle, []);
      parOwner.get(cle).push(c);
    }

    const maintenant = new Date();
    const sortie = pros.map((p) => {
      const siens = parOwner.get(String(p._id)) || [];

      const lignes = siens.map((c) => {
        // `getCompanyPlan` applique la règle métier complète, échéance d'octroi
        // comprise : un accès offert expiré retombe en « basic ».
        const planEffectif = getCompanyPlan(c, p);
        const offert = !!(c.grantExpiry && new Date(c.grantExpiry) > maintenant);
        return {
          id: String(c._id),
          nom: c.name || p.businessName || "",
          slug: c.slug || "",
          plan: planEffectif,
          planDeclare: c.plan || "",
          statut: c.planStatus || "",
          offert,
          offertJusquau: c.grantExpiry || null,
          paye: !!c.stripeSubscriptionId && !offert,
          creeLe: c.createdAt || null,
          revenuMensuel: revenuMensuel({
            plan: planEffectif,
            offert,
            addons: p.addons || {},
          }),
        };
      });

      return {
        id: String(p._id),
        nom: p.fullName || "",
        entreprise: p.businessName || "",
        email: p.email || "",
        telephone: p.phone || "",
        ville: p.city || "",
        pays: p.country || "",
        inscritLe: p.createdAt || null,
        etablissements: lignes,
        revenuMensuel: lignes.reduce((a, l) => a + l.revenuMensuel, 0),
      };
    });

    res.json({
      genereLe: new Date().toISOString(),
      tarifs: FORFAITS,
      nb: sortie.length,
      mrr: sortie.reduce((a, p) => a + p.revenuMensuel, 0),
      pros: sortie,
    });
  } catch (e) {
    console.error("[crm] export abonnés :", e.message);
    res.status(500).json({ erreur: "Export indisponible" });
  }
});

module.exports = router;
