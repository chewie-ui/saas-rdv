const router = require("express").Router();

const { getCompanyIfExist } = require("../controllers/auth.controller");
const User = require("../db/models/user.model");
const Companies = require("../db/models/company/company.model");
const pug = require("pug");
const path = require("path");
const { sendEmail } = require("../utils/mailer");
const getServices = require("../utils/services");

router.use(require("./auth"));
router.use(require("./client-auth"));
router.use(require("./company"));
router.use(require("./admin"));
router.use(require("./booking"));
router.use("/api", require("./api"));
router.use("/account", require("./user/account"));
router.use(require("./superadmin"));
router.use(require("./services"));
router.use(require("./employees"));

/* ── Sitemap ──────────────────────────────────────────────────────── */
router.get("/sitemap.xml", async (req, res) => {
  const BASE = "https://www.saymiro.com";

  // Fetch all active company slugs to generate business profile URLs
  let companyUrls = "";
  try {
    const companies = await Companies.find({})
      .populate({ path: "owner", match: { isPremium: true } })
      .lean();
    companies
      .filter((c) => c.owner)
      .forEach((c) => {
        companyUrls += `
  <url>
    <loc>${BASE}/${c._id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;
      });
  } catch (_) {}

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${BASE}/search</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${BASE}/manage-business</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>${BASE}/s-inscrire</loc>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${BASE}/contact</loc>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>
  <url>
    <loc>${BASE}/confidentialite</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>
  <url>
    <loc>${BASE}/conditions-utilisation</loc>
    <changefreq>yearly</changefreq>
    <priority>0.3</priority>
  </url>${companyUrls}
</urlset>`;

  res.setHeader("Content-Type", "application/xml");
  res.send(xml);
});

// router.get("/", async (req, res) => {
//   const coachs = await Companies.find({})
//     .populate({
//       path: "owner",
//       match: { isPremium: true },
//     })
//     .limit(10);

//   console.log({ coachs });

//   const validCoachs = coachs.filter((c) => c.isPremium === true);

//   res.render("client/landing-page", {
//     title: `BranShee — Prenez rendez-vous en ligne simplement`,
//     metaDescription: "Trouvez et réservez en ligne un coach sportif, un coiffeur, un thérapeute ou tout autre professionnel près de chez vous. Prise de rendez-vous gratuite et instantanée avec BranShee.",
//     canonical: "https://www.saymiro.com/",
//     coachs: validCoachs,
//     services: getServices(res.locals.lang),
//   });
// });

router.get("/", async (req, res) => {
  console.log(await Companies.find({}).populate("owner"));

  const coachs = await Companies.find({})
    .populate({
      path: "owner",
      match: { isPremium: true },
    })
    .limit(10);

  console.log({ coachs });

  const validCoachs = coachs.filter((c) => c.isPremium === true);

  res.render("client/landing-page", {
    title: `BranShee — Prenez rendez-vous en ligne simplement`,
    metaDescription: "Trouvez et réservez en ligne un coach sportif, un coiffeur, un thérapeute ou tout autre professionnel près de chez vous. Prise de rendez-vous gratuite et instantanée avec BranShee.",
    canonical: "https://www.saymiro.com/",
    coachs: validCoachs,
    services: getServices(res.locals.lang),
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
      services: getServices(res.locals.lang),
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur serveur");
  }
});

router.get("/contact", (req, res) => {
  res.render("client/contact", { title: "Contact — BranShee", alwaysSticky: true });
});

router.post("/contact", async (req, res) => {
  const { name, surname, email, subject, message } = req.body;

  if (!name || !surname || !email || !subject || !message) {
    return res.render("client/contact", {
      title: "Contact — BranShee",
      error: "Veuillez remplir tous les champs.",
      formData: req.body,
    });
  }

  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const html = pug.renderFile(path.join(__dirname, "../views/templates/emails/contact.pug"), { name, surname, email, subject, message });

    await sendEmail(adminEmail, `[Contact BranShee] ${subject}`, html);

    return res.render("client/contact", {
      title: "Contact — BranShee",
      success: true,
    });
  } catch (err) {
    console.error(err);
    return res.render("client/contact", {
      title: "Contact — BranShee",
      error: "Une erreur est survenue. Veuillez réessayer.",
      formData: req.body,
    });
  }
});

router.get("/confidentialite", (req, res) => {
  res.render("client/confidentialite", {
    title: "Politique de confidentialité — BranShee",
    alwaysSticky: true,
  });
});

router.get("/conditions-utilisation", (req, res) => {
  res.render("client/conditions-utilisation", {
    title: "Conditions d'utilisation — BranShee",
    alwaysSticky: true,
  });
});

router.get("/manage-business", (req, res) => {
  res.render("client/manage-business", {
    title: "Gérer votre activité avec BranShee — Agenda en ligne",
    metaDescription: "Créez votre page professionnelle sur BranShee et recevez des réservations en ligne 24h/24. Gérez vos rendez-vous, employés et services facilement.",
    canonical: "https://www.saymiro.com/manage-business",
    becomeCoach: true,
  });
});

router.get("/s-inscrire", (req, res) => {
  res.render("auth/choose-account", {
    title: "Créer un compte — BranShee",
    alwaysSticky: true,
  });
});

router.get("/:company", async (req, res) => {
  const company = await getCompanyIfExist(req.params.company);

  if (!company) {
    return res.status(404).render("client/404");
  }

  const ID = company.owner;
  const coach = await User.findById(ID);

  const Service = require("../db/models/company/service.model");
  const Employee = require("../db/models/company/employee.model");

  const services = await Service.find({ company: company._id, active: true }).populate("employees", "firstName lastName profilePicture").sort("order").lean();

  const activeEmployees = await Employee.find({ company: company._id, active: true }).lean();

  // Pre-serialize services to avoid Pug interpolation issues with nested braces
  const servicesJson = JSON.stringify(
    services.map(function (s) {
      return {
        _id: String(s._id),
        name: s.name,
        description: s.description || "",
        price: s.price,
        duration: s.duration,
        employees: (s.employees || []).map(function (e) {
          return {
            _id: String(e._id),
            firstName: e.firstName || "",
            lastName: e.lastName || "",
            profilePicture: e.profilePicture || "/images/no-user.webp",
          };
        }),
      };
    }),
  );

  const employeesJson = JSON.stringify(
    activeEmployees.map(function (e) {
      return {
        _id: String(e._id),
        firstName: e.firstName || "",
        lastName: e.lastName || "",
        profilePicture: e.profilePicture || "/images/no-user.webp",
      };
    }),
  );

  // Client connecté → pré-remplir le formulaire de réservation
  let clientUser = null;
  if (req.session && req.session.clientId) {
    try {
      const Client = require("../db/models/client.model");
      const client = await Client.findById(req.session.clientId).lean();
      if (client) {
        const parts = (client.fullName || "").trim().split(" ");
        clientUser = {
          firstName: parts[0] || "",
          lastName: parts.slice(1).join(" ") || "",
          email: client.email || "",
          phone: client.phone || "",
        };
      }
    } catch (_) {}
  }

  const profileTitle = `${coach.businessName || coach.fullName} — Réserver en ligne | BranShee`;
  const profileDesc = coach.description ? `${coach.description.slice(0, 150)}…` : `Réservez en ligne avec ${coach.businessName || coach.fullName}. Prise de rendez-vous rapide et gratuite sur BranShee.`;

  res.render("client/index", {
    title: profileTitle,
    metaDescription: profileDesc,
    ogType: "profile",
    ogImage: coach.businessPicture || coach.profilePicture || "https://www.saymiro.com/images/og-cover.jpg",
    canonical: `https://www.saymiro.com/${company._id}`,
    company,
    coach,
    services,
    servicesJson,
    employeesJson,
    clientUser,
    alwaysSticky: true,
  });
});

module.exports = router;
