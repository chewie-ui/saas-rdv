const bcrypt = require("bcrypt");
const Client = require("../db/models/client.model");
const Booking = require("../db/models/book.model");

// ─── REGISTER ────────────────────────────────────────────────────────────────

exports.getRegister = (req, res) => {
  if (req.session.clientId) return res.redirect("/espace-client");
  res.render("client/client-register", {
    title: "Créer un compte — BranShee",
    alwaysSticky: true,
    clientAuth: true,
    error: null,
  });
};

exports.postRegister = async (req, res) => {
  const isAjax = req.headers["x-requested-with"] === "fetch";
  const { fullName, email, phone, password, confirmPassword } = req.body;

  function fail(msg) {
    if (isAjax) return res.status(400).json({ error: msg });
    return res.render("client/client-register", {
      title: "Créer un compte — BranShee",
      alwaysSticky: true,
      clientAuth: true,
      error: msg,
    });
  }

  if (!fullName || !email || !password)
    return fail("Veuillez remplir tous les champs obligatoires.");

  if (password !== confirmPassword)
    return fail("Les mots de passe ne correspondent pas.");

  if (password.length < 8 || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password))
    return fail("Mot de passe trop faible : 8 caractères minimum, avec au moins 1 chiffre et 1 caractère spécial (!, @, #…).");

  const existing = await Client.findOne({ email: email.toLowerCase().trim() });
  if (existing) return fail("Cette adresse email est déjà utilisée.");

  const hashed = await bcrypt.hash(password, 10);
  const client = await Client.create({
    fullName: fullName.trim(),
    email: email.toLowerCase().trim(),
    password: hashed,
    phone: phone || "",
  });

  // Lier les bookings existants avec cet email au compte client
  await Booking.updateMany(
    { email: client.email, clientRef: null },
    { clientRef: client._id }
  );

  req.session.clientId = client._id.toString();
  if (isAjax) return res.json({ success: true, redirect: "/espace-client" });
  return res.redirect("/espace-client");
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────

exports.getLogin = (req, res) => {
  if (req.session.clientId) return res.redirect("/espace-client");
  res.render("client/client-login", {
    title: "Connexion client — BranShee",
    alwaysSticky: true,
    clientAuth: true,
    error: null,
  });
};

exports.postLogin = async (req, res) => {
  const isAjax = req.headers["x-requested-with"] === "fetch";
  const { email, password } = req.body;

  function fail(msg) {
    if (isAjax) return res.status(400).json({ error: msg });
    return res.render("client/client-login", {
      title: "Connexion client — BranShee",
      alwaysSticky: true,
      clientAuth: true,
      error: msg,
    });
  }

  const client = await Client.findOne({ email: email?.toLowerCase().trim() });
  if (!client) return fail("Email ou mot de passe incorrect.");

  const match = await bcrypt.compare(password, client.password);
  if (!match) return fail("Email ou mot de passe incorrect.");

  req.session.clientId = client._id.toString();

  // Apply preferred language if set
  if (client.preferredLang) {
    res.cookie("user_lang", client.preferredLang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });
  }

  if (isAjax) return res.json({ success: true, redirect: "/espace-client" });
  return res.redirect("/espace-client");
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────

exports.logout = (req, res) => {
  req.session.clientId = null;
  res.redirect("/");
};

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

