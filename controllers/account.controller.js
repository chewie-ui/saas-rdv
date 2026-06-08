const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const User = require("../db/models/user.model");
const Subscription = require("../db/models/subscription.model");
const Stripe = require("stripe");
const stripe = new Stripe(env.stripeSecretKey);
const bcrypt = require("bcrypt");
const { sendEmail } = require("../utils/mailer");
const pug  = require("pug");
const path = require("path");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { sanitizeRichText } = require("../utils/sanitizeRichText");

// ── Limites par plan ─────────────────────────────────────────────────────────
const PLAN_LIMITS = {
  basic:    { employees: 0, services: 0, formQuestions: 0 },
  free:     { employees: 0, services: 0, formQuestions: 0 },
  pro:      { employees: 2, services: 10, formQuestions: 3 },
  business: { employees: 10, services: 50, formQuestions: 10 },
};

/**
 * Applique les limites du plan en désactivant/supprimant ce qui dépasse.
 * Appelé automatiquement après chaque changement de plan.
 */
exports.enforcePlanLimits = async (userId, planName) => {
  try {
    const Employee = require("../db/models/company/employee.model");
    const Service  = require("../db/models/company/service.model");
    const Form     = require("../db/models/form.model");
    const Company  = require("../db/models/company/company.model");

    const limits = PLAN_LIMITS[planName] || PLAN_LIMITS.basic;
    const user   = await User.findById(userId).select("company").lean();
    if (!user?.company) return;

    const companyId = user.company;

    // ── Employés ─────────────────────────────────────────────────────────────
    if (limits.employees === 0) {
      // Free/Basic : désactiver tous les employés
      await Employee.updateMany({ company: companyId }, { active: false });
    } else {
      // Garder les N premiers actifs (triés par date de création), désactiver le reste
      const allActive = await Employee.find({ company: companyId, active: true })
        .sort({ createdAt: 1 }).lean();
      if (allActive.length > limits.employees) {
        const toDisable = allActive.slice(limits.employees).map(e => e._id);
        await Employee.updateMany({ _id: { $in: toDisable } }, { active: false });
      }
    }

    // ── Services ──────────────────────────────────────────────────────────────
    if (limits.services === 0) {
      await Service.updateMany({ company: companyId }, { active: false });
    } else {
      const allActive = await Service.find({ company: companyId, active: true })
        .sort({ order: 1, createdAt: 1 }).lean();
      if (allActive.length > limits.services) {
        const toDisable = allActive.slice(limits.services).map(s => s._id);
        await Service.updateMany({ _id: { $in: toDisable } }, { active: false });
      }
    }

    // ── Questions de formulaire ───────────────────────────────────────────────
    const form = await Form.findOne({ company: companyId });
    if (form && form.questions && form.questions.length > limits.formQuestions) {
      if (limits.formQuestions === 0) {
        form.questions = [];
        form.active = false;
      } else {
        // Garder les N premières questions (triées par order)
        form.questions = form.questions
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .slice(0, limits.formQuestions);
      }
      await form.save();
    }

    console.log(`✅ [enforcePlanLimits] Limites "${planName}" appliquées pour user ${userId}`);
  } catch (err) {
    console.error("[enforcePlanLimits] Erreur:", err.message);
  }
};

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

    const allowed = ["emailPro", "phonePro", "instagramLink", "whatsappLink", "facebookLink", "website"];
    if (!allowed.includes(fieldName)) {
      return res.status(400).json({ error: "Champ invalide." });
    }

    const val = (fieldValue || "").trim();

    // ── Validation selon le type de champ ────────────────────────────────
    if (val !== "") {
      if (fieldName === "emailPro") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          return res.status(400).json({ error: "Adresse email invalide. Ex: contact@monactivite.com" });
        }
      } else if (fieldName === "phonePro") {
        // Accepte +32 476 12 34 56, 0476123456, etc.
        if (!/^\+?[\d\s\-().]{6,20}$/.test(val)) {
          return res.status(400).json({ error: "Numéro invalide. Ex: +32 476 12 34 56" });
        }
      } else if (fieldName === "whatsappLink") {
        // Accepte un numéro OU un lien https://wa.link/... ou https://wa.me/...
        const isWaUrl  = /^https?:\/\/(wa\.link|wa\.me|api\.whatsapp\.com)\/.+/.test(val);
        const isPhone  = /^\+?[\d\s\-().]{6,20}$/.test(val);
        if (!isWaUrl && !isPhone) {
          return res.status(400).json({ error: "WhatsApp invalide. Ex: +32 476 12 34 56 ou https://wa.link/votreCode" });
        }
      } else {
        // instagramLink, facebookLink, website → doit être une URL valide
        if (!/^https?:\/\/.+\..+/.test(val)) {
          return res.status(400).json({ error: "Lien invalide. Il doit commencer par https:// (ex: https://instagram.com/moncompte)" });
        }
      }
    }

    await User.findByIdAndUpdate(req.user._id, { [fieldName]: val });
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
    const { promoCode, plan, billing } = req.body || {};

    // Choisir le bon price ID selon le plan et la période
    let priceId;
    if (plan === "business") {
      if (billing === "yearly")     priceId = env.stripePriceBusinessYearly;
      else if (billing === "sixmonths") priceId = env.stripePriceBusinessSixMonths;
      else                          priceId = env.stripePriceBusinessMonthly;
    } else {
      if (billing === "yearly")     priceId = env.stripePricePremiumYearly;
      else if (billing === "sixmonths") priceId = env.stripePricePremiumSixMonths;
      else                          priceId = env.stripePricePremiumMonthly;
    }
    if (!priceId) {
      return res.status(400).json({ error: "Prix non configuré pour ce plan. Contactez le support." });
    }

    const planName = plan === "business" ? "business" : "pro";

    // ── Upgrade via Stripe subscription update (proration automatique) ────────
    const existingSub = await Subscription.findOne({
      user: req.user._id,
      status: "active",
      stripeSubscriptionId: { $exists: true, $ne: null },
    }).lean();

    if (existingSub?.stripeSubscriptionId) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(existingSub.stripeSubscriptionId);
        // S'assurer que l'abonnement est actif en live (pas annulé, pas test)
        if (stripeSub.status !== "active" && stripeSub.status !== "trialing") {
          throw new Error(`Subscription status invalide: ${stripeSub.status}`);
        }
        const itemId = stripeSub.items.data[0]?.id;

        if (itemId) {
          await stripe.subscriptions.update(existingSub.stripeSubscriptionId, {
            items: [{ id: itemId, price: priceId }],
            proration_behavior: "create_prorations",
          });

          await User.findByIdAndUpdate(req.user._id, {
            isPremium: true,
            "subscription.plan":   planName,
            "subscription.status": "active",
          });
          await Subscription.findByIdAndUpdate(existingSub._id, { plan: planName });

          if (req.user) {
            req.user.isPremium = true;
            if (req.user.subscription) req.user.subscription.plan = planName;
          }

          console.log(`✅ Upgrade inline vers ${planName} pour user ${req.user._id}`);
          return res.json({ upgraded: true, plan: planName });
        }
      } catch (upgradeErr) {
        console.error("Subscription update failed, fallback to checkout:", upgradeErr.message);
        // Nettoyer l'ID invalide en base pour éviter de le réutiliser
        await Subscription.findByIdAndUpdate(existingSub._id, { status: "superseded" }).catch(() => {});
      }
    }

    // ── Nouveau checkout (premier abonnement) ─────────────────────────────────
    const sessionParams = {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: req.user._id.toString(),
      // Stocker le plan dans metadata → fallback fiable dans paymentVerification
      metadata: { plan: planName, userId: req.user._id.toString() },
      subscription_data: { metadata: { plan: planName, userId: req.user._id.toString() } },
      // Pour les achats 0€ (coupon 100%) : ne pas forcer la carte si inutile
      payment_method_collection: "if_required",
      success_url: `${env.stripeSuccessUrl || "https://branshee.com"}`,
      cancel_url:  `${env.stripeCancelUrl  || "https://branshee.com"}`,
    };

    // Lier au customer Stripe existant — avec vérification qu'il existe réellement
    // (le customer peut avoir été créé en mode test et ne pas exister en live)
    const existingStripeCustomerId = req.user.subscription?.stripeCustomerId;
    if (existingStripeCustomerId) {
      try {
        await stripe.customers.retrieve(existingStripeCustomerId);
        // Customer valide → on l'utilise
        sessionParams.customer = existingStripeCustomerId;
      } catch (custErr) {
        // Customer introuvable (test→live, ou supprimé) → créer un nouveau
        console.warn(`Customer Stripe invalide (${existingStripeCustomerId}), création d'un nouveau...`);
        const newCustomer = await stripe.customers.create({
          email: req.user.email,
          name:  req.user.fullName || req.user.email,
          metadata: { userId: req.user._id.toString() },
        });
        // Sauvegarder le nouvel ID en base
        await User.findByIdAndUpdate(req.user._id, {
          "subscription.stripeCustomerId": newCustomer.id,
        });
        sessionParams.customer = newCustomer.id;
      }
    } else {
      sessionParams.customer_email = req.user.email;
    }

    // Appliquer le code promo si fourni
    if (promoCode) {
      const promo = await PromoCode.findOne({
        code: promoCode.trim().toUpperCase(),
        active: true,
      });

      const userId = req.user._id;
      const alreadyUsed = promo?.usedByUsers?.some((uid) => String(uid) === String(userId));

      if (
        promo &&
        !alreadyUsed &&
        !(promo.expiresAt && new Date() > promo.expiresAt) &&
        (promo.maxUses === null || promo.usedCount < promo.maxUses)
      ) {
        if (promo.discountType === "trial") {
          // ── Essai gratuit → trial_period_days Stripe ──────────────────────────
          // Correct pour mensuel ET annuel : X jours offerts, puis plein tarif
          const days = promo.trialDays || 30;
          sessionParams.subscription_data = {
            ...sessionParams.subscription_data,
            trial_period_days: days,
          };
          // Pour un trial, la carte est toujours requise (sera débitée après le trial)
          sessionParams.payment_method_collection = "always";
        } else {
          // ── Réduction % ou € → coupon sur 1ère facture uniquement ────────────
          // Pour les plans ANNUELS avec un % de réduction :
          // on ne veut pas réduire toute l'année mais seulement l'équivalent d'1 mois.
          // On convertit donc en montant fixe = prix_mensuel × (% / 100).
          const MONTHLY_PRICES = {
            pro:      env.stripePricePremiumMonthly  ? 19 : 19,
            business: env.stripePriceBusinessMonthly ? 49 : 49,
          };
          const isYearly = billing === "yearly";
          const couponParams = { duration: "once" };

          if (promo.discountType === "percent" && isYearly) {
            // Calculer la réduction en euros = 1 mois de réduction au % demandé
            const monthlyPrice = MONTHLY_PRICES[planName] || 19;
            const discountEuros = Math.round(monthlyPrice * promo.discountValue / 100 * 100) / 100;
            couponParams.amount_off = Math.round(discountEuros * 100); // centimes
            couponParams.currency   = "eur";
          } else if (promo.discountType === "percent") {
            couponParams.percent_off = Math.min(promo.discountValue, 99);
          } else {
            couponParams.amount_off = Math.round(promo.discountValue * 100);
            couponParams.currency = "eur";
          }
          const coupon = await stripe.coupons.create(couponParams);
          sessionParams.discounts = [{ coupon: coupon.id }];
        }

        // Enregistrer l'utilisation
        await PromoCode.findByIdAndUpdate(promo._id, {
          $inc: { usedCount: 1 },
          $addToSet: { usedByUsers: userId },
        });
      }
    }

    // Afficher le champ "Code promo" natif de Stripe — au cas où l'utilisateur
    // n'aurait pas vu/utilisé celui du site. Stripe interdit de combiner
    // `allow_promotion_codes` avec un `discounts` déjà appliqué côté serveur,
    // donc on ne l'active que si aucun coupon n'a été injecté ci-dessus.
    if (!sessionParams.discounts) {
      sessionParams.allow_promotion_codes = true;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error("createCheckout error:", err.message || err);
    const stripeMsg = err.raw?.message || err.message || "Erreur lors de la création du checkout.";
    res.status(500).json({ error: stripeMsg });
  }
};

