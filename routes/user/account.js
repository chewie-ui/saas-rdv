const router = require("express").Router();

const upload = require("../../config/multer");
const accountController = require("../../controllers/account.controller");

const injectCompany = require("../../middlewares/injectCompany");
const isAuth = require("../../middlewares/isAuth");
router.patch(
  "/profile-picture",
  upload.single("profilePicture"),
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
router.patch(
  "/business-picture",
  upload.single("businessPicture"),
  accountController.editBusinessPicture,
);

router.post("/send-delete-code", isAuth, accountController.sendDeleteCode);
router.delete("/delete-account", isAuth, accountController.deleteAccount);

router.patch("/calendar-settings", accountController.updateCalendarSettings);
router.patch(
  "/calendar-bg-image",
  upload.single("calendarBgImage"),
  accountController.editCalendarBgImage
);

router.patch("/gallery", upload.array("galleryPhotos", 12), accountController.updateGallery);
router.delete("/gallery/:index", accountController.deleteGalleryPhoto);
router.patch("/amenities", accountController.updateAmenities);
router.patch("/equipment", accountController.updateEquipment);
router.patch("/categories", accountController.updateCategories);
router.patch("/booking-category-style", accountController.updateBookingCategoryStyle);
router.patch("/faq", accountController.updateFaq);
router.patch("/badges", accountController.updateBadges);
router.patch("/toggle-section", accountController.toggleSection);

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

module.exports = router;
