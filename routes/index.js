const router = require("express").Router();

const { getCompanyIfExist } = require("../controllers/auth.controller");
const User = require("../db/models/user.model");
const Companies = require("../db/models/company/company.model");
const pug = require("pug");
const path = require("path");
const { sendEmail } = require("../utils/mailer");

router.use(require("./auth"));
router.use(require("./company"));
router.use(require("./admin"));
router.use(require("./booking"));
router.use("/api", require("./api"));
router.use("/account", require("./user/account"));

router.get("/", async (req, res) => {
  const coachs = await Companies.find({})
    .populate({
      path: "owner",
      match: { isPremium: true },
    })
    .limit(10);

  console.log(coachs);

  const validCoachs = coachs.filter((c) => c.owner);

  res.render("client/landing-page", {
    title: `Gymio - ${res.locals.t.titles.home}`,
    coachs: validCoachs,
  });
});

router.get("/search", async (req, res) => {
  try {
    const { name, location } = req.query;
    let userQuery = {};

    if (name) {
      // On fait la même chose pour le nom au cas où (ex: Jean-Pierre)
      const flexibleName = name.trim().replace(/[\s\-\']/g, ".*");
      userQuery.fullName = { $regex: flexibleName, $options: "i" };
    }

    if (location) {
      // On remplace les espaces, tirets et apostrophes par ".*" (n'importe quoi)
      // "Grez Doiceau" devient "Grez.*Doiceau"
      const flexibleLocation = location.trim().replace(/[\s\-\']/g, ".*");

      const locationFilters = [
        { "location.city": { $regex: flexibleLocation, $options: "i" } },
        { "location.address": { $regex: flexibleLocation, $options: "i" } },
      ];

      const zipValue = parseInt(location);
      if (!isNaN(zipValue)) {
        locationFilters.push({ "location.zip": zipValue });
      }

      userQuery.$or = locationFilters;
    }

    // Le reste de ta logique Companies.find().populate()...
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
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

router.get("/contact", (req, res) => {
  res.render("client/contact", { title: "Contact — Gymio" });
});

router.post("/contact", async (req, res) => {
  const { name, surname, email, subject, message } = req.body;

  if (!name || !surname || !email || !subject || !message) {
    return res.render("client/contact", {
      title: "Contact — Gymio",
      error: "Veuillez remplir tous les champs.",
      formData: req.body,
    });
  }

  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const html = pug.renderFile(
      path.join(__dirname, "../views/templates/emails/contact.pug"),
      { name, surname, email, subject, message }
    );

    await sendEmail(adminEmail, `[Contact Gymio] ${subject}`, html);

    return res.render("client/contact", {
      title: "Contact — Gymio",
      success: true,
    });
  } catch (err) {
    console.error(err);
    return res.render("client/contact", {
      title: "Contact — Gymio",
      error: "Une erreur est survenue. Veuillez réessayer.",
      formData: req.body,
    });
  }
});

router.get("/become-coach", (req, res) => {
  res.render("client/become-coach", {
    title: res.locals.t.titles.becomeCoach,
    becomeCoach: true,
  });
});

router.get("/:company", async (req, res) => {
  const company = await getCompanyIfExist(req.params.company);
  console.log(req.params.company);

  if (!company) {
    return res.status(404).render("client/404");
  }

  const ID = company.owner;
  console.log(ID);

  const coach = await User.findById(ID);

  console.log(coach);

  res.render("client/index", {
    title: `Coach ${coach.fullName}`,
    company,
    coach,
    alwaysSticky: true,
  });
});

module.exports = router;
