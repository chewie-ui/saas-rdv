const router = require("express").Router();

const upload = require("../../config/multer");

const {
  editProfilePicture,
  updateAccountInfo,
  updateAccountSocial,
  createCheckout,
} = require("../../controllers/account.controller");

router.patch(
  "/profile-picture",
  upload.single("profilePicture"),
  editProfilePicture,
);

router.patch("/update-info", updateAccountInfo);
router.patch("/update-social", updateAccountSocial);

router.post("/create-checkout", createCheckout);

module.exports = router;
