const router = require("express").Router();
const ctrl = require("../controllers/superadmin.controller");
const rateLimit = require("express-rate-limit");

// Anti brute-force du secret superadmin — toute la surface admin repose sur ce
// seul mot de passe, il ne doit pas pouvoir être bombardé de tentatives.
const superadminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives. Réessayez dans quelques minutes." },
});

function isSuperAdmin(req, res, next) {
  if (req.session && req.session.isSuperAdmin) return next();
  res.redirect("/superadmin/login");
}

router.get("/superadmin/login", ctrl.loginPage);
router.post("/superadmin/login", superadminLoginLimiter, ctrl.login);
router.get("/superadmin/logout", ctrl.logout);
router.get("/superadmin", isSuperAdmin, ctrl.usersPage);
const upload = require("../config/multer");
const { processSingleImage } = require("../middlewares/processImageUpload");

router.get("/superadmin/establishments", isSuperAdmin, ctrl.establishmentsPage);
router.delete("/superadmin/establishments/:companyId", isSuperAdmin, ctrl.deleteEstablishment);
router.get("/superadmin/establishments/export", isSuperAdmin, ctrl.establishmentsExport);
router.get("/superadmin/establishments/:companyId/details", isSuperAdmin, ctrl.establishmentDetails);
router.patch("/superadmin/establishments/:companyId/pause", isSuperAdmin, ctrl.toggleEstablishmentPause);
router.patch("/superadmin/establishments/:companyId/plan", isSuperAdmin, ctrl.setPlanForCompany);
router.patch(
  "/superadmin/establishments/:companyId/info",
  isSuperAdmin,
  upload.single("photo"),
  processSingleImage("company"),
  ctrl.updateCompanyInfo
);
router.patch("/superadmin/toggle-premium/:userId", isSuperAdmin, ctrl.toggleManualPremium);
router.patch("/superadmin/set-plan/:userId", isSuperAdmin, ctrl.setPlan);
router.patch("/superadmin/set-trial/:userId", isSuperAdmin, ctrl.setTrialDuration);

// Logs
router.get("/superadmin/logs", isSuperAdmin, ctrl.logsPage);

// Parrainage
router.get("/superadmin/referrals", isSuperAdmin, ctrl.referralsPage);

// Boost (mise en avant homepage)
// Modération des métiers : demandes des pros + métiers « orange » constatés.
router.get("/superadmin/metiers", isSuperAdmin, ctrl.jobTitlesPage);
router.patch("/superadmin/metiers/decision", isSuperAdmin, ctrl.decideJobTitle);

router.get("/superadmin/boost", isSuperAdmin, ctrl.boostPage);
router.patch("/superadmin/boost/:companyId", isSuperAdmin, ctrl.setBoost);

// Promo codes
router.get("/superadmin/promo-codes", isSuperAdmin, ctrl.promoCodesPage);
router.post("/superadmin/promo-codes", isSuperAdmin, ctrl.createPromoCode);
router.patch("/superadmin/promo-codes/:id/toggle", isSuperAdmin, ctrl.togglePromoCode);
router.patch("/superadmin/promo-codes/:id/toggle-offer", isSuperAdmin, ctrl.togglePromoOffer);
router.delete("/superadmin/promo-codes/:id", isSuperAdmin, ctrl.deletePromoCode);

// Validation publique (pour le checkout)
router.post("/api/validate-promo", ctrl.validatePromoCode);

// Access links
router.get("/superadmin/access-links", isSuperAdmin, ctrl.accessLinksPage);
router.post("/superadmin/access-links", isSuperAdmin, ctrl.createAccessLink);
router.patch("/superadmin/access-links/:id/toggle", isSuperAdmin, ctrl.toggleAccessLink);
router.delete("/superadmin/access-links/:id", isSuperAdmin, ctrl.deleteAccessLink);

// Impersonation (accès discret)
router.post("/superadmin/impersonate/:userId", isSuperAdmin, ctrl.impersonate);
router.get("/superadmin/exit-impersonation", ctrl.exitImpersonation);

// Supervision (avec consentement utilisateur)
router.post("/superadmin/supervision-request/:userId", isSuperAdmin, ctrl.supervisionRequest);
router.get("/superadmin/impersonate-supervised/:token", isSuperAdmin, ctrl.supervisionImpersonate);

// Réponse de l'utilisateur (pas de guard isSuperAdmin — c'est l'user qui répond)
router.post("/api/supervision/respond", ctrl.supervisionRespond);
// Fermeture de la supervision par l'utilisateur
router.post("/api/supervision/close", ctrl.supervisionClose);

// Toggle account status (actif / désactivé)
router.patch("/superadmin/toggle-account/:userId", isSuperAdmin, ctrl.toggleAccountStatus);

