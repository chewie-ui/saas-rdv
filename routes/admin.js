const router = require("express").Router();
const { renderAppointments } = require("../controllers/booking.controller");
const {
  panel,
  appointment,
  availability,
  availabilityOld,
  toggleDay,
  editAvailabilty,
  editSlotTime,
  deleteBooking,
  cancelBooking,
  getWeekData,
  restoreBooking,
  informationsPage,
  historyInit,
  historyDeleteRow,
  historySearch,
  historyEditRow,
  settingsInit,
  historyEditRowPatch,
  historyCheckConflicts,
  paymentVerification,
  resumeSubscription,
  saveAdminNotes,
  updateBookingEmployee,
} = require("../controllers/admin.controller");

const adminController = require("../controllers/admin.controller");
const {
  listGroupSessions, getSessionParticipants,
  createCourse, updateCourse, toggleCourse, deleteCourse,
} = require("../controllers/groupSession.controller");
const clientDossierController = require("../controllers/clientDossier.controller");

const isAuth = require("../middlewares/isAuth");
const injectCompany = require("../middlewares/injectCompany");
const { requireFeatureActive, requireAdminFeature } = require("../middlewares/featureFlag");
const upload = require("../config/multer");
const { processSingleImage } = require("../middlewares/processImageUpload");
const { requirePermission, hasPermission } = require("../utils/permissions");

// toggleDay/editAvailabilty ciblent soit l'horaire commun (employeeId absent
// ou "shared" → availability.manageShared) soit l'horaire d'un employé
// précis (availability.manageOthersSchedule, ou manageOwnSchedule si c'est
// son propre horaire) — la permission dépend du body, donc pas un simple
// requirePermission(path) statique.
function requireScheduleEditPermission(req, res, next) {
  const employeeId = req.body.employeeId;
  const editingOwnSchedule = employeeId && employeeId !== "shared" && String(employeeId) === String(req.user._id);
  const allowed = editingOwnSchedule
    ? hasPermission(res, "availability.manageOwnSchedule")
    : (employeeId && employeeId !== "shared")
      ? hasPermission(res, "availability.manageOthersSchedule")
      : hasPermission(res, "availability.manageShared");
  if (!allowed) return res.status(403).json({ success: false, error: "forbidden" });
  next();
}

router.get("/appointement/:bookId", isAuth, (req, res) => res.redirect(`/history/edit/${req.params.bookId}`));

const isVerified = [isAuth, injectCompany];

// ── Checklist d'onboarding du dashboard (fetch depuis panel.pug) ──────────────
router.post("/onboarding/dismiss", isAuth, adminController.onboardingDismiss);
router.post("/onboarding/link-shared", isAuth, adminController.onboardingLinkShared);

// ── Onboarding de bienvenue ───────────────────────────────────────────────────
router.get("/welcome", isAuth, injectCompany, (req, res) => {
  res.render("admin/welcome", {
    pageName: "Welcome",
    title: "Bienvenue — BranShee",
  });
});

router.get("/panel", isAuth, injectCompany, requireFeatureActive("admin_panel"), renderAppointments, panel);
router.get("/appointment", isAuth, injectCompany, requireFeatureActive("admin_panel"), appointment);
router.post("/appointment/create", isAuth, injectCompany, requireFeatureActive("admin_panel"), adminController.createAdminBooking);
router.post("/appointment/block", isAuth, injectCompany, requireFeatureActive("admin_panel"), adminController.createAdminBlock);
router.patch("/appointment/block/:id", isAuth, injectCompany, requireFeatureActive("admin_panel"), adminController.updateAdminBlock);
router.get("/availability", isAuth, injectCompany, availability);
// Ancienne page conservée (au cas où) sur /availability-old.
router.get("/availability-old", isAuth, injectCompany, availabilityOld);
// Ancienne URL de la refonte → redirection permanente vers /availability.
router.get("/availability-v2", isAuth, injectCompany, (req, res) => res.redirect(301, "/availability"));
router.get("/group-sessions", isAuth, injectCompany, requireAdminFeature("group_sessions"), requirePermission("groupSessions.view"), listGroupSessions);
router.get("/group-sessions/participants", isAuth, injectCompany, requireAdminFeature("group_sessions"), requirePermission("groupSessions.view"), getSessionParticipants);
router.post("/api/courses", isAuth, injectCompany, requireAdminFeature("group_sessions"), requirePermission("groupSessions.manage"), createCourse);
router.patch("/api/courses/:id", isAuth, injectCompany, requireAdminFeature("group_sessions"), requirePermission("groupSessions.manage"), updateCourse);
router.patch("/api/courses/:id/toggle", isAuth, injectCompany, requireAdminFeature("group_sessions"), requirePermission("groupSessions.manage"), toggleCourse);
router.delete("/api/courses/:id", isAuth, injectCompany, requireAdminFeature("group_sessions"), requirePermission("groupSessions.manage"), deleteCourse);
router.get("/client", (req, res) => res.redirect("/clients"));

