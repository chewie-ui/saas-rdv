const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const User = require("../db/models/user.model");
const Subscription = require("../db/models/subscription.model");
const Stripe = require("stripe");
const stripe = new Stripe(env.stripeSecretKey);
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
    const { fullName, phone } = req.body;

    const user = req.user;
    const updates = {};
    const changes = {
      fullName: user.fullName !== fullName,
      phone: user.phone !== phone,
    };

    if (changes.fullName) updates.fullName = fullName;
    if (changes.phone) updates.phone = phone;

    if (Object.keys(updates).length === 0) {
      return res.json({ same: true });
    }

    await User.findByIdAndUpdate(req.user._id, {
      fullName,
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

    return res.json({ success: true });
  } catch (err) {
    return res.json(err);
  }
};

exports.toggleSocialVisibility = async (req, res) => {
  try {
    const { fieldName, enabled } = req.body;
    const allowed = ["showEmailPro", "showPhonePro", "showInstagram", "showWhatsapp", "showFacebook", "showWebsite"];
    if (!allowed.includes(fieldName)) {
      return res.status(400).json({ error: "Invalid field" });
    }
    await User.findByIdAndUpdate(req.user._id, {
      $set: { [`calendarSettings.${fieldName}`]: !!enabled },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.json(err);
  }
};

exports.createCheckout = async (req, res) => {
  try {
    const PromoCode = require("../db/models/promoCode.model");
    const { promoCode } = req.body || {};

    const sessionParams = {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: env.stripePricePlanPro,
          quantity: 1,
        },
      ],
      client_reference_id: req.user._id.toString(),
      success_url: `${process.env.BASE_URL || "https://gymio.be"}/subscription/success`,
      cancel_url:  `${process.env.BASE_URL || "https://gymio.be"}/subscription`,
    };

    // Appliquer le code promo si fourni
    if (promoCode) {
      const promo = await PromoCode.findOne({
        code: promoCode.trim().toUpperCase(),
        active: true,
      });

      if (promo && !(promo.expiresAt && new Date() > promo.expiresAt) && (promo.maxUses === null || promo.usedCount < promo.maxUses)) {
        // Créer un coupon Stripe à la volée
        const couponParams = { duration: "once" };
        if (promo.discountType === "percent") {
          couponParams.percent_off = promo.discountValue;
        } else {
          couponParams.amount_off = Math.round(promo.discountValue * 100); // centimes
          couponParams.currency = "eur";
        }
        const coupon = await stripe.coupons.create(couponParams);
        sessionParams.discounts = [{ coupon: coupon.id }];

        // Incrémenter usedCount
        await PromoCode.findByIdAndUpdate(promo._id, { $inc: { usedCount: 1 } });
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error("createCheckout error:", err);
    res.status(500).json({ error: "Erreur lors de la création du checkout." });
  }
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
    const { email } = req.body;
    console.log(email);

    const user = await User.findById(req.user._id).select("email");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "Utilisateur non trouvé" });
    }
    console.log(user.email.trim());
    console.log(email.trim());

    if (user.email.trim() !== email.trim()) {
      return res.json({ success: false, message: "Invalid email" });
    }

    // 1. Générer un code (ex: 6 chiffres)
    const verificationCode = Math.floor(100000 + Math.random() * 900000);
    console.log(verificationCode);

    req.session.emailVerificationCode = verificationCode;
    // req.session.pendingEmail = req.body.newEmail;
    await sendEmail(email, "Digital code", String(verificationCode));

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

exports.verificationCode = (req, res) => {
  console.log("OK");

  try {
    const { emailVerificationCode } = req.session;
    const { val } = req.body;
    if (val !== emailVerificationCode) {
      return res.json({ success: true, message: "Code invalid" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ err });
  }
};

exports.editEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email)
      return res.json({ success: false, message: "Email is required" });

    const isEmail = await User.findOne({ email });

    if (isEmail)
      return res.json({
        success: false,
        message: "This email is already taken by another account",
      });

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        email: email.toLowerCase(),
      },
      { new: true },
    );
    return res.json({ success: true, user: updatedUser });
  } catch (err) {
    console.error(err);
    return res.json(err);
  }
};