// Suppression définitive d'un compte (+ toutes ses données)
router.delete("/superadmin/users/:userId", isSuperAdmin, ctrl.deleteUserAccount);

// Export CSV de la liste filtrée — avant la route paramétrée pour que
// "export" ne soit pas pris pour un identifiant.
router.get("/superadmin/users/export", isSuperAdmin, ctrl.usersExport);
// Fiche détaillée (panneau latéral)
router.get("/superadmin/users/:userId/details", isSuperAdmin, ctrl.userDetails);

// Pages / fonctionnalités (maintenance, erreur, désactivation)
router.get("/superadmin/features", isSuperAdmin, ctrl.featuresPage);
router.patch("/superadmin/features/:key", isSuperAdmin, ctrl.setFeatureStatus);
router.patch("/superadmin/hidden-features/:key", isSuperAdmin, ctrl.toggleHiddenFeature);
router.patch("/superadmin/nav/:key/toggle", isSuperAdmin, ctrl.toggleNavLink);

// Support chat (founder ↔ utilisateurs)
router.get("/superadmin/support-chat", isSuperAdmin, ctrl.supportChatPage);
router.get("/superadmin/support-chat-unread-total", isSuperAdmin, ctrl.getSupportChatUnreadTotal);
router.get("/superadmin/support-chat/:userId", isSuperAdmin, ctrl.getSupportChatThread);
router.post("/superadmin/support-chat/:userId/reply", isSuperAdmin, ctrl.replySupportChat);
router.delete("/superadmin/support-chat/:userId", isSuperAdmin, ctrl.deleteSupportChat);

// Messagerie fondateur → utilisateurs pros
// Signalements d'avis — c'est ici que se décide la suppression d'un avis.
router.get("/superadmin/signalements", isSuperAdmin, ctrl.reviewReportsPage);
router.get("/superadmin/signalements-count", isSuperAdmin, ctrl.reviewReportsCount);
router.patch("/superadmin/signalements/:id", isSuperAdmin, ctrl.decideReviewReport);

router.get("/superadmin/messages", isSuperAdmin, ctrl.messagesPage);
router.post("/superadmin/messages", isSuperAdmin, ctrl.sendMessage);
router.delete("/superadmin/messages/:id", isSuperAdmin, ctrl.deleteMessage);

// Support content editor
router.get("/superadmin/support-editor", isSuperAdmin, ctrl.supportEditorPage);
router.post("/superadmin/support-editor/sections", isSuperAdmin, ctrl.addSection);
router.patch("/superadmin/support-editor/sections/reorder", isSuperAdmin, ctrl.reorderSections);
router.patch("/superadmin/support-editor/sections/:sectionId", isSuperAdmin, ctrl.updateSection);
router.delete("/superadmin/support-editor/sections/:sectionId", isSuperAdmin, ctrl.deleteSection);
router.post("/superadmin/support-editor/sections/:sectionId/videos", isSuperAdmin, ctrl.addVideo);
router.patch("/superadmin/support-editor/sections/:sectionId/videos/:videoId", isSuperAdmin, ctrl.updateVideo);
router.delete("/superadmin/support-editor/sections/:sectionId/videos/:videoId", isSuperAdmin, ctrl.deleteVideo);
router.post("/superadmin/support-editor/sections/:sectionId/faqs", isSuperAdmin, ctrl.addFaq);
router.patch("/superadmin/support-editor/sections/:sectionId/faqs/:faqId", isSuperAdmin, ctrl.updateFaq);
router.delete("/superadmin/support-editor/sections/:sectionId/faqs/:faqId", isSuperAdmin, ctrl.deleteFaq);

// Blog — articles publics rédigés depuis le superadmin (acquisition SEO).
// À ne pas confondre avec /superadmin/support-editor, qui est le centre d'aide.
const blog = require("../controllers/blog.controller");
router.get("/superadmin/blog", isSuperAdmin, blog.adminListPage);
router.get("/superadmin/blog/nouveau", isSuperAdmin, blog.adminEditorPage);
router.post("/superadmin/blog", isSuperAdmin, blog.create);
router.post(
  "/superadmin/blog/image",
  isSuperAdmin,
  upload.single("image"),
  processSingleImage("blog"),
  blog.uploadImage
);
// Après les routes littérales, sinon "nouveau" et "image" seraient pris pour des ids.
router.get("/superadmin/blog/:id", isSuperAdmin, blog.adminEditorPage);
router.patch("/superadmin/blog/:id", isSuperAdmin, blog.update);
router.post("/superadmin/blog/:id/dupliquer", isSuperAdmin, blog.duplicate);
router.delete("/superadmin/blog/:id", isSuperAdmin, blog.remove);

// Public redemption (no auth required — handler checks itself)
router.get("/access/:code", ctrl.redeemAccessLink);

module.exports = router;
