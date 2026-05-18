const router = require("express").Router();
const ctrl = require("../controllers/superadmin.controller");

function isSuperAdmin(req, res, next) {
  if (req.session && req.session.isSuperAdmin) return next();
  res.redirect("/superadmin/login");
}

router.get("/superadmin/login", ctrl.loginPage);
router.post("/superadmin/login", ctrl.login);
router.get("/superadmin/logout", ctrl.logout);
router.get("/superadmin", isSuperAdmin, ctrl.usersPage);
router.patch("/superadmin/toggle-premium/:userId", isSuperAdmin, ctrl.toggleManualPremium);
router.patch("/superadmin/set-plan/:userId", isSuperAdmin, ctrl.setPlan);
router.patch("/superadmin/set-trial/:userId", isSuperAdmin, ctrl.setTrialDuration);

// Promo codes
router.get("/superadmin/promo-codes", isSuperAdmin, ctrl.promoCodesPage);
router.post("/superadmin/promo-codes", isSuperAdmin, ctrl.createPromoCode);
router.patch("/superadmin/promo-codes/:id/toggle", isSuperAdmin, ctrl.togglePromoCode);
router.delete("/superadmin/promo-codes/:id", isSuperAdmin, ctrl.deletePromoCode);

// Validation publique (pour le checkout)
router.post("/api/validate-promo", ctrl.validatePromoCode);

module.exports = router;