// ── Dossiers clients ────────────────────────────────────────────────────────
router.get("/clients", isAuth, injectCompany, requirePermission("clients.view"), clientDossierController.listClients);
router.post("/clients/create", isAuth, injectCompany, requirePermission("clients.manage"), clientDossierController.createClient);
router.get("/clients/:email", isAuth, injectCompany, requirePermission("clients.view"), clientDossierController.viewClient);
router.patch("/clients/dossier/:dossierId/general", isAuth, injectCompany, requirePermission("clients.manage"), clientDossierController.updateGeneralInfo);
router.post("/clients/dossier/:dossierId/entries", isAuth, injectCompany, requirePermission("clients.manage"), clientDossierController.addEntry);
router.patch("/clients/dossier/:dossierId/entries/:entryId", isAuth, injectCompany, requirePermission("clients.manage"), clientDossierController.updateEntry);
router.delete("/clients/dossier/:dossierId/entries/:entryId", isAuth, injectCompany, requirePermission("clients.manage"), clientDossierController.deleteEntry);
router.patch("/clients/booking/:bookingId/payment", isAuth, injectCompany, requirePermission("clients.manage"), clientDossierController.updateBookingPayment);
router.patch("/clients/dossier/:dossierId/block", isAuth, injectCompany, requirePermission("clients.manage"), clientDossierController.blockClient);
router.patch("/clients/dossier/:dossierId/unblock", isAuth, injectCompany, requirePermission("clients.manage"), clientDossierController.unblockClient);
router.get("/informations", (req, res) => res.redirect(301, "/settings"));
router.get("/subscription", isAuth, injectCompany, requireFeatureActive("subscription"), requirePermission("billing.manage"), async (req, res) => {
  let monthlyBookingCount = null;
  if (!res.locals.isPro && res.locals.currentCompany) {
    const Booking = require("../db/models/book.model");
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    monthlyBookingCount = await Booking.countDocuments({
      company: res.locals.currentCompany._id,
      date:    { $gte: startOfMonth },
      status:  { $ne: "canceled" },
    });
  }

  // Cartes déjà enregistrées → on les propose dans la boîte de confirmation
  // d'achat ("payer instant avec carte X ou changer de carte") au lieu de
  // débiter directement quand on clique sur "Acheter Business/Pro".
  const paymentMethods = await adminController.getUserPaymentMethods(req.user);

  // Offres mises en avant (isDefaultOffer=true) : elles s'appliquent
  // automatiquement, prix barré à l'appui. On ne garde donc que celles que CE
  // compte peut réellement obtenir — annoncer une remise que le serveur
  // refuserait ensuite au paiement, c'est un prix affiché mensonger.
  const PromoCode = require("../db/models/promoCode.model");
  const maintenant = new Date();
  const defaultOffers = (await PromoCode.find({ isDefaultOffer: true, active: true }).lean())
    .filter((o) => !o.expiresAt || new Date(o.expiresAt) > maintenant)
    .filter((o) => o.maxUses === null || o.maxUses === undefined || o.usedCount < o.maxUses)
    .filter((o) => !(o.usedByUsers || []).some((uid) => String(uid) === String(req.user._id)));

  // L'annuel Essentiel n'est proposé que si son prix existe vraiment dans
  // Stripe — sinon on afficherait une remise qu'on ne pourrait pas facturer.
  const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

  res.render("admin/subscription", {
    pageName: "Subscription",
    title: "Plans",
    monthlyBookingCount,
    paymentMethods,
    defaultOffers,
    essentielYearlyAvailable: !!env.stripePriceEssentielYearly,
    // Le mois offert n'est dû qu'une fois par compte : la boîte de
    // confirmation doit annoncer le vrai montant à quelqu'un qui l'a déjà
    // consommé, sinon on lui promet une gratuité que le serveur refusera.
    essaiGratuitDisponible: require("../utils/freeTrial").peutAvoirEssaiGratuit(req.user),
  });
});

