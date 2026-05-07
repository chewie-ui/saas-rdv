const router = require("express").Router();
const ctrl = require("../controllers/client.controller");
const isClientAuth = require("../middlewares/isClientAuth");
const upload = require("../config/multer");

router.get("/client/register", ctrl.getRegister);
router.post("/client/register", ctrl.postRegister);

router.get("/client/login", ctrl.getLogin);
router.post("/client/login", ctrl.postLogin);

router.get("/client/logout", ctrl.logout);

router.get("/espace-client", isClientAuth, ctrl.getDashboard);

// ─── Settings ────────────────────────────────────────────────────────────────
router.get("/espace-client/parametres", isClientAuth, ctrl.getSettings);
router.post("/espace-client/parametres/profile", isClientAuth, ctrl.updateProfile);
router.patch("/espace-client/parametres/picture", isClientAuth, upload.single("profilePicture"), ctrl.updateClientPicture);
router.post("/espace-client/parametres/email", isClientAuth, ctrl.updateClientEmail);
router.post("/espace-client/parametres/password", isClientAuth, ctrl.updateClientPassword);
router.post("/espace-client/parametres/language", isClientAuth, ctrl.updateClientLang);

module.exports = router;
