const router = require("express").Router();
const ctrl = require("../controllers/services.controller");
const isAuth = require("../middlewares/isAuth");
const injectCompany = require("../middlewares/injectCompany");

const guard = [isAuth, injectCompany];

// Page admin
router.get("/services", ...guard, ctrl.servicesPage);

// API admin (CRUD)
router.post("/api/services", ...guard, ctrl.createService);
router.patch("/api/services/bulk-toggle", ...guard, ctrl.bulkToggleServices);
router.patch("/api/services/booking-question", ...guard, ctrl.updateBookingQuestion);
router.get("/api/services/employees", ...guard, ctrl.getCompanyEmployees);
router.patch("/api/services/:id", ...guard, ctrl.updateService);
router.patch("/api/services/:id/toggle", ...guard, ctrl.toggleService);
router.delete("/api/services/:id", ...guard, ctrl.deleteService);
router.patch("/api/services/:id/employees", ...guard, ctrl.setServiceEmployees);

// API publique (client booking)
router.get("/api/services", ctrl.getServices);

module.exports = router;
