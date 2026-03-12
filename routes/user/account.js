const router = require("express").Router();

const upload = require("../../config/multer");

const {
  editProfilePicture,
  updateAccountInfo,
  updateAccountSocial,
} = require("../../controllers/account.controller");

router.patch(
  "/profile-picture",
  upload.single("profilePicture"),
  editProfilePicture,
);

router.patch("/update-info", updateAccountInfo);
router.patch("/update-social", updateAccountSocial);

module.exports = router;
