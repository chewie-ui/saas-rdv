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

// ── Page admin ──────────────────────────────────────────────────────────────
// Les trois générations partagent le MÊME contrôleur (`servicesV2`) : il
// prépare déjà `services`, `categories`, `serviceColors`, `employees` et
// `maxServices`. Seule la vue rendue change, via ce petit adaptateur — aucune
// requête supplémentaire, et les anciennes pages restent intactes.
const rendreAvec = (vue) => (req, res, next) => {
  const render = res.render.bind(res);
  res.render = (v, data) => render(v === "admin/services" ? vue : v, data);
  return ctrl.servicesV2(req, res, next);
};

// /services = la nouvelle page (copie de la maquette, voir service-new.pug).
router.get("/services", ...guardView, rendreAvec("admin/service-new"));
// Les deux générations précédentes restent joignables, rien n'est supprimé :
router.get("/services-v2", ...guardView, rendreAvec("admin/services"));   // tableau + questionnaire
router.get("/services-old", ...guardView, ctrl.servicesPage);             // toute première version
// Ancienne URL de travail de la refonte → /services.
router.get("/service-new", ...guard, (req, res) => res.redirect(301, "/services"));

// API admin (CRUD)
router.post("/api/services", ...guardManage, ctrl.createService);
router.patch("/api/services/bulk-toggle", ...guardManage, ctrl.bulkToggleServices);
router.patch("/api/services/booking-question", ...guardManage, ctrl.updateBookingQuestion);
router.patch("/api/services/questionnaire", ...guardManage, ctrl.updateQuestionnaire);
router.get("/api/services/employees", ...guardView, ctrl.getCompanyEmployees);
// Préférence d'affichage personnelle (colonnes masquées) — avant /:id.
router.patch("/api/services/columns", ...guardView, ctrl.updateServicesColumns);
// Ordre des services (glisser-déposer) — avant /:id pour ne pas être capturé.
router.patch("/api/services/reorder", ...guardManage, ctrl.reorderServices);
router.patch("/api/services/:id", ...guardManage, ctrl.updateService);
router.patch("/api/services/:id/toggle", ...guardManage, ctrl.toggleService);
router.delete("/api/services/:id", ...guardManage, ctrl.deleteService);
router.patch("/api/services/:id/employees", ...guardManage, ctrl.setServiceEmployees);
router.patch("/api/services/:id/image", ...guardManage, upload.single("image"), processSingleImage("service"), ctrl.updateServiceImage);
router.delete("/api/services/:id/image", ...guardManage, ctrl.deleteServiceImage);

// API publique (client booking)
router.get("/api/services", ctrl.getServices);

module.exports = router;