exports.getDashboard = async (req, res) => {
  const Company = require("../db/models/company/company.model");
  const Review  = require("../db/models/review.model");
  const client = req.client;
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const allBookings = await Booking.find({ clientRef: client._id })
    .sort({ date: -1 })
    .lean();

  // Charger toutes les companies liées + leur owner (pour businessName, photo, adresse)
  const companyIds = [...new Set(allBookings.map(b => b.company?.toString()).filter(Boolean))];
  const companies  = await Company.find({ _id: { $in: companyIds } })
    .populate("owner", "fullName businessName businessType businessPicture profilePicture description location phone phonePro emailPro website")
    .select("_id owner slug cancellationPolicy")
    .lean();

  const companyMap = {};
  companies.forEach(c => { companyMap[c._id.toString()] = c; });

  const enriched = allBookings.map(b => {
    const comp  = companyMap[b.company?.toString()];
    const owner = comp?.owner || null;
    return {
      ...b,
      companySlug:        comp ? (comp.slug || comp._id.toString()) : null,
      companyName:        owner ? (owner.businessName || owner.fullName || "Professionnel") : "Professionnel",
      companyType:        owner?.businessType || "",
      companyPhoto:       owner ? (owner.businessPicture || owner.profilePicture || "/images/no-user.webp") : "/images/no-user.webp",
      // `location` peut être un objet {address,city,…} (format courant) ou
      // un String hérité (vieilles données) — on gère les deux cas.
      companyCity:        (typeof owner?.location === "object" ? owner.location?.city  : "") || "",
      companyAddr:        (typeof owner?.location === "object" ? owner.location?.address : (typeof owner?.location === "string" ? owner.location : "")) || "",
      companyZip:         (typeof owner?.location === "object" ? owner.location?.zip   : "") || "",
      companyLat:         (typeof owner?.location === "object" ? owner.location?.lat   : "") || "",
      companyLon:         (typeof owner?.location === "object" ? owner.location?.lon   : "") || "",
      companyPhone:       owner ? (owner.phonePro || owner.phone || "") : "",
      companyEmail:       owner?.emailPro || "",
      companyWebsite:     owner?.website || "",
      cancellationRule:   comp?.cancellationPolicy?.rule || "free",
    };
  });

  const upcoming = enriched.filter(
    (b) => new Date(b.date) >= now && b.status === "confirmed"
  );
  const past = enriched.filter(
    (b) => new Date(b.date) < now || b.status === "canceled"
  );

  // ── Avis du client ──────────────────────────────────────────────────────
  const myReviews = await Review.find({ client: client._id })
    .sort({ createdAt: -1 })
    .lean();

  // Enrichir les avis avec le nom/slug de l'établissement
  const reviewCompanyIds = [...new Set(myReviews.map(r => r.company?.toString()).filter(Boolean))];
  const reviewCompanies  = await Company.find({ _id: { $in: reviewCompanyIds } })
    .populate("owner", "fullName businessName businessPicture profilePicture")
    .select("_id owner slug")
    .lean();
  const reviewCompanyMap = {};
  reviewCompanies.forEach(c => { reviewCompanyMap[c._id.toString()] = c; });

  const myReviewsEnriched = myReviews.map(r => {
    const comp  = reviewCompanyMap[r.company?.toString()];
    const owner = comp?.owner || null;
    return {
      ...r,
      companySlug: comp ? (comp.slug || comp._id.toString()) : null,
      companyName: owner ? (owner.businessName || owner.fullName || "Établissement") : "Établissement",
      companyPhoto: owner ? (owner.businessPicture || owner.profilePicture || "/images/no-user.webp") : "/images/no-user.webp",
    };
  });

  // Marquer les RDV passés pour lesquels le client a déjà posté un avis
  const reviewedCompanyIds = new Set(myReviews.map(r => r.company?.toString()).filter(Boolean));

  return res.render("client/client-dashboard", {
    title: "Mon espace — BranShee",
    pageName: "Mes rendez-vous",
    client,
    bookings: { upcoming, past },
    myReviews: myReviewsEnriched,
    reviewedCompanyIds: [...reviewedCompanyIds],
  });
};

// ─── SETTINGS ────────────────────────────────────────────────────────────────

