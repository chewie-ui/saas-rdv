const router = require("express").Router();

const upload = require("../../config/multer");

const {
  editProfilePicture,
  updateAccountInfo,
  updateAccountSocial,
  createCheckout,
  cancelSubscription,
  updatePassword,
  editEmailConfirmation,
  checkDigitalCode,
} = require("../../controllers/account.controller");
const injectCompany = require("../../middlewares/injectCompany");
const isAuth = require("../../middlewares/isAuth");
router.patch(
  "/profile-picture",
  upload.single("profilePicture"),
  editProfilePicture,
);

router.patch("/update-info", updateAccountInfo);
router.patch("/update-social", updateAccountSocial);

router.post("/create-checkout", createCheckout);

router.post("/update-password", isAuth, injectCompany, updatePassword);
router.post("/cancel-subscription", cancelSubscription);

router.post("/edit-email-confirmation", editEmailConfirmation);
router.post("/check-digital-code", checkDigitalCode);


module.exports = router;
