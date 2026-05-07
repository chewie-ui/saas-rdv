const router  = require("express").Router();
const ctrl    = require("../controllers/employees.controller");
const isAuth  = require("../middlewares/isAuth");
const injectCompany = require("../middlewares/injectCompany");
const upload  = require("../config/multer");

const guard = [isAuth, injectCompany];

// Page admin
router.get("/employees", ...guard, ctrl.employeesPage);

// API admin CRUD
router.post("/api/employees",             ...guard, upload.single("profilePicture"), ctrl.createEmployee);
router.patch("/api/employees/:id",        ...guard, upload.single("profilePicture"), ctrl.updateEmployee);
router.delete("/api/employees/:id",       ...guard, ctrl.deleteEmployee);
router.patch("/api/employees/:id/toggle", ...guard, ctrl.toggleEmployee);

module.exports = router;
