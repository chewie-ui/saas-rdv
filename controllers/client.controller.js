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
  const { fullName, email, phone, password, confirmPassword } = req.body;

  if (!fullName || !email || !password) {
    return res.render("client/client-register", {
      title: "Créer un compte — BranShee",
      alwaysSticky: true,
      clientAuth: true,
      error: "Veuillez remplir tous les champs obligatoires.",
    });
  }

  if (password !== confirmPassword) {
    return res.render("client/client-register", {
      title: "Créer un compte — BranShee",
      alwaysSticky: true,
      clientAuth: true,
      error: "Les mots de passe ne correspondent pas.",
    });
  }

  if (password.length < 8) {
    return res.render("client/client-register", {
      title: "Créer un compte — BranShee",
      alwaysSticky: true,
      clientAuth: true,
      error: "Le mot de passe doit contenir au moins 8 caractères.",
    });
  }

  const existing = await Client.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    return res.render("client/client-register", {
      title: "Créer un compte — BranShee",
      alwaysSticky: true,
      clientAuth: true,
      error: "Cette adresse email est déjà utilisée.",
    });
  }

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
  const { email, password } = req.body;

  const client = await Client.findOne({ email: email?.toLowerCase().trim() });
  if (!client) {
    return res.render("client/client-login", {
      title: "Connexion client — BranShee",
      alwaysSticky: true,
      clientAuth: true,
      error: "Email ou mot de passe incorrect.",
    });
  }

  const match = await bcrypt.compare(password, client.password);
  if (!match) {
    return res.render("client/client-login", {
      title: "Connexion client — BranShee",
      alwaysSticky: true,
      clientAuth: true,
      error: "Email ou mot de passe incorrect.",
    });
  }

  req.session.clientId = client._id.toString();

  // Apply preferred language if set
  if (client.preferredLang) {
    res.cookie("user_lang", client.preferredLang, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: false });
  }

  return res.redirect("/espace-client");
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────

exports.logout = (req, res) => {
  req.session.clientId = null;
  res.redirect("/");
};

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

exports.getDashboard = async (req, res) => {
  const client = req.client;
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const allBookings = await Booking.find({ clientRef: client._id })
    .populate("company", "fullName profilePicture")
    .sort({ date: -1 })
    .lean();

  const upcoming = allBookings.filter(
    (b) => new Date(b.date) >= now && b.status === "confirmed"
  );
  const past = allBookings.filter(
    (b) => new Date(b.date) < now || b.status === "canceled"
  );

  return res.render("client/client-dashboard", {
    title: "Mon espace — BranShee",
    pageName: "Dashboard",
    client,
    bookings: { upcoming, past },
  });
};

// ─── SETTINGS ────────────────────────────────────────────────────────────────

exports.getSettings = (req, res) => {
  return res.render("client/client-settings", {
    title: "Paramètres — BranShee",
    pageName: "Settings",
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
