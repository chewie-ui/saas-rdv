const Service = require("../db/models/company/service.model");
const Booking = require("../db/models/book.model");

/**
 * Calcule l'état d'onboarding d'un compte pro : les 4 étapes clés de mise en
 * route, combien sont faites, le pourcentage et si tout est terminé.
 *
 * Étapes (dans l'ordre logique de démarrage) :
 *   1. service   — au moins un service créé (indispensable pour réserver)
 *   2. logo      — un logo / une photo d'établissement ajouté
 *   3. link      — le lien public de réservation a été partagé (flag posé au clic)
 *   4. booking   — au moins une vraie réservation reçue (le moment « aha »)
 *
 * Les étapes 1/2/4 sont recalculées en direct depuis la base ; l'étape 3
 * s'appuie sur le flag `user.onboarding.linkShared`. Toujours non bloquant :
 * en cas d'erreur DB on renvoie un état « inconnu » qui masque le widget.
 *
 * @param {Object} user            document User (l'owner)
 * @param {Object} company         document Company courant (pour le slug)
 * @returns {Promise<Object|null>} { steps, doneCount, total, percent, complete, dismissed, bookingUrl } ou null
 */
async function getOnboardingStatus(user, company) {
  if (!user || !company) return null;

  const companyId = company._id || company.id;
  if (!companyId) return null;

  let serviceCount = 0;
  let bookingCount = 0;
  try {
    [serviceCount, bookingCount] = await Promise.all([
      Service.countDocuments({ company: companyId }),
      // Vraies réservations client uniquement (on exclut les blocs d'agenda)
      Booking.countDocuments({ company: companyId, isBlock: { $ne: true } }),
    ]);
  } catch (err) {
    console.error("[onboardingStatus] Erreur lecture DB ❌", err);
    return null;
  }

  const hasService = serviceCount > 0;
  const hasLogo = Boolean((user.businessPicture || "").trim());
  const linkShared = Boolean(user.onboarding && user.onboarding.linkShared);
  const hasBooking = bookingCount > 0;

  const bookingUrl = "branshee.com/" + (company.slug || String(companyId));

  const steps = [
    {
      key: "service",
      done: hasService,
      title: "Créez votre premier service",
      desc: "Ce que vos clients pourront réserver (coupe, séance, consultation…).",
      cta: "Ajouter un service",
      href: "/services",
      icon: "content_cut",
    },
    {
      key: "logo",
      done: hasLogo,
      title: "Ajoutez votre logo",
      desc: "Votre page de réservation prend tout de suite un air pro.",
      cta: "Ajouter mon logo",
      href: "/customize-calendar",
      icon: "add_photo_alternate",
    },
    {
      key: "link",
      done: linkShared,
      title: "Partagez votre lien de réservation",
      desc: "Envoyez-le à vos clients, mettez-le en bio Instagram, sur Google…",
      cta: "Voir mon lien",
      href: "/customize-calendar",
      icon: "share",
    },
    {
      key: "booking",
      done: hasBooking,
      title: "Recevez votre première réservation",
      desc: "Dès qu'un client réserve, elle apparaît ici automatiquement.",
      cta: "Voir le calendrier",
      href: "/appointment",
      icon: "event_available",
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const percent = Math.round((doneCount / total) * 100);

  return {
    steps,
    doneCount,
    total,
    percent,
    complete: doneCount === total,
    dismissed: Boolean(user.onboarding && user.onboarding.dismissed),
    bookingUrl,
  };
}

module.exports = { getOnboardingStatus };
