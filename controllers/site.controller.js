const Site = require("../db/models/site.model");
const Service = require("../db/models/company/service.model");
const Company = require("../db/models/company/company.model");
const User = require("../db/models/user.model");
const Review = require("../db/models/review.model");
const multerConfig = require("../config/multer");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const pug = require("pug");
const { sendEmail } = require("../utils/mailer");

const SITE_IMG_DIR = path.join(__dirname, "..", "public", "uploads", "site");

async function fetchReviews(companyId) {
  let reviews = [], avgRating = 0, reviewCount = 0;
  try {
    reviews = await Review.find({ company: companyId }).sort({ createdAt: -1 }).limit(50).lean();
    reviewCount = reviews.length;
    if (reviewCount > 0) {
      avgRating = Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviewCount) * 10) / 10;
    }
  } catch (_) {}
  return { reviews, avgRating, reviewCount };
}

function makeSlug(str) {
  return String(str)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function uniqueSlug(base) {
  let slug = (makeSlug(base) || "mon-site").slice(0, 40);
  if (!(await Site.exists({ slug }))) return slug;
  for (let i = 2; i < 100; i++) {
    const s = `${slug}-${i}`;
    if (!(await Site.exists({ slug: s }))) return s;
  }
  return `${slug}-${Date.now()}`;
}

function defaultSections(company, user) {
  return [
    { id: "hero", type: "hero", enabled: true, order: 0, data: {
      title: company.name || user.businessName || "Votre établissement",
      subtitle: "Réservez votre rendez-vous en ligne, rapidement et simplement.",
      ctaText: "Prendre rendez-vous",
      bgImage: company.photo || "",
    }},
    { id: "services", type: "services", enabled: true, order: 1, data: {
      title: "Nos prestations",
      subtitle: "Découvrez tous nos services",
    }},
    { id: "booking", type: "booking", enabled: true, order: 2, data: {
      title: "Réservez en ligne",
      subtitle: "Choisissez votre créneau en quelques clics",
    }},
    { id: "about", type: "about", enabled: true, order: 3, data: {
      title: "À propos de nous",
      text: "Bienvenue ! Nous mettons tout en œuvre pour vous offrir la meilleure expérience possible.",
      image: "",
    }},
    { id: "contact", type: "contact", enabled: true, order: 4, data: {
      title: "Nous trouver",
      phone: user.phone || "",
      email: user.email || "",
      address: company.address || "",
    }},
  ];
}

exports.editorPage = async (req, res) => {
  const company = res.locals.currentCompany;
  let site = await Site.findOne({ company: company._id }).lean();
  if (!site) {
    const slug = await uniqueSlug(company.name || req.user.businessName);
    const created = await Site.create({
      company: company._id,
      slug,
      sections: defaultSections(company, req.user),
    });
    site = created.toObject();
  }
  const services = await Service.find({ company: company._id, active: true }).sort("order").lean();
  const companySlug = company.slug || String(company._id);
  res.render("admin/mon-site", {
    pageName: "MonSite",
    title: "Mon site — BranShee",
    site,
    services,
    companySlug,
    siteUrl: `/s/${site.slug}`,
    previewUrl: `/mon-site/preview`,
    visitCount: site.visitCount || 0,
  });
};

function sanitizeHtml(raw) {
  if (!raw || typeof raw !== "string") return raw;
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]*/gi, "")
    .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
    .replace(/<iframe[\s\S]*?>/gi, "")
    .replace(/<object[\s\S]*?>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "");
}

function sanitizeSections(sections) {
  if (!Array.isArray(sections)) return sections;
  return sections.map(s => {
    if (s.data && typeof s.data === "object") {
      const d = { ...s.data };
      ["text", "subtitle", "title"].forEach(k => {
        if (typeof d[k] === "string") d[k] = sanitizeHtml(d[k]);
      });
      s = { ...s, data: d };
    }
    return s;
  });
}

