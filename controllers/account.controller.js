const User = require("../db/models/user.model");
const Subscription = require("../db/models/subscription.model");
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

    console.log({ user: req.user._id, fullName, email, phone });

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

    success_url: "http://localhost:3000/subscription/success",
    cancel_url: "http://localhost:3000/subscription",
  });

  res.json({ url: session.url });
};
