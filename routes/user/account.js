const router = require("express").Router();

const upload = require("../../config/multer");
const { processSingleImage, processMultipleImages } = require("../../middlewares/processImageUpload");
const accountController = require("../../controllers/account.controller");

const injectCompany = require("../../middlewares/injectCompany");
const isAuth = require("../../middlewares/isAuth");
const rateLimit = require("express-rate-limit");

// Anti brute-force sur les codes à 6 chiffres (2FA, suppression de compte,
// vérification email) — surface étroite, donc limite stricte par IP.
const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives. Veuillez réessayer dans quelques minutes." },
});
router.patch(
  "/profile-picture",
  upload.single("profilePicture"),
  processSingleImage("profilePicture"),
  accountController.editProfilePicture,
);

// Messages du fondateur (superadmin → utilisateur)
router.get("/my-messages", isAuth, accountController.getMyMessages);
router.post("/my-messages/:id/dismiss", isAuth, accountController.dismissMyMessage);

router.patch("/update-info", accountController.updateAccountInfo);
// `injectCompany` est INDISPENSABLE ici : le handler écrit sur l'établissement
// courant et refusait tout enregistrement avec « Aucun établissement
// sélectionné » tant que ce middleware ne le posait pas.
router.patch("/update-social", isAuth, injectCompany, accountController.updateAccountSocial);
router.patch("/toggle-social", accountController.toggleSocialVisibility);

router.post("/create-checkout", accountController.createCheckout);
// `injectCompany` : ces trois achats sont réservés aux forfaits Pro/Business,
// et le forfait appartient à l'ÉTABLISSEMENT. Sans lui, ils vérifiaient le
// plan du COMPTE — un patron abonné Pro pour un seul établissement pouvait
// acheter des options depuis n'importe lequel des autres.
router.post("/purchase-addon/custom-url", isAuth, injectCompany, accountController.purchaseAddonCustomUrl);
router.post("/collaborator-seats", isAuth, injectCompany, accountController.updateCollaboratorSeats);
router.post("/sms-topup", isAuth, injectCompany, accountController.topUpSmsBalance);
router.post("/sms-autorecharge", isAuth, accountController.updateSmsAutoRecharge);
router.patch("/sms-settings", isAuth, accountController.updateSmsSettings);

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
router.post("/check-digital-code", codeLimiter, accountController.checkDigitalCode);
router.post("/verification/code", codeLimiter, accountController.verificationCode);

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
router.delete("/business-picture", isAuth, accountController.deleteBusinessPicture);

router.post("/send-delete-code", isAuth, accountController.sendDeleteCode);
router.delete("/delete-account", isAuth, codeLimiter, accountController.deleteAccount);

router.patch("/calendar-settings", isAuth, injectCompany, accountController.updateCalendarSettings);
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
// Les catégories appartiennent à l'établissement : sans `injectCompany`, les
// trois routes échouaient systématiquement — l'onglet Catégories entier était
// inutilisable.
router.patch("/categories", isAuth, injectCompany, accountController.updateCategories);
router.patch("/categories/rename", isAuth, injectCompany, accountController.renameCategory);
router.delete("/categories/:name", isAuth, injectCompany, accountController.deleteCategory);
router.patch("/booking-category-style", accountController.updateBookingCategoryStyle);
router.patch("/faq", accountController.updateFaq);
router.patch("/badges", accountController.updateBadges);
router.patch("/toggle-section", accountController.toggleSection);
router.patch("/reminder-settings", accountController.updateReminderSettings);

// `injectCompany` : le slug appartient à l'établissement ACTIF. Sans lui, le
// handler prenait le premier établissement du compte et renommait le mauvais.
router.patch("/slug", isAuth, injectCompany, accountController.updateSlug);
router.get("/check-slug", isAuth, accountController.checkSlug);

// ── Payment methods ──────────────────────────────────────────────────────────
router.post("/payment-method/setup-intent", isAuth, accountController.createSetupIntent);
router.post("/payment-method/:pmId/set-default", isAuth, accountController.setDefaultPaymentMethod);
router.delete("/payment-method/:pmId", isAuth, accountController.detachPaymentMethod);

// ── 2FA ──────────────────────────────────────────────────────────────────────
router.post("/2fa/setup",   isAuth, accountController.setup2FA);
router.post("/2fa/enable",  isAuth, codeLimiter, accountController.enable2FA);
router.post("/2fa/disable", isAuth, codeLimiter, accountController.disable2FA);

// ── Langue de l'interface ────────────────────────────────────────────────────
router.post("/language", isAuth, accountController.updateLanguage);

