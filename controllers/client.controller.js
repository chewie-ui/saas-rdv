const bcrypt = require("bcrypt");
const attachOrphanBookings = require("../utils/attachOrphanBookings");
const Client = require("../db/models/client.model");
const User = require("../db/models/user.model");
const Booking = require("../db/models/book.model");
const { isSafePlainText } = require("../utils/validateName");

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

  if (!isSafePlainText(fullName))
    return fail("Le nom ne peut pas contenir les caractères < ou >.");

  if (password !== confirmPassword)
    return fail("Les mots de passe ne correspondent pas.");

  if (password.length < 8 || !/[0-9]/.test(password) || !/[^a-zA-Z0-9]/.test(password))
    return fail("Mot de passe trop faible : 8 caractères minimum, avec au moins 1 chiffre et 1 caractère spécial (!, @, #…).");

  const existing = await Client.findOne({ email: email.toLowerCase().trim() });
  if (existing) return fail("Cette adresse email est déjà utilisée.");

  // Filet de sécurité tant que l'inscription pro (compte séparé) existe
  // encore — sans ça, le même email peut avoir un compte Client ET un compte
  // User, ce qui crée des comptes fantômes (cf. plan d'unification).
  const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
  if (existingUser) return fail("Cette adresse email est déjà utilisée.");

  const hashed = await bcrypt.hash(password, 10);
  const client = await Client.create({
    fullName: fullName.trim(),
    email: email.toLowerCase().trim(),
    password: hashed,
    phone: phone || "",
  });

  // Rattache les reservations prises en invite avec cet email. L'ancienne
  // version comparait l'email tel quel : une reservation faite avec
  // « Jean.Dupont@Gmail.com » ne se rattachait jamais a un compte cree en
  // « jean.dupont@gmail.com ».
  await attachOrphanBookings(client);

  req.session.clientId = client._id.toString();
  if (isAjax) return res.json({ success: true, redirect: "/espace-client" });
  return res.redirect("/espace-client");
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────