exports.getSettings = (req, res) => {
  return res.render("client/client-settings", {
    title: "Paramètres — BranShee",
    pageName: "Paramètres",
    client: req.client,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

// POST /espace-client/parametres/profile
exports.updateProfile = async (req, res) => {
  try {
    const { fullName, phone, location, languages, emailNotifications } = req.body;

    if (!fullName || fullName.trim().length < 2) {
      return res.redirect("/espace-client/parametres?error=invalid_name");
    }

    // languages peut être une string (1 valeur) ou un tableau
    let parsedLanguages = [];
    if (languages) {
      parsedLanguages = Array.isArray(languages) ? languages : [languages];
    }

    await Client.findByIdAndUpdate(req.client._id, {
      fullName: fullName.trim(),
      phone: phone?.trim() || "",
      location: location?.trim() || "",
      languages: parsedLanguages,
      emailNotifications: emailNotifications === "on",
    });

    return res.redirect("/espace-client/parametres?success=profile");
  } catch (err) {
    console.error(err);
    return res.redirect("/espace-client/parametres?error=server");
  }
};

// PATCH /espace-client/parametres/picture (multipart, via multer)
exports.updateClientPicture = async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, error: "Aucun fichier" });

    const imagePath = `/uploads/profiles/${req.file.filename}`;
    await Client.findByIdAndUpdate(req.client._id, { profilePicture: imagePath });

    return res.json({ success: true, path: imagePath });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
};

// POST /espace-client/parametres/email
exports.updateClientEmail = async (req, res) => {
  try {
    const { newEmail, passwordConfirm } = req.body;

    if (!newEmail || !passwordConfirm) {
      return res.redirect("/espace-client/parametres?error=missing_fields#compte");
    }

    const normalizedEmail = newEmail.toLowerCase().trim();

    // Vérifier le mot de passe
    const client = await Client.findById(req.client._id);
    const match = await bcrypt.compare(passwordConfirm, client.password);
    if (!match) {
      return res.redirect("/espace-client/parametres?error=wrong_password#compte");
    }

    // Vérifier si l'email est déjà pris
    const existing = await Client.findOne({ email: normalizedEmail });
    if (existing && existing._id.toString() !== req.client._id.toString()) {
      return res.redirect("/espace-client/parametres?error=email_taken#compte");
    }

    await Client.findByIdAndUpdate(req.client._id, { email: normalizedEmail });

    return res.redirect("/espace-client/parametres?success=email");
  } catch (err) {
    console.error(err);
    return res.redirect("/espace-client/parametres?error=server#compte");
  }
};

// POST /espace-client/parametres/password
exports.updateClientPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.redirect("/espace-client/parametres?error=missing_fields#securite");
    }

    if (newPassword !== confirmPassword) {
      return res.redirect("/espace-client/parametres?error=password_mismatch#securite");
    }

    if (newPassword.length < 8) {
      return res.redirect("/espace-client/parametres?error=password_too_short#securite");
    }

    const client = await Client.findById(req.client._id);
    const match = await bcrypt.compare(currentPassword, client.password);
    if (!match) {
      return res.redirect("/espace-client/parametres?error=wrong_password#securite");
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await Client.findByIdAndUpdate(req.client._id, { password: hashed });

    return res.redirect("/espace-client/parametres?success=password");
  } catch (err) {
    console.error(err);
    return res.redirect("/espace-client/parametres?error=server#securite");
  }
};

// POST /espace-client/parametres/language
exports.updateClientLang = async (req, res) => {
  try {
    const { lang } = req.body;
    const allowed = ["fr", "en", "nl", "de", "es", "it"];
    if (!allowed.includes(lang)) {
      return res.redirect("/espace-client/parametres?error=invalid_lang");
    }

    await Client.findByIdAndUpdate(req.client._id, { preferredLang: lang });

    // Set the cookie immediately so the UI refreshes in the new language
    res.cookie("user_lang", lang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });

    return res.redirect("/espace-client/parametres?success=language");
  } catch (err) {
    console.error(err);
    return res.redirect("/espace-client/parametres?error=server");
  }
};