// La page Paramètres mélange plusieurs zones (notifications/annulation =
// settings.manage, Stripe Connect = billing.manage, pause/suppression
// d'établissement = establishment.manage) — visible si au moins une est
// autorisée ; chaque action individuelle dessous reste gatée précisément.
function requireSettingsAccess(req, res, next) {
  // Compte sans établissement (client/undecided) : injectCompany ne pose
  // jamais `res.locals.permissions` dans ce cas, mais doit pouvoir atteindre
  // /settings pour créer son établissement (cf. injectCompany.js).
  if (
    !res.locals.currentCompany ||
    hasPermission(res, "settings.manage") ||
    hasPermission(res, "billing.manage") ||
    hasPermission(res, "establishment.manage")
  ) {
    return next();
  }
  return res.redirect("/appointment");
}

router.get("/settings", isVerified, requireSettingsAccess, settingsInit);
router.get("/history/edit/:id", isVerified, requirePermission("appointments.view"), historyEditRow);
router.get("/logs", isVerified, requirePermission("logs.view"), require("../controllers/logs.controller").logsInit);
router.patch("/history/edit/:id", isAuth, injectCompany, requirePermission("appointments.manage"), historyEditRowPatch);
router.get("/history/edit/:id/conflicts", isAuth, injectCompany, requirePermission("appointments.view"), historyCheckConflicts);
router.get("/history", isVerified, requirePermission("appointments.view"), historyInit);
router.delete("/history", isAuth, injectCompany, requirePermission("appointments.cancelDelete"), historyDeleteRow);
router.get("/history/search", isAuth, injectCompany, requirePermission("appointments.view"), historySearch);

// ── Clients (page unifiée — pour l'instant : liste de tous les RDV) ──────────
router.get("/clients-hub", isAuth, injectCompany, requirePermission("appointments.view"), adminController.clientsHubInit);
router.delete("/clients-hub/bookings", isAuth, injectCompany, requirePermission("appointments.cancelDelete"), adminController.clientsHubBulkDelete);
router.get("/clients-hub/search", isAuth, injectCompany, requirePermission("appointments.view"), adminController.clientsHubSearch);
router.get("/clients-hub/lookup", isAuth, injectCompany, requirePermission("appointments.view"), adminController.clientsHubLookup);
router.post("/clients-hub/new", isAuth, injectCompany, requirePermission("clients.manage"), adminController.clientsHubCreate);
router.get("/clients-hub/:id", isAuth, injectCompany, requirePermission("appointments.view"), adminController.clientsHubDetail);
router.post("/clients-hub/:id/block", isAuth, injectCompany, requirePermission("clients.manage"), adminController.clientsHubBlock);
router.post("/clients-hub/:id/notes", isAuth, injectCompany, requirePermission("clients.manage"), adminController.clientsHubSaveNotes);
// ── Dossier client : entrées de suivi (note datée + PDF facultatif) ──────────
router.post("/clients-hub/:id/dossier/contact", isAuth, injectCompany, requirePermission("clients.manage"), adminController.clientsHubDossierContact);
router.post("/clients-hub/:id/dossier/entries", isAuth, injectCompany, requirePermission("clients.manage"), upload.single("pdf"), adminController.clientsHubDossierAdd);
router.patch("/clients-hub/:id/dossier/entries/:entryId", isAuth, injectCompany, requirePermission("clients.manage"), upload.single("pdf"), adminController.clientsHubDossierUpdate);
router.delete("/clients-hub/:id/dossier/entries/:entryId", isAuth, injectCompany, requirePermission("clients.manage"), adminController.clientsHubDossierDelete);
router.get("/clients-hub/:id/dossier/entries/:entryId/file", isAuth, injectCompany, requirePermission("clients.view"), adminController.clientsHubDossierDownload);

router.post("/toggle-day", isAuth, injectCompany, requireScheduleEditPermission, toggleDay);
router.post("/edit-availability", isAuth, injectCompany, requireScheduleEditPermission, editAvailabilty);

router.patch("/edit-interval", injectCompany, requirePermission("availability.manageShared"), editSlotTime);

router.delete("/appointment/:bookId/delete", isAuth, injectCompany, requirePermission("appointments.cancelDelete"), deleteBooking);
router.patch("/appointment/:bookId/restore", isAuth, injectCompany, requirePermission("appointments.cancelDelete"), restoreBooking);
router.patch("/appointment/:id/cancel", isAuth, injectCompany, requirePermission("appointments.cancelDelete"), cancelBooking);
router.patch("/appointment/:id/send-reminder", isAuth, injectCompany, requirePermission("appointments.manage"), adminController.sendManualReminder);
router.get("/appointment/week-data", isAuth, injectCompany, getWeekData);