exports.getLogin = (req, res) => {
  if (req.session.clientId) return res.redirect("/espace-client");
  const error = req.query.error === "google" ? "La connexion avec Google a échoué. Veuillez réessayer."
    : req.query.error === "google_email_taken" ? "Cette adresse email est déjà utilisée par un autre compte. Connectez-vous avec votre mot de passe."
    : null;
  res.render("client/client-login", {
    title: "Connexion client — BranShee",
    alwaysSticky: true,
    clientAuth: true,
    error,
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

  const emailNorm = email?.toLowerCase().trim();
  const client = await Client.findOne({ email: emailNorm });

  if (client) {
    const match = await bcrypt.compare(password, client.password);
    if (!match) return fail("Email ou mot de passe incorrect.");

    // rattrapage a la connexion : une personne peut avoir reserve en invite
    // APRES avoir cree son compte, ou s'etre inscrite via Google.
    await attachOrphanBookings(client);
    req.session.clientId = client._id.toString();

    // Apply preferred language if set
    if (client.preferredLang) {
      res.cookie("user_lang", client.preferredLang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });
    }

    if (isAjax) return res.json({ success: true, redirect: "/espace-client" });
    return res.redirect("/espace-client");
  }

  // Comptes unifiés : il n'existe pas de « compte client » séparé. Si aucun
  // Client (legacy) ne correspond, on tente le compte BranShee (User), qu'il
  // possède un établissement ou non — sinon un utilisateur parfaitement
  // légitime recevait « Email ou mot de passe incorrect ».
  const User = require("../db/models/user.model");
  const user = await User.findOne({ email: emailNorm });
  if (!user || !user.password) return fail("Email ou mot de passe incorrect.");

  const userMatch = await bcrypt.compare(password, user.password);
  if (!userMatch) return fail("Email ou mot de passe incorrect.");

  return req.logIn(user, (err) => {
    if (err) {
      console.error("postLogin req.logIn error:", err);
      return fail("Connexion impossible pour le moment. Réessayez.");
    }
    if (isAjax) return res.json({ success: true, redirect: "/espace-client" });
    return res.redirect("/espace-client");
  });
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
    // name/photo/businessType de l'ÉTABLISSEMENT : sans eux, un client ayant
    // réservé dans 2 établissements d'un même patron voyait deux fois le même
    // nom et la même photo (le `.select` les excluait par omission).
    .select("_id owner slug name photo businessType cancellationPolicy")
    .lean();

  const companyMap = {};
  companies.forEach(c => { companyMap[c._id.toString()] = c; });

  const enriched = allBookings.map(b => {
    const comp  = companyMap[b.company?.toString()];
    const owner = comp?.owner || null;
    return {
      ...b,
      companySlug:        comp ? (comp.slug || comp._id.toString()) : null,
      // Établissement d'abord, compte propriétaire en repli (règle 8).
      companyName:        comp?.name || owner?.businessName || owner?.fullName || "Professionnel",
      companyType:        comp?.businessType || owner?.businessType || "",
      companyPhoto:       comp?.photo || owner?.businessPicture || owner?.profilePicture || "/images/no-user.webp",
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
    .select("_id owner slug name photo")
    .lean();
  const reviewCompanyMap = {};
  reviewCompanies.forEach(c => { reviewCompanyMap[c._id.toString()] = c; });

  const myReviewsEnriched = myReviews.map(r => {
    const comp  = reviewCompanyMap[r.company?.toString()];
    const owner = comp?.owner || null;
    return {
      ...r,
      companySlug: comp ? (comp.slug || comp._id.toString()) : null,
      companyName: comp?.name || owner?.businessName || owner?.fullName || "Établissement",
      companyPhoto: comp?.photo || owner?.businessPicture || owner?.profilePicture || "/images/no-user.webp",
    };
  });

  // Marquer les RDV passés pour lesquels le client a déjà posté un avis
  const reviewedCompanyIds = new Set(myReviews.map(r => r.company?.toString()).filter(Boolean));

  // ── Peut-il démarrer un établissement ? ─────────────────────────────────
  // Uniquement pour un compte User (pas un compte Client legacy) qui ne
  // possède encore aucun établissement → on propose le démarrage express.
  let canCreateEstablishment = false;
  if (req.user) {
    try {
      canCreateEstablishment = !(await Company.exists({ owner: req.user._id, isDeleted: { $ne: true } }));
    } catch (_) { canCreateEstablishment = false; }
  }

  return res.render("client/client-dashboard", {
    title: "Mon espace — BranShee",
    pageName: "Mes rendez-vous",
    client,
    bookings: { upcoming, past },
    myReviews: myReviewsEnriched,
    reviewedCompanyIds: [...reviewedCompanyIds],
    canCreateEstablishment,
  });
};

// ─── SETTINGS ────────────────────────────────────────────────────────────────

exports.getSettings = (req, res) => {
  return res.render("client/client-settings", {
    title: "Paramètres — BranShee",
    pageName: "Paramètres",
    client: req.client,
    isUnifiedAccount: !!req.user,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

// POST /espace-client/parametres/profile
exports.updateProfile = async (req, res) => {
  try {
    const { fullName, phone, location, birthDate, gender, address, postalCode, city, country, languages, emailNotifications } = req.body;

    if (!fullName || fullName.trim().length < 2 || !isSafePlainText(fullName)) {
      return res.redirect("/espace-client/parametres?error=invalid_name");
    }

    // Le téléphone ne doit contenir que des chiffres (et un éventuel « + »).
    const cleanPhone = (phone || "").trim().replace(/[^\d+]/g, "");

    // Coordonnées personnelles communes aux deux types de compte.
    const personal = {
      birthDate: (birthDate || "").trim(),
      gender: (gender || "").trim(),
      address: (address || "").trim(),
      postalCode: (postalCode || "").trim(),
      city: (city || "").trim(),
      country: (country || "").trim(),
    };

    if (req.user) {
      // Le modèle User n'a ni "location" (texte libre) ni "languages"/
      // "emailNotifications" — ces champs sont masqués côté template pour
      // un compte unifié (cf. client-settings.pug) et ignorés ici.
      await User.findByIdAndUpdate(req.user._id, {
        fullName: fullName.trim(),
        phone: cleanPhone,
        ...personal,
      });
      return res.redirect("/espace-client/parametres?success=profile");
    }

    // languages peut être une string (1 valeur) ou un tableau
    let parsedLanguages = [];
    if (languages) {
      parsedLanguages = Array.isArray(languages) ? languages : [languages];
    }

    await Client.findByIdAndUpdate(req.client._id, {
      fullName: fullName.trim(),
      phone: cleanPhone,
      location: location?.trim() || "",
      ...personal,
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
    const Model = req.user ? User : Client;
    await Model.findByIdAndUpdate(req.client._id, { profilePicture: imagePath });

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
    const Model = req.user ? User : Client;

    // Vérifier le mot de passe
    const account = await Model.findById(req.client._id);
    const match = await bcrypt.compare(passwordConfirm, account.password);
    if (!match) {
      return res.redirect("/espace-client/parametres?error=wrong_password#compte");
    }

    // Vérifier si l'email est déjà pris — dans les deux collections (cf.
    // plan d'unification, un même email ne doit jamais exister deux fois).
    const [existingUser, existingClient] = await Promise.all([
      User.findOne({ email: normalizedEmail }),
      Client.findOne({ email: normalizedEmail }),
    ]);
    const existing = existingUser || existingClient;
    if (existing && existing._id.toString() !== req.client._id.toString()) {
      return res.redirect("/espace-client/parametres?error=email_taken#compte");
    }

    await Model.findByIdAndUpdate(req.client._id, { email: normalizedEmail });

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

    const Model = req.user ? User : Client;
    const account = await Model.findById(req.client._id);
    const match = await bcrypt.compare(currentPassword, account.password);
    if (!match) {
      return res.redirect("/espace-client/parametres?error=wrong_password#securite");
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await Model.findByIdAndUpdate(req.client._id, { password: hashed });

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

    const Model = req.user ? User : Client;
    await Model.findByIdAndUpdate(req.client._id, { preferredLang: lang });

    // Set the cookie immediately so the UI refreshes in the new language
    res.cookie("user_lang", lang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });

    return res.redirect("/espace-client/parametres?success=language");
  } catch (err) {
    console.error(err);
    return res.redirect("/espace-client/parametres?error=server");
  }
};
