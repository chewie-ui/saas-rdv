const router = require("express").Router();
const ctrl = require("../controllers/services.controller");
const isAuth = require("../middlewares/isAuth");
const injectCompany = require("../middlewares/injectCompany");
const { requirePermission } = require("../utils/permissions");

const guard = [isAuth, injectCompany];
const guardView = [...guard, requirePermission("services.view")];
const guardManage = [...guard, requirePermission("services.manage")];

// Page admin
router.get("/services", ...guardView, ctrl.servicesPage);

// API admin (CRUD)
router.post("/api/services", ...guardManage, ctrl.createService);
router.patch("/api/services/bulk-toggle", ...guardManage, ctrl.bulkToggleServices);
router.patch("/api/services/booking-question", ...guardManage, ctrl.updateBookingQuestion);
router.get("/api/services/employees", ...guardView, ctrl.getCompanyEmployees);
router.patch("/api/services/:id", ...guardManage, ctrl.updateService);
router.patch("/api/services/:id/toggle", ...guardManage, ctrl.toggleService);
router.delete("/api/services/:id", ...guardManage, ctrl.deleteService);
router.patch("/api/services/:id/employees", ...guardManage, ctrl.setServiceEmployees);

// API publique (client booking)
router.get("/api/services", ctrl.getServices);

module.exports = router;