router.patch("/appointement/:bookId/admin-notes", isAuth, injectCompany, requirePermission("appointments.manage"), saveAdminNotes);
router.patch("/appointement/:bookId/employee", isAuth, injectCompany, requirePermission("appointments.manage"), updateBookingEmployee);
router.get("/subscription/success", isVerified, paymentVerification);
router.get("/payment/success", isVerified, paymentVerification);

router.post("/subscription/resume", isAuth, injectCompany, requirePermission("billing.manage"), resumeSubscription);

router.get("/forms", isVerified, requirePermission("forms.manage"), adminController.formsIndex);
router.get("/forms/data", isVerified, requirePermission("forms.manage"), adminController.getFormData);
router.post("/forms/save", isVerified, requirePermission("forms.manage"), adminController.saveForm);

router.get("/customize-calendar", isAuth, injectCompany, requirePermission("customization.manage"), adminController.customizeCalendarPage);

// Page SMS dédiée (rappels + confirmation + crédits).
router.get("/sms", isAuth, injectCompany, requirePermission("customization.manage"), adminController.smsPage);

router.get("/support", isVerified, adminController.supportPage);
router.get("/support/chat", isAuth, adminController.getSupportChat);
router.get("/support/chat/unread-count", isAuth, adminController.getSupportChatUnreadCount);
router.post("/support/chat", isAuth, adminController.sendSupportChatMessage);
router.post("/support/chat/rate", isAuth, adminController.rateSupportChat);
router.get("/parrainage", isVerified, adminController.parrainage);
router.post("/parrainage/claim", isVerified, adminController.parrainageClaim);

// ── Site builder ──────────────────────────────────────────────────────────────
const siteCtrl = require("../controllers/site.controller");
router.get("/mon-site", isVerified, injectCompany, siteCtrl.editorPage);
router.post("/mon-site/save", isVerified, injectCompany, siteCtrl.save);
router.post("/mon-site/publish", isVerified, injectCompany, siteCtrl.togglePublish);
router.post("/mon-site/apply-template", isVerified, injectCompany, siteCtrl.applyTemplate);
router.get("/mon-site/preview", isVerified, injectCompany, siteCtrl.previewSite);
router.post("/mon-site/upload-image", isVerified, injectCompany, ...siteCtrl.uploadImage);

// ── Ordre des sections ────────────────────────────────────────────────────────
router.patch("/account/section-order", isVerified, adminController.saveSectionOrder);

// ── Notifications ─────────────────────────────────────────────────────────────
router.patch("/settings/notifications", isVerified, requirePermission("settings.manage"), adminController.saveNotificationSettings);

// ── Pré-paiement ──────────────────────────────────────────────────────────────
router.patch("/settings/prepayment", isVerified, requirePermission("settings.manage"), adminController.savePrepaymentSettings);
router.patch("/settings/cancellation-policy", isVerified, requirePermission("settings.manage"), adminController.saveCancellationPolicy);
router.patch(
  "/settings/payment-qr-code",
  isVerified,
  requirePermission("settings.manage"),
  upload.single("qrCodeImage"),
  processSingleImage("qrCodeImage"),
  adminController.uploadPaymentQrCode,
);
router.delete("/settings/payment-qr-code", isVerified, requirePermission("settings.manage"), adminController.deletePaymentQrCode);

// ── Stripe Connect (Express onboarding) ───────────────────────────────────────
router.get("/settings/stripe-connect",          isVerified, requirePermission("billing.manage"), adminController.initiateStripeConnect);
router.get("/settings/stripe-connect/return",   adminController.stripeConnectReturn);
router.get("/settings/stripe-connect/refresh",  adminController.stripeConnectRefresh);
router.post("/settings/stripe-connect/manual",  isVerified, requirePermission("billing.manage"), adminController.saveStripeAccountManual);
router.delete("/settings/stripe-connect",       isVerified, requirePermission("billing.manage"), adminController.disconnectStripeConnect);

// FAILLE CRITIQUE CORRIGÉE : cette route réécrit l'IBAN/BIC/PayPal vers lequel
// l'argent est reversé. Sans `billing.manage`, n'importe quel collaborateur
// (même grade Staff) pouvait détourner les versements. Désormais réservé aux
// rôles ayant explicitement la gestion de la facturation.
router.patch("/api/company/payout-info", isVerified, requirePermission("billing.manage"), adminController.savePayoutInfo);

module.exports = router;
