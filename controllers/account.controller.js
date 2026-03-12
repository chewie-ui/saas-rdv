const User = require("../db/models/user.model");

exports.editProfilePicture = async (req, res) => {
  try {
    const { filename } = req.file;
    const imagePath = `/uploads/profiles/${filename}`;

    await User.findByIdAndUpdate(req.user._id, {
      profilePicture: imagePath,
    });

    return res.json({ success: true });
  } catch (err) {
    return res.json(err);
  }
};

exports.updateAccountInfo = async (req, res) => {
  try {
    const { fullName, email, phone } = req.body;

    await User.findByIdAndUpdate(req.user._id, {
      fullName,
      email,
      phone,
    });
  } catch (err) {
    return res.json(err);
  }
};

exports.updateAccountSocial = async (req, res) => {
  try {
    const { fieldName, fieldValue } = req.body;
    console.log(fieldName);
    console.log(fieldValue);

    await User.findByIdAndUpdate(req.user._id, {
      [fieldName]: fieldValue,
    });
  } catch (err) {
    return res.json(err);
  }
};
