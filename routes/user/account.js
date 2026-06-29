const router = require("express").Router();

const upload = require("../../config/multer");
const { processSingleImage, processMultipleImages } = require("../../middlewares/processImageUpload");
const accountController = require("../../controllers/account.controller");

const injectCompany = require("../../middlewares/injectCompany");
const isAuth = require("../../middlewares/isAuth");
router.patch(
  "/profile-picture",
  upload.single("profilePicture"),
  processSingleImage("profilePicture"),
  accountController.editProfilePicture,
);

router.patch("/update-info", accountController.updateAccountInfo);
router.patch("/update-social", accountController.updateAccountSocial);
router.patch("/toggle-social", accountController.toggleSocialVisibility);

router.post("/create-checkout", accountController.createCheckout);
router.post("/purchase-addon/custom-url", isAuth, accountController.purchaseAddonCustomUrl);

router.post(
  "/update-password",
  isAuth,
  injectCompany,
  accountController.updatePassword,
);
router.post("/cancel-subscription", accountController.cancelSubscription);

router.post(
  "/edit-email-confirmation",
  isAuth,
  accountController.editEmailConfirmation,
);
router.post("/check-digital-code", accountController.checkDigitalCode);
router.post("/verification/code", accountController.verificationCode);

router.patch("/edit/email", accountController.editEmail);

router.patch("/location", accountController.updateLocation);

router.patch("/description/edit", accountController.editDescription);
router.patch("/business-type", accountController.updateBusinessType);
router.patch("/business-info", accountController.editBusinessInfo);
router.patch("/about", accountController.updateAbout);
router.patch(
  "/business-picture",
  upload.single("businessPicture"),
  processSingleImage("businessPicture"),
  accountController.editBusinessPicture,
);

router.post("/send-delete-code", isAuth, accountController.sendDeleteCode);
router.delete("/delete-account", isAuth, accountController.deleteAccount);

router.patch("/calendar-settings", accountController.updateCalendarSettings);
router.patch("/embed-settings", isAuth, accountController.updateEmbedSettings);
router.patch(
  "/calendar-bg-image",
  upload.single("calendarBgImage"),
  processSingleImage("calendarBgImage"),
  accountController.editCalendarBgImage
);

router.patch(
  "/gallery",
  upload.array("galleryPhotos", 12),
  processMultipleImages("galleryPhoto"),
  accountController.updateGallery,
);
router.patch("/gallery/reorder", accountController.reorderGallery);
router.delete("/gallery/:index", accountController.deleteGalleryPhoto);
router.patch("/gallery-layout", accountController.updateGalleryLayout);
router.patch("/amenities", accountController.updateAmenities);
router.patch("/equipment", accountController.updateEquipment);
router.patch("/categories", accountController.updateCategories);
router.patch("/categories/rename", accountController.renameCategory);
router.delete("/categories/:name", accountController.deleteCategory);
router.patch("/booking-category-style", accountController.updateBookingCategoryStyle);
router.patch("/faq", accountController.updateFaq);
router.patch("/badges", accountController.updateBadges);
router.patch("/toggle-section", accountController.toggleSection);
router.patch("/reminder-settings", accountController.updateReminderSettings);

router.patch("/slug", isAuth, accountController.updateSlug);
router.get("/check-slug", isAuth, accountController.checkSlug);

// ── Payment methods ──────────────────────────────────────────────────────────
router.post("/payment-method/setup-intent", isAuth, accountController.createSetupIntent);
router.post("/payment-method/:pmId/set-default", isAuth, accountController.setDefaultPaymentMethod);
router.delete("/payment-method/:pmId", isAuth, accountController.detachPaymentMethod);

// ── 2FA ──────────────────────────────────────────────────────────────────────
router.post("/2fa/setup",   isAuth, accountController.setup2FA);
router.post("/2fa/enable",  isAuth, accountController.enable2FA);
router.post("/2fa/disable", isAuth, accountController.disable2FA);

// ── Langue de l'interface ────────────────────────────────────────────────────
router.post("/language", isAuth, accountController.updateLanguage);

// ── Établissement (créer / mettre en pause / reprendre) ───────────────────────
router.post("/create-company", isAuth, accountController.createCompanyForExistingUser);
router.patch("/company-pause", isAuth, injectCompany, accountController.pauseCompany);
router.patch("/company-resume", isAuth, injectCompany, accountController.resumeCompany);
router.post("/join-company", isAuth, accountController.requestJoinCompany);
router.patch("/join-requests/:requestId", isAuth, injectCompany, accountController.respondJoinRequest);

// ── Multi-établissements (cf. "Gérer mes établissements") ─────────────────────
const establishmentController = require("../../controllers/establishment.controller");

// Upload de la photo PENDANT la création (l'établissement n'existe pas encore
// donc on ne peut pas la rattacher à un id) — renvoie juste le chemin, à
// transmettre dans le payload de POST /establishments ci-dessous.
router.post(
  "/establishments/photo-temp",
  isAuth,
  upload.single("photo"),
  processSingleImage("photo"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Aucune image reçue." });
    return res.json({ success: true, path: `/uploads/profiles/${req.file.filename}` });
  },
);
router.post("/establishments", isAuth, establishmentController.createEstablishment);
router.patch("/establishments/:id", isAuth, establishmentController.updateEstablishment);
router.patch(
  "/establishments/:id/photo",
  isAuth,
  upload.single("photo"),
  processSingleImage("photo"),
  establishmentController.updateEstablishmentPhoto,
);
router.patch("/establishments/:id/pause", isAuth, establishmentController.togglePauseEstablishment);
router.delete("/establishments/:id", isAuth, establishmentController.deleteEstablishment);

router.post("/establishments/:id/collaborateurs", isAuth, establishmentController.inviteCollaborator);
router.patch("/establishments/:id/collaborateurs/:membershipId/role", isAuth, establishmentController.updateCollaboratorRole);
router.patch("/establishments/:id/collaborateurs/:membershipId/active", isAuth, establishmentController.toggleCollaboratorActive);
router.delete("/establishments/:id/collaborateurs/:membershipId", isAuth, establishmentController.removeCollaborator);
router.patch("/establishments/:id/join-requests/:membershipId", isAuth, establishmentController.respondJoinRequestForCompany);

// ── Choisir l'établissement actif (utilisateur avec plusieurs établissements
// possédés, ou membre de plusieurs équipes) — cf. middlewares/injectCompany.js
router.post("/switch-company/:id", isAuth, establishmentController.switchActiveCompany);

module.exports = router;