exports.save = async (req, res) => {
  try {
    const company = res.locals.currentCompany;
    const { sections, theme, seo, logoUrl, slug, customDomain, social } = req.body;
    const site = await Site.findOne({ company: company._id });
    if (!site) return res.status(404).json({ error: "Site introuvable" });
    if (sections !== undefined) site.sections = sanitizeSections(sections);
    if (theme) Object.assign(site.theme, theme);
    if (seo) Object.assign(site.seo, seo);
    if (logoUrl !== undefined) site.logoUrl = logoUrl;
    if (customDomain !== undefined) site.customDomain = customDomain || "";
    if (social && typeof social === "object") {
      const allowed = ["instagram", "facebook", "tiktok", "whatsapp", "linkedin", "youtube"];
      allowed.forEach(k => { if (k in social) site.social[k] = social[k] || ""; });
    }
    if (slug && slug !== site.slug) {
      const newSlug = makeSlug(slug).slice(0, 50) || site.slug;
      const exists = await Site.exists({ slug: newSlug, _id: { $ne: site._id } });
      if (exists) return res.status(400).json({ error: "Ce slug est déjà utilisé, veuillez en choisir un autre." });
      site.slug = newSlug;
    }
    await site.save();
    res.json({ success: true, slug: site.slug, siteUrl: `/s/${site.slug}` });
  } catch (err) {
    console.error("[site.save]", err);
    res.status(500).json({ error: err.message });
  }
};

exports.togglePublish = async (req, res) => {
  try {
    const company = res.locals.currentCompany;
    const site = await Site.findOne({ company: company._id });
    if (!site) return res.status(404).json({ error: "Site introuvable" });
    site.isPublished = !site.isPublished;
    await site.save();
    res.json({ success: true, isPublished: site.isPublished });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.previewSite = async (req, res) => {
  const company = res.locals.currentCompany;
  const site = await Site.findOne({ company: company._id }).lean();
  if (!site) return res.status(404).send("<p>Site non créé.</p>");
  const services = await Service.find({ company: company._id, active: true }).sort("order").lean();
  const companySlug = company.slug || String(company._id);
  const { reviews, avgRating, reviewCount } = await fetchReviews(company._id);
  res.render("public/site", { site, company, services, companySlug, isPreview: true, reviews, avgRating, reviewCount });
};

exports.uploadImage = [
  multerConfig.single("image"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier envoyé" });
    try {
      fs.mkdirSync(SITE_IMG_DIR, { recursive: true });
      const filename = `site-${Date.now()}.jpg`;
      await sharp(req.file.buffer)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(path.join(SITE_IMG_DIR, filename));
      res.json({ success: true, url: `/uploads/site/${filename}` });
    } catch (err) {
      console.error("[site.upload]", err);
      res.status(500).json({ error: "Impossible de traiter l'image" });
    }
  },
];

exports.contactForm = async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ error: "Champs manquants" });
    const site = await Site.findOne({ slug: req.params.slug, isPublished: true }).lean();
    if (!site) return res.status(404).json({ error: "Site introuvable" });
    const company = await Company.findById(site.company).lean();
    if (!company) return res.status(404).json({ error: "Établissement introuvable" });
    const owner = await User.findById(company.owner).select("email").lean();
    if (!owner?.email) return res.status(500).json({ error: "Destinataire introuvable" });
    const subject = `Message depuis votre site — ${company.name}`;
    const html = pug.renderFile(path.join(__dirname, "../views/templates/emails/contact.pug"), {
      name,
      surname: "",
      email,
      subject,
      message,
    });
    await sendEmail(owner.email, subject, html);
    res.json({ success: true });
  } catch (err) {
    console.error("[site.contactForm]", err);
    res.status(500).json({ error: "Impossible d'envoyer le message" });
  }
};

exports.publicSite = async (req, res) => {
  try {
    const site = await Site.findOne({ slug: req.params.slug, isPublished: true }).lean();
    if (!site) return res.status(404).render("client/404");
    const company = await Company.findById(site.company).lean();
    if (!company) return res.status(404).render("client/404");
    const services = await Service.find({ company: company._id, active: true }).sort("order").lean();
    const companySlug = company.slug || String(company._id);
    Site.findByIdAndUpdate(site._id, { $inc: { visitCount: 1 } }).exec().catch(() => {});
    const { reviews, avgRating, reviewCount } = await fetchReviews(company._id);
    res.render("public/site", { site, company, services, companySlug, isPreview: false, reviews, avgRating, reviewCount });
  } catch (err) {
    console.error("[site.publicSite]", err);
    res.status(500).render("client/404");
  }
};