// ── Établissement (créer / mettre en pause / reprendre) ───────────────────────
router.post("/create-company", isAuth, accountController.createCompanyForExistingUser);
router.patch("/company-pause", isAuth, injectCompany, accountController.pauseCompany);
router.patch("/company-resume", isAuth, injectCompany, accountController.resumeCompany);
router.post("/join-company", isAuth, accountController.requestJoinCompany);
router.patch("/join-requests/:requestId", isAuth, injectCompany, accountController.respondJoinRequest);
router.patch("/invitations/:membershipId", isAuth, accountController.respondToInvitation);

// ── Multi-établissements (cf. "Gérer mes établissements") ─────────────────────
const establishmentController = require("../../controllers/establishment.controller");
const { requirePermissionForParamCompany } = require("../../utils/permissions");
const requireEstablishmentManage = requirePermissionForParamCompany("establishment.manage");
const requireEstablishmentDelete = requirePermissionForParamCompany("establishment.delete");
const requireCollaboratorsManage = requirePermissionForParamCompany("collaborators.manage");

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
router.patch("/establishments/:id", isAuth, requireEstablishmentManage, establishmentController.updateEstablishment);
router.patch(
  "/establishments/:id/photo",
  isAuth,
  requireEstablishmentManage,
  upload.single("photo"),
  processSingleImage("photo"),
  establishmentController.updateEstablishmentPhoto,
);
router.patch("/establishments/:id/pause", isAuth, requireEstablishmentManage, establishmentController.togglePauseEstablishment);
router.delete("/establishments/:id", isAuth, requireEstablishmentDelete, establishmentController.deleteEstablishment);

router.post("/establishments/:id/collaborateurs", isAuth, requireCollaboratorsManage, establishmentController.inviteCollaborator);
// Attribuer un grade = distribuer des permissions (dont facturation,
// suppression d'établissement…). On exige donc AUSSI `grades.manage` (par
// défaut réservé au patron), pas seulement `collaborators.manage` : sinon un
// collaborateur autorisé à gérer l'équipe pouvait s'octroyer un grade
// supérieur au sien. Le handler interdit en plus d'agir sur son propre grade.
router.patch("/establishments/:id/collaborateurs/:membershipId/grade", isAuth, requireCollaboratorsManage, requirePermissionForParamCompany("grades.manage"), establishmentController.updateCollaboratorGrade);
router.patch("/establishments/:id/collaborateurs/:membershipId/time-off-permission", isAuth, requireCollaboratorsManage, establishmentController.updateCollaboratorTimeOffPermission);
router.patch("/establishments/:id/collaborateurs/:membershipId/active", isAuth, requireCollaboratorsManage, establishmentController.toggleCollaboratorActive);
router.delete("/establishments/:id/collaborateurs/:membershipId", isAuth, requireCollaboratorsManage, establishmentController.removeCollaborator);
router.patch("/establishments/:id/join-requests/:membershipId", isAuth, requireCollaboratorsManage, establishmentController.respondJoinRequestForCompany);
// Pas de requireCollaboratorsManage ici : le contrôleur autorise toujours
// l'auto-édition de son propre profil, et vérifie collaborators.manage
// lui-même pour modifier le profil de quelqu'un d'autre (cf. controller).
router.patch("/establishments/:id/collaborateurs/:membershipId/employee-profile", isAuth, establishmentController.updateCollaboratorEmployeeProfile);
router.patch("/establishments/:id/owner-employee-profile", isAuth, requireCollaboratorsManage, establishmentController.updateOwnerEmployeeProfile);

// ── Grades/permissions ───────────────────────────────────────────────────────
const gradeController = require("../../controllers/grade.controller");
const requireGradesView   = requirePermissionForParamCompany("grades.view");
const requireGradesManage = requirePermissionForParamCompany("grades.manage");
router.get("/establishments/:id/grades", isAuth, requireGradesView, gradeController.listGrades);
router.post("/establishments/:id/grades", isAuth, requireGradesManage, gradeController.createGrade);
router.patch("/establishments/:id/grades/:gradeId", isAuth, requireGradesManage, gradeController.updateGrade);
router.delete("/establishments/:id/grades/:gradeId", isAuth, requireGradesManage, gradeController.deleteGrade);

// ── Choisir l'établissement actif (utilisateur avec plusieurs établissements
// possédés, ou membre de plusieurs équipes) — cf. middlewares/injectCompany.js
router.post("/switch-company/:id", isAuth, establishmentController.switchActiveCompany);

module.exports = router;
