const router = require("express").Router();
const ctrl = require("../controllers/services.controller");
const isAuth = require("../middlewares/isAuth");
const injectCompany = require("../middlewares/injectCompany");
const { requirePermission } = require("../utils/permissions");
const upload = require("../config/multer");
const { processSingleImage } = require("../middlewares/processImageUpload");

const guard = [isAuth, injectCompany];
const guardView = [...guard, requirePermission("services.view")];
const guardManage = [...guard, requirePermission("services.manage")];

// Page admin — /services sert désormais la nouvelle page (ex-« Services v2 »).
router.get("/services", ...guardView, ctrl.servicesV2);
// Ancienne page conservée (au cas où) sur /services-old.
router.get("/services-old", ...guardView, ctrl.servicesPage);
// Ancienne URL de la refonte → redirection permanente vers /services.
router.get("/services-v2", ...guard, (req, res) => res.redirect(301, "/services"));

// API admin (CRUD)
router.post("/api/services", ...guardManage, ctrl.createService);
router.patch("/api/services/bulk-toggle", ...guardManage, ctrl.bulkToggleServices);
router.patch("/api/services/booking-question", ...guardManage, ctrl.updateBookingQuestion);
router.patch("/api/services/questionnaire", ...guardManage, ctrl.updateQuestionnaire);
router.get("/api/services/employees", ...guardView, ctrl.getCompanyEmployees);
// Préférence d'affichage personnelle (colonnes masquées) — avant /:id.
router.patch("/api/services/columns", ...guardView, ctrl.updateServicesColumns);
router.patch("/api/services/:id", ...guardManage, ctrl.updateService);
router.patch("/api/services/:id/toggle", ...guardManage, ctrl.toggleService);
router.delete("/api/services/:id", ...guardManage, ctrl.deleteService);
router.patch("/api/services/:id/employees", ...guardManage, ctrl.setServiceEmployees);
router.patch("/api/services/:id/image", ...guardManage, upload.single("image"), processSingleImage("service"), ctrl.updateServiceImage);
router.delete("/api/services/:id/image", ...guardManage, ctrl.deleteServiceImage);

// API publique (client booking)
router.get("/api/services", ctrl.getServices);

module.exports = router;
