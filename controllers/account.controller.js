const User = require("../db/models/user.model");
const Subscription = require("../db/models/subscription.model");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const bcrypt = require("bcrypt");
const { sendEmail } = require("../utils/mailer");

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

    const user = req.user;
    const updates = {};
    const changes = {
      fullName: user.fullName !== fullName,
      email: user.email !== email,
      phone: user.phone !== phone,
    };

    if (changes.fullName) updates.fullName = fullName;
    if (changes.email) updates.email = email;
    if (changes.phone) updates.phone = phone;

    if (Object.keys(updates).length === 0) {
      return res.json({ same: true });
    }

    await User.findByIdAndUpdate(req.user._id, {
      fullName,
      email,
      phone,
    });
    return res.json({ success: true, changes });
  } catch (err) {
    return res.json(err);
  }
};

exports.updateAccountSocial = async (req, res) => {
  try {
    const { fieldName, fieldValue } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      [fieldName]: fieldValue,
    });
  } catch (err) {
    return res.json(err);
  }
};

exports.createCheckout = async (req, res) => {
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",

    payment_method_types: ["card"],

    line_items: [
      {
        price: "price_1TBAqO0wC6a6C3eSJYPmWAdU",
        quantity: 1,
      },
    ],

    client_reference_id: req.user._id.toString(),

    success_url: "https://www.gymio.be/subscription/success",
    cancel_url: "https://www.gymio.be/subscription",
  });

  res.json({ url: session.url });
};

exports.updatePassword = async (req, res) => {
  try {
    const userId = req.user._id;
    const { oldPassword, newPassword } = req.body;

    const user = await User.findById(userId);

    const isMatch = await bcrypt.compare(oldPassword, user.password);

    if (!isMatch) {
      return res.render("admin/informations", {
        invalidPassword: true,
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    await user.save();

    res.redirect("/informations?success=Mot de passe mis à jour");
  } catch (err) {
    console.error(err);
    return res.render("admin/informations", {
      error: "An error occurred",
      user: req.user,
    });
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ user: req.user._id });

    if (!subscription.stripeSubscriptionId) {
      return res.status(400).json({ error: "No active subscription found." });
    }

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    subscription.autoRenew = false;
    await subscription.save();

    res.json({
      success: true,
      message: "Subscription will be canceled at the end of the period.",
    });
  } catch (err) {
    console.error("Stripe Cancel Error:", err);
    res
      .status(500)
      .json({ error: "An error occurred while canceling your subscription." });
  }
};

exports.editEmailConfirmation = async (req, res) => {
  try {
    // 1. Générer un code (ex: 6 chiffres)
    const verificationCode = Math.floor(100000 + Math.random() * 900000);
    req.session.emailVerificationCode = verificationCode;
    // req.session.pendingEmail = req.body.newEmail;
    await sendEmail(
      "quentin.rennies@gmail.com",
      "Digital code",
      String(verificationCode),
    );

    res.json({ success: true });
  } catch (err) {
    res
      .status(500)
      .json({ success: false, message: "Impossible d'envoyer le mail" });
  }
};

exports.checkDigitalCode = async (req, res) => {
  const { code } = req.body;
  const { emailVerificationCode } = req.session;

  if (Number(code) === Number(emailVerificationCode)) {
    return res.json({ success: true });
  }

  return res.json({ success: false });
};
