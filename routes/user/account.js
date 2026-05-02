const router = require("express").Router();

const upload = require("../../config/multer");
const accountController = require("../../controllers/account.controller");

const injectCompany = require("../../middlewares/injectCompany");
const isAuth = require("../../middlewares/isAuth");
router.patch(
  "/profile-picture",
  upload.single("profilePicture"),
  accountController.editProfilePicture,
);

router.patch("/update-info", accountController.updateAccountInfo);
router.patch("/update-social", accountController.updateAccountSocial);

router.post("/create-checkout", accountController.createCheckout);

router.post(
  "/update-password",
  isAuth,
  injectCompany,
  accountController.updatePassword,
);
router.post("/cancel-subscription", accountController.cancelSubscription);

router.post(
  "/edit-email-confirmation",
  isAuth,
  accountController.editEmailConfirmation,
);
router.post("/check-digital-code", accountController.checkDigitalCode);
router.post("/verification/code", accountController.verificationCode);

router.patch("/edit/email", accountController.editEmail);

router.patch("/location", accountController.updateLocation);

router.patch("/description/edit", accountController.editDescription);
router.patch("/business-type", accountController.updateBusinessType);

router.post("/send-delete-code", isAuth, accountController.sendDeleteCode);
router.delete("/delete-account", isAuth, accountController.deleteAccount);

module.exports = router;