exports.updatePassword = async (req, res) => {
  const isAjax = req.headers["x-requested-with"] === "fetch" || req.headers["content-type"]?.includes("application/json");
  try {
    const userId = req.user._id;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      if (isAjax) return res.status(400).json({ error: "Champs requis manquants." });
      return res.redirect("/settings?error=missing_fields#securite");
    }

    if (newPassword.length < 8) {
      if (isAjax) return res.status(400).json({ error: "Le mot de passe doit contenir au moins 8 caractères." });
      return res.redirect("/settings?error=pwd_too_short#securite");
    }

    const user = await User.findById(userId);
    const isMatch = await bcrypt.compare(oldPassword, user.password);

    if (!isMatch) {
      if (isAjax) return res.status(400).json({ error: "Mot de passe actuel incorrect." });
      return res.redirect("/settings?error=wrong_password#securite");
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();

    if (isAjax) return res.json({ success: true });
    return res.redirect("/settings?success=password");
  } catch (err) {
    console.error(err);
    if (isAjax) return res.status(500).json({ error: "Erreur serveur." });
    return res.redirect("/settings?error=server#securite");
  }
};

// ── Acheter l'add-on URL personnalisée (+5€/mois) ─────────────────────────────
exports.purchaseAddonCustomUrl = async (req, res) => {
  try {
    // Vérifier que l'utilisateur est au moins Pro
    const { getPlan } = require("../utils/planLimits");
    const plan = getPlan(req.user);
    if (plan !== "pro" && plan !== "business") {
      return res.status(400).json({ error: "Vous devez être au moins sur le plan Pro pour acheter cet add-on." });
    }
    // Si déjà Business, l'URL est incluse
    if (plan === "business") {
      return res.status(400).json({ error: "Vous êtes déjà sur le plan Business, l'URL personnalisée est incluse." });
    }
    // Vérifier que l'add-on n'est pas déjà actif
    if (req.user.addons && req.user.addons.customUrl) {
      return res.status(400).json({ error: "Vous avez déjà cet add-on." });
    }

    const priceId = env.stripePriceAddonCustomUrl;
    if (!priceId) {
      return res.status(500).json({ error: "Prix non configuré. Contactez le support." });
    }

    // Récupérer ou créer le customer Stripe
    let customerId = req.user.subscription?.stripeCustomerId;
    if (customerId) {
      try { await stripe.customers.retrieve(customerId); }
      catch (_) { customerId = null; }
    }
    if (!customerId) {
      const c = await stripe.customers.create({
        email: req.user.email,
        name:  req.user.fullName || req.user.email,
        metadata: { userId: req.user._id.toString() },
      });
      customerId = c.id;
      await User.findByIdAndUpdate(req.user._id, { "subscription.stripeCustomerId": customerId });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer: customerId,
      client_reference_id: req.user._id.toString(),
      metadata: { addon: "customUrl", userId: req.user._id.toString() },
      subscription_data: { metadata: { addon: "customUrl", userId: req.user._id.toString() } },
      allow_promotion_codes: true,
      success_url: `${env.appBaseUrl || "https://www.branshee.com"}/appointment?addonSuccess=customUrl`,
      cancel_url:  `${env.appBaseUrl || "https://www.branshee.com"}/customize`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("purchaseAddonCustomUrl error:", err.message);
    res.status(500).json({ error: err.raw?.message || err.message });
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    // Only look for an active subscription with a real Stripe ID
    const subscription = await Subscription.findOne({
      user: req.user._id,
      status: "active",
      stripeSubscriptionId: { $exists: true, $ne: null },
    });

    if (!subscription) {
      return res.status(400).json({ error: "No active subscription found." });
    }

    // Guard: already scheduled for cancellation → don't call Stripe again
    if (!subscription.autoRenew) {
      return res.json({
        success: true,
        message: "Subscription is already scheduled for cancellation.",
      });
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
    res.status(500).json({ error: "An error occurred while canceling your subscription." });
  }
};

exports.editEmailConfirmation = async (req, res) => {
  try {
    const { email } = req.body;
    console.log(email);

    const user = await User.findById(req.user._id).select("email");

    if (!user) {
      return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
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
    const verifyHtml = pug.renderFile(
      path.join(__dirname, "../views/templates/emails/verification-code.pug"),
      { code: verificationCode, subject: "Vérification de votre adresse e-mail", body: "Voici votre code de vérification pour modifier votre adresse e-mail :" }
    );
    await sendEmail(email, "Vérification de votre adresse e-mail — BranShee", verifyHtml);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: "Impossible d'envoyer le mail" });
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

    if (!email) return res.json({ success: false, message: "Email is required" });

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
    const { street, zip, city, country, iframeUrl, lat, lon, serviceType, gmapUrl } = req.body;

    await User.findByIdAndUpdate(req.user._id, {
      location: {
        address: street,
        city,
        zip,
        country,
        iframeUrl,
        lat,
        lon,
        gmapUrl:     gmapUrl     || "",
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
      description: description || "",
      businessType: businessType || "",
    });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

// ── « À propos » enrichi (mini éditeur WYSIWYG : gras, italique, taille) ─────
// Le HTML envoyé par l'éditeur est nettoyé (allow-list) avant d'être stocké,
// pour pouvoir être réinjecté tel quel (sans échappement) sur la page publique.
exports.updateAbout = async (req, res) => {
  try {
    const raw = typeof req.body.aboutHtml === "string" ? req.body.aboutHtml : "";
    const clean = sanitizeRichText(raw).slice(0, 4000);
    await User.findByIdAndUpdate(req.user._id, { aboutHtml: clean });
    return res.json({ success: true, aboutHtml: clean });
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

    const deleteHtml = pug.renderFile(
      path.join(__dirname, "../views/templates/emails/verification-code.pug"),
      { code, subject: "Suppression de compte — Confirmation", body: "Voici votre code de confirmation pour supprimer définitivement votre compte BranShee :" }
    );
    await sendEmail(user.email, "Suppression de compte — Code de confirmation BranShee", deleteHtml);

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
      lang, font, showInfo, showSocials, layoutStyle, pageBgType, pageBgImage,
      showSectionAbout, showSectionServices, showSectionTeam,
      showSectionReviews, showSectionAmenities, showSectionFaq,
    } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        "calendarSettings.pageBg":               pageBg,
        "calendarSettings.calBg":                calBg,
        "calendarSettings.accentColor":          accentColor,
        "calendarSettings.accentText":           accentText,
        "calendarSettings.dayBg":                dayBg,
        "calendarSettings.dayText":              dayText,
        "calendarSettings.btnBg":                btnBg,
        "calendarSettings.btnText":              btnText,
        "calendarSettings.lang":                 lang,
        "calendarSettings.font":                 font,
        "calendarSettings.showInfo":             showInfo,
        "calendarSettings.showSocials":          showSocials,
        "calendarSettings.layoutStyle":          layoutStyle,
        "calendarSettings.pageBgType":           pageBgType,
        "calendarSettings.pageBgImage":          pageBgImage || "",
        "calendarSettings.showSectionAbout":     showSectionAbout    !== false,
        "calendarSettings.showSectionServices":  !!showSectionServices,
        "calendarSettings.showSectionTeam":      !!showSectionTeam,
        "calendarSettings.showSectionReviews":   !!showSectionReviews,
        "calendarSettings.showSectionAmenities": !!showSectionAmenities,
        "calendarSettings.showSectionFaq":       !!showSectionFaq,
      },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

exports.updateGallery = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.json({ success: false, message: "No files uploaded" });
    }
    const paths = req.files.map((f) => `/uploads/profiles/${f.filename}`);
    await User.findByIdAndUpdate(req.user._id, {
      $push: { "calendarSettings.gallery": { $each: paths } },
    });
    return res.json({ success: true, paths });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

exports.deleteGalleryPhoto = async (req, res) => {
  try {
    const index = parseInt(req.params.index, 10);
    const user = await User.findById(req.user._id).select("calendarSettings.gallery");
    const gallery = (user.calendarSettings && user.calendarSettings.gallery) || [];
    if (index < 0 || index >= gallery.length) {
      return res.json({ success: false, message: "Index out of bounds" });
    }
    gallery.splice(index, 1);
    await User.findByIdAndUpdate(req.user._id, {
      $set: { "calendarSettings.gallery": gallery },
    });
    return res.json({ success: true, gallery });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

exports.updateAmenities = async (req, res) => {
  try {
    const { cleanliness, comfort, practical } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        "calendarSettings.amenities.cleanliness": Array.isArray(cleanliness) ? cleanliness : [],
        "calendarSettings.amenities.comfort":     Array.isArray(comfort)     ? comfort     : [],
        "calendarSettings.amenities.practical":   Array.isArray(practical)   ? practical   : [],
      },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

exports.updateFaq = async (req, res) => {
  try {
    const { faq } = req.body;
    const entries = Array.isArray(faq) ? faq : [];
    await User.findByIdAndUpdate(req.user._id, {
      $set: { "calendarSettings.faq": entries },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

exports.updateBadges = async (req, res) => {
  try {
    const { badges } = req.body;
    const list = Array.isArray(badges) ? badges : [];
    await User.findByIdAndUpdate(req.user._id, {
      $set: { "calendarSettings.badges": list },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.json({ success: false });
  }
};

exports.toggleSection = async (req, res) => {
  try {
    const { fieldName, enabled } = req.body;
    const allowed = [
      "showSectionAbout", "showSectionServices", "showSectionTeam",
      "showSectionReviews", "showSectionAmenities", "showSectionFaq",
      "showSectionGallery", "showSectionMap", "showSectionHours",
    ];
    if (!allowed.includes(fieldName)) return res.status(400).json({ error: "Invalid field" });
    await User.findByIdAndUpdate(req.user._id, {
      $set: { [`calendarSettings.${fieldName}`]: !!enabled },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: false });
  }
};

exports.updateEquipment = async (req, res) => {
  try {
    const { equipment } = req.body;
    await User.findByIdAndUpdate(req.user._id, {
      $set: { "calendarSettings.equipment": Array.isArray(equipment) ? equipment : [] },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: false });
  }
};

exports.updateCategories = async (req, res) => {
  try {
    const { categories } = req.body;
    if (!Array.isArray(categories)) return res.json({ success: false });
    const clean = categories
      .filter(c => c && typeof c.name === "string" && c.name.trim())
      .map(c => ({ name: c.name.trim(), icon: (c.icon || "").slice(0, 10) }));
    await User.findByIdAndUpdate(req.user._id, {
      $set: { "calendarSettings.categories": clean },
    });
    return res.json({ success: true, categories: clean });
  } catch (err) {
    return res.json({ success: false });
  }
};

exports.updateBookingCategoryStyle = async (req, res) => {
  try {
    const { style } = req.body;
    const allowed = ["pills", "accordion", "grid"];
    if (!allowed.includes(style)) return res.json({ success: false });
    await User.findByIdAndUpdate(req.user._id, {
      $set: { "calendarSettings.bookingCategoryStyle": style },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: false });
  }
};

exports.updateGalleryLayout = async (req, res) => {
  try {
    const { layout } = req.body;
    const allowed = ["grid", "carousel"];
    if (!allowed.includes(layout)) return res.json({ success: false });
    await User.findByIdAndUpdate(req.user._id, {
      $set: { "calendarSettings.galleryLayout": layout },
    });
    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: false });
  }
};

exports.editCalendarBgImage = async (req, res) => {
  try {
    const { filename } = req.file;
    const imagePath = `/uploads/profiles/${filename}`;
    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        "calendarSettings.pageBgImage": imagePath,
        "calendarSettings.pageBgType": "image",
      },
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

// ── Créer un SetupIntent pour ajouter une carte ───────────────────────────────
exports.createSetupIntent = async (req, res) => {
  try {
    let stripeCustomerId = req.user.subscription?.stripeCustomerId;

    // Vérifier que le customer existe encore dans le compte Stripe actuel
    if (stripeCustomerId) {
      try {
        await stripe.customers.retrieve(stripeCustomerId);
      } catch (e) {
        // Customer introuvable (ex: changement de compte Stripe) → on en recrée un
        if (e.code === "resource_missing") {
          console.warn("Customer Stripe introuvable, recréation...", stripeCustomerId);
          stripeCustomerId = null;
          await User.findByIdAndUpdate(req.user._id, {
            $unset: { "subscription.stripeCustomerId": "" },
          });
        } else {
          throw e;
        }
      }
    }

    if (!stripeCustomerId) {
      // Créer un customer Stripe si l'utilisateur n'en a pas encore
      const customer = await stripe.customers.create({
        email:    req.user.email,
        name:     req.user.fullName || req.user.email,
        metadata: { userId: String(req.user._id) },
      });
      stripeCustomerId = customer.id;
      await User.findByIdAndUpdate(req.user._id, {
        "subscription.stripeCustomerId": stripeCustomerId,
      });
    }

    const setupIntent = await stripe.setupIntents.create({
      customer:             stripeCustomerId,
      payment_method_types: ["card"],
      usage:                "off_session", // autorise les renouvellements automatiques hors-session
    });

    return res.json({ clientSecret: setupIntent.client_secret });
  } catch (err) {
    console.error("createSetupIntent error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ── Détacher (supprimer) une carte ────────────────────────────────────────────
exports.detachPaymentMethod = async (req, res) => {
  try {
    const { pmId } = req.params;
    const stripeCustomerId = req.user.subscription?.stripeCustomerId;

    if (!stripeCustomerId) {
      return res.status(403).json({ error: "Aucun compte Stripe associé." });
    }

    // Vérifier que la carte appartient bien à ce client
    let pm;
    try {
      pm = await stripe.paymentMethods.retrieve(pmId);
    } catch (e) {
      return res.status(404).json({ error: "Carte introuvable." });
    }
    if (pm.customer !== stripeCustomerId) {
      return res.status(403).json({ error: "Accès refusé." });
    }

    await stripe.paymentMethods.detach(pmId);
    return res.json({ success: true });
  } catch (err) {
    console.error("detachPaymentMethod error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ── Définir une carte comme moyen de paiement par défaut ─────────────────────
exports.setDefaultPaymentMethod = async (req, res) => {
  try {
    const { pmId } = req.params;
    const stripeCustomerId = req.user.subscription?.stripeCustomerId;

    if (!stripeCustomerId) {
      return res.status(403).json({ error: "Aucun compte Stripe associé." });
    }

    // Vérifier que la carte appartient bien à ce client
    const pm = await stripe.paymentMethods.retrieve(pmId);
    if (pm.customer !== stripeCustomerId) {
      return res.status(403).json({ error: "Accès refusé." });
    }

    // Mettre à jour le customer → factures futures & paiements one-time
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: pmId },
    });

    // Mettre à jour l'abonnement actif si présent
    const stripeSubscriptionId = req.user.subscription?.stripeSubscriptionId;
    if (stripeSubscriptionId) {
      try {
        await stripe.subscriptions.update(stripeSubscriptionId, {
          default_payment_method: pmId,
        });
      } catch (subErr) {
        // Non bloquant : l'abonnement peut ne plus être actif
        console.warn("setDefaultPaymentMethod – subscription update skipped:", subErr.message);
      }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("setDefaultPaymentMethod error:", err.message);
    return res.status(500).json({ error: err.message });
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

// ═══════════════════════════════════════════════════════════════════════════════
// 2FA — Google Authenticator
// ═══════════════════════════════════════════════════════════════════════════════

// POST /account/2fa/setup  → génère un secret temporaire + QR code
exports.setup2FA = async (req, res) => {
  try {
    const secretObj = speakeasy.generateSecret({
      name: `BranShee (${req.user.email})`,
      issuer: "BranShee",
      length: 20,
    });

    const qrDataUrl = await QRCode.toDataURL(secretObj.otpauth_url);

    // Sauvegarder le secret temp (pas encore activé)
    await User.findByIdAndUpdate(req.user._id, { "twoFA.tempSecret": secretObj.base32 });

    return res.json({ success: true, qrDataUrl, secret: secretObj.base32 });
  } catch (err) {
    console.error("setup2FA error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// POST /account/2fa/enable  → vérifie le code et active la 2FA
exports.enable2FA = async (req, res) => {
  try {
    const { code } = req.body;
    const user = await User.findById(req.user._id);

    if (!user.twoFA?.tempSecret) {
      return res.status(400).json({ error: "Aucune configuration en cours. Recommencez." });
    }

    const isValid = speakeasy.totp.verify({
      secret: user.twoFA.tempSecret,
      encoding: "base32",
      token: String(code).replace(/\s/g, ""),
      window: 1,
    });

    if (!isValid) {
      return res.status(400).json({ error: "Code incorrect. Vérifiez votre application." });
    }

    await User.findByIdAndUpdate(req.user._id, {
      "twoFA.enabled":    true,
      "twoFA.secret":     user.twoFA.tempSecret,
      "twoFA.tempSecret": "",
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("enable2FA error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// POST /account/2fa/disable  → désactive la 2FA (vérifie le code courant)
exports.disable2FA = async (req, res) => {
  try {
    const { code } = req.body;
    const user = await User.findById(req.user._id);

    if (!user.twoFA?.enabled) {
      return res.status(400).json({ error: "La 2FA n'est pas activée." });
    }

    const isValid = speakeasy.totp.verify({
      secret: user.twoFA.secret,
      encoding: "base32",
      token: String(code).replace(/\s/g, ""),
      window: 1,
    });

    if (!isValid) {
      return res.status(400).json({ error: "Code incorrect." });
    }

    await User.findByIdAndUpdate(req.user._id, {
      "twoFA.enabled": false,
      "twoFA.secret":  "",
      "twoFA.tempSecret": "",
    });

    return res.json({ success: true });
  } catch (err) {
    console.error("disable2FA error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// Langue de l'interface
// ═══════════════════════════════════════════════════════════════════════════════

// POST /account/language
exports.updateLanguage = async (req, res) => {
  try {
    const { lang } = req.body;
    const allowed = ["fr", "en", "nl", "de", "es", "it"];
    if (!allowed.includes(lang)) {
      return res.status(400).json({ error: "Langue non supportée." });
    }

    await User.findByIdAndUpdate(req.user._id, { preferredLang: lang });
    res.cookie("user_lang", lang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });

    return res.json({ success: true });
  } catch (err) {
    console.error("updateLanguage error:", err.message);
    return res.status(500).json({ error: "Erreur serveur." });
  }
};