exports.updateLocation = async (req, res) => {
  try {
    const { street, zip, city, country, iframeUrl, lat, lon, serviceType } = req.body;

    await User.findByIdAndUpdate(req.user._id, {
      location: {
        address: street,
        city,
        zip,
        country,
        iframeUrl,
        lat,
        lon,
        serviceType: serviceType || "sur_place",
      },
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json(err);
  }
};

exports.editDescription = async (req, res) => {
  try {
    const { _id } = req.user;
    const { description } = req.body;
    await User.findByIdAndUpdate(_id, { description });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

exports.updateBusinessType = async (req, res) => {
  try {
    const { businessType } = req.body;
    await User.findByIdAndUpdate(req.user._id, { businessType: businessType || "" });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

// Sauvegarde nom + description + businessType en une seule requête
exports.editBusinessInfo = async (req, res) => {
  try {
    const { businessName, description, businessType } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      businessName: businessName || "",
      description:  description  || "",
      businessType: businessType || "",
    });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

// Upload photo établissement
exports.editBusinessPicture = async (req, res) => {
  try {
    const { filename } = req.file;
    const imagePath = `/uploads/profiles/${filename}`;
    await User.findByIdAndUpdate(req.user._id, { businessPicture: imagePath });
    return res.json({ success: true, path: imagePath });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

exports.sendDeleteCode = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("email");
    if (!user) return res.status(404).json({ success: false });

    const code = Math.floor(100000 + Math.random() * 900000);
    req.session.deleteAccountCode = code;

    await sendEmail(user.email, "Suppression de compte - Code de confirmation", String(code));

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Erreur envoi du code" });
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    const { code } = req.body;
    const { deleteAccountCode } = req.session;

    if (!deleteAccountCode || Number(code) !== Number(deleteAccountCode)) {
      return res.json({ success: false, message: "Code invalide" });
    }

    const userId = req.user._id;

    // Delete related data
    const Company = require("../db/models/company/company.model");
    const DaysOff = require("../db/models/company/daysOff.model");
    const Booking = require("../db/models/book.model");

    const company = await Company.findOne({ owner: userId });
    if (company) {
      await Booking.deleteMany({ company: company._id });
      await DaysOff.deleteMany({ company: company._id });
      await Company.findByIdAndDelete(company._id);
    }

    await Subscription.findOneAndDelete({ user: userId });
    await User.findByIdAndDelete(userId);

    delete req.session.deleteAccountCode;

    req.logout(() => {
      res.json({ success: true });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Erreur suppression" });
  }
};

exports.updateCalendarSettings = async (req, res) => {
  try {
    const {
      pageBg, calBg, accentColor, accentText, dayBg, dayText, btnBg, btnText,
      lang, font, showInfo, showSocials, layoutStyle, pageBgType, pageBgImage
    } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      calendarSettings: {
        pageBg, calBg, accentColor, accentText, dayBg, dayText, btnBg, btnText,
        lang, font, showInfo, showSocials, layoutStyle, pageBgType,
        pageBgImage: pageBgImage || ''
      }
    });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

exports.editCalendarBgImage = async (req, res) => {
  try {
    const { filename } = req.file;
    const imagePath = `/uploads/profiles/${filename}`;
    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        'calendarSettings.pageBgImage': imagePath,
        'calendarSettings.pageBgType':  'image',
      }
    });
    return res.json({ success: true, path: imagePath });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

// ── URL personnalisée (slug) ───────────────────────────────────────────────────
exports.updateSlug = async (req, res) => {
  try {
    const Company = require("../db/models/company/company.model");
    const { slug } = req.body;

    if (!slug || !/^[a-z0-9-]{3,60}$/.test(slug)) {
      return res.status(400).json({
        error: "Le slug doit contenir entre 3 et 60 caractères (lettres minuscules, chiffres, tirets).",
      });
    }

    // Trouver la company de l'utilisateur
    const company = await Company.findOne({ owner: req.user._id });
    if (!company) return res.status(404).json({ error: "Company introuvable." });

    // Vérifier l'unicité
    const existing = await Company.findOne({ slug });
    if (existing && String(existing._id) !== String(company._id)) {
      return res.json({ error: "Ce nom d'URL est déjà utilisé par quelqu'un d'autre." });
    }

    await Company.findByIdAndUpdate(company._id, { slug });
    return res.json({ success: true, slug });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ── Vérifier disponibilité du slug (AJAX) ─────────────────────────────────────
exports.checkSlug = async (req, res) => {
  try {
    const Company = require("../db/models/company/company.model");
    const { slug } = req.query;

    if (!slug || !/^[a-z0-9-]{3,60}$/.test(slug)) {
      return res.json({ available: false, error: "Format invalide." });
    }

    const myCompany = await Company.findOne({ owner: req.user._id }).lean();
    const existing = await Company.findOne({ slug }).lean();

    if (!existing || (myCompany && String(existing._id) === String(myCompany._id))) {
      return res.json({ available: true });
    }
    return res.json({ available: false });
  } catch (err) {
    return res.status(500).json({ available: false });
  }
};
