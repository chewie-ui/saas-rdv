const router = require("express").Router();

const { getCompanyIfExist } = require("../controllers/auth.controller");
const User = require("../db/models/user.model");
const Companies = require("../db/models/company/company.model");
const pug = require("pug");
const path = require("path");
const { sendEmail } = require("../utils/mailer");
const SERVICES = require("../utils/services");

router.use(require("./auth"));
router.use(require("./client-auth"));
router.use(require("./company"));
router.use(require("./admin"));
router.use(require("./booking"));
router.use("/api", require("./api"));
router.use("/account", require("./user/account"));
router.use(require("./superadmin"));

router.get("/", async (req, res) => {
  const coachs = await Companies.find({})
    .populate({
      path: "owner",
      match: { isPremium: true },
    })
    .limit(10);

  const validCoachs = coachs.filter((c) => c.owner);

  res.render("client/landing-page", {
    title: `SayMiro Calendar - ${res.locals.t.titles.home}`,
    coachs: validCoachs,
    services: SERVICES,
  });
});

router.get("/search", async (req, res) => {
  try {
    const { name, location } = req.query;
    let userQuery = {};
    const conditions = [];

    if (name) {
      // Recherche sur le nom complet OU le type de service/métier
      const flexibleName = name.trim().replace(/[\s\-\']/g, ".*");
      conditions.push({
        $or: [{ fullName: { $regex: flexibleName, $options: "i" } }, { businessType: { $regex: flexibleName, $options: "i" } }],
      });
    }

    if (location) {
      // On remplace les espaces, tirets et apostrophes par ".*" (n'importe quoi)
      const flexibleLocation = location.trim().replace(/[\s\-\']/g, ".*");

      const locationFilters = [{ "location.city": { $regex: flexibleLocation, $options: "i" } }, { "location.address": { $regex: flexibleLocation, $options: "i" } }];

      const zipValue = parseInt(location);
      if (!isNaN(zipValue)) {
        locationFilters.push({ "location.zip": zipValue });
      }

      conditions.push({ $or: locationFilters });
    }

    // Toujours filtrer sur isPremium actif
    conditions.push({ isPremium: true });

    if (conditions.length === 1) {
      userQuery = conditions[0];
    } else {
      userQuery = { $and: conditions };
    }

    const coachs = await Companies.find({})
      .populate({
        path: "owner",
        match: userQuery,
      })
      .limit(20);

    const filteredCoachs = coachs.filter((coach) => coach.owner !== null);

    res.render("client/landing-page", {
      coachs: filteredCoachs,
      searchName: name,
      searchLocation: location,
      services: SERVICES,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

router.get("/contact", (req, res) => {
  res.render("client/contact", { title: "Contact — SayMiro Calendar", alwaysSticky: true });
});

router.post("/contact", async (req, res) => {
  const { name, surname, email, subject, message } = req.body;

  if (!name || !surname || !email || !subject || !message) {
    return res.render("client/contact", {
      title: "Contact — SayMiro Calendar",
      error: "Veuillez remplir tous les champs.",
      formData: req.body,
    });
  }

  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const html = pug.renderFile(path.join(__dirname, "../views/templates/emails/contact.pug"), { name, surname, email, subject, message });

    await sendEmail(adminEmail, `[Contact SayMiro Calendar] ${subject}`, html);

    return res.render("client/contact", {
      title: "Contact — SayMiro Calendar",
      success: true,
    });
  } catch (err) {
    console.error(err);
    return res.render("client/contact", {
      title: "Contact — SayMiro Calendar",
      error: "Une erreur est survenue. Veuillez réessayer.",
      formData: req.body,
    });
  }
});

router.get("/confidentialite", (req, res) => {
  res.render("client/confidentialite", {
    title: "Politique de confidentialité — SayMiro Calendar",
    alwaysSticky: true,
  });
});

router.get("/conditions-utilisation", (req, res) => {
  res.render("client/conditions-utilisation", {
    title: "Conditions d'utilisation — SayMiro Calendar",
    alwaysSticky: true,
  });
});

router.get("/manage-business", (req, res) => {
  res.render("client/manage-business", {
    title: res.locals.t.titles.becomeCoach,
    becomeCoach: true,
  });
});

router.get("/s-inscrire", (req, res) => {
  res.render("auth/choose-account", {
    title: "Créer un compte — SayMiro Calendar",
    alwaysSticky: true,
  });
});

router.get("/mes-rdv", require("../controllers/booking.controller").getClientPanel);
router.post("/mes-rdv", require("../controllers/booking.controller").postClientPanel);
router.get("/:company", async (req, res) => {
  const company = await getCompanyIfExist(req.params.company);
  console.log(req.params.company);

  if (!company) {
    return res.status(404).render("client/404");
  }

  const ID = company.owner;
  console.log(ID);

  const coach = await User.findById(ID);

  res.render("client/index", {
    title: `Coach ${coach.fullName}`,
    company,
    coach,
    alwaysSticky: true,
  });
});

module.exports = router;
