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

module.exports = router;
