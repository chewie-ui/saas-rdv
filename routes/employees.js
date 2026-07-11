const router  = require("express").Router();
const ctrl    = require("../controllers/employees.controller");
const isAuth  = require("../middlewares/isAuth");
const injectCompany = require("../middlewares/injectCompany");
const upload  = require("../config/multer");
const { processSingleImage } = require("../middlewares/processImageUpload");
const { requirePermission } = require("../utils/permissions");

const guard      = [isAuth, injectCompany];
// Un grade "Staff" (collaborators.view/manage = false par défaut) ne doit
// jamais pouvoir créer/modifier/virer un collègue — ces routes n'avaient
// AUCUNE vérification de permission avant (juste isAuth), ce qui contournait
// entièrement le système de grades pour la gestion d'équipe.
const canView    = [...guard, requirePermission("collaborators.view")];
const canManage  = [...guard, requirePermission("collaborators.manage")];

// Page admin
router.get("/employees", ...canView, ctrl.employeesPage);

// API admin CRUD
router.post("/api/employees",                  ...canManage, upload.single("profilePicture"), processSingleImage("profilePicture"), ctrl.createEmployee);
router.patch("/api/employees/bulk-toggle",     ...canManage, ctrl.bulkToggleEmployees);
router.patch("/api/employees/:id",             ...canManage, upload.single("profilePicture"), processSingleImage("profilePicture"), ctrl.updateEmployee);
router.delete("/api/employees/:id",            ...canManage, ctrl.deleteEmployee);
router.patch("/api/employees/:id/toggle",      ...canManage, ctrl.toggleEmployee);

module.exports = router;
