// ── API mobile : réglages d'un établissement ──────────────────────────────
//   GET    /establishments/:id/settings   lire les réglages modifiables
//   PATCH  /establishments/:id/settings   les modifier
//   POST   /establishments/:id/photo      envoyer la photo (multipart "photo")
//   DELETE /establishments/:id/photo      retirer la photo
//
// Ces routes portent sur l'établissement DE L'URL, pas sur l'établissement
// actif : elles sont montées AVANT `mobileCompany` et la permission
// `establishment.manage` est vérifiée sur `:id` (cf. `requireManage` plus bas,
// équivalent mobile de utils/permissions.js#requirePermissionForParamCompany —
// lequel lit `req.user`, absent ici où l'authentification pose `req.mobileUser`).
//
// Répliqué du web :
//   - controllers/establishment.controller.js : updateEstablishment,
//     updateEstablishmentPhoto (mêmes règles, mêmes écritures)
//   - routes/user/account.js : même chaîne d'upload (multer mémoire +
//     middlewares/processImageUpload → public/uploads/profiles)
//   - controllers/account.controller.js : updateAccountInfo /
//     updateAccountSocial pour la validation des coordonnées
//
// ⚠ Ce qui vit où : la Company porte le nom, le métier, la photo, ET l'identité
// publique (description, email pro, téléphone pro, site, adresse). Ces derniers
// vivaient sur le compte PROPRIÉTAIRE et étaient donc communs à tous ses
// établissements : le second affichait l'adresse du premier. Ils sont
// désormais propres à chaque établissement (`contact.scope = "establishment"`),
// la résolution passant par utils/establishmentIdentity.js — qui garde un repli
// sur le compte pour l'établissement D'ORIGINE tant que la migration n'a pas
// tourné.
const multer = require("multer");
const Company = require("../../db/models/company/company.model");
const User = require("../../db/models/user.model");
const { identityFor } = require("../../utils/establishmentIdentity");
const { getPermissionsForCompanyAndUser } = require("../../utils/permissions");
const { getCompanyPlan } = require("../../utils/planLimits");
const { logActivity } = require("../../utils/activityLog");

const OBJECT_ID = /^[a-f0-9]{24}$/i;

// Formule la ligne du journal d'activité. Un établissement peut n'avoir aucun
// nom (créé à l'inscription, jamais renseigné) : sans ce repli, le journal
// affichait « a changé la photo de l'établissement "" », guillemets vides
// compris.
function describeTarget(action, name) {
  const clean = String(name || "").trim();
  return clean ? `${action} de l'établissement "${clean}"` : `${action} de l'établissement`;
}

// Placeholder du site : "pas de photo" s'écrit ainsi partout (création d'un
// établissement, formatCompanyForList…), jamais par une chaîne vide.
const NO_PHOTO = "/images/no-user.webp";

// Bornes de saisie. `description` suit le maxlength du modèle User (230) :
// au-delà, Mongoose refuserait l'écriture avec une erreur de validation.
const MAX = {
  name: 120,
  businessType: 80,
  description: 230,
  emailPro: 120,
  phonePro: 30,
  website: 200,
  address: 200,
  city: 100,
  country: 100,
};

// ── Permission sur l'établissement de l'URL ───────────────────────────────
// Pose `req.targetCompany` (document lean) et `req.targetIsOwner`.
exports.requireManage = async function requireManage(req, res, next) {
  try {
    const id = String(req.params.id || "");
    if (!OBJECT_ID.test(id)) {
      return res.status(400).json({ error: "invalid_id", message: "Établissement introuvable." });
    }

    const company = await Company.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!company) {
      return res.status(404).json({ error: "not_found", message: "Établissement introuvable." });
    }

    const permissions = await getPermissionsForCompanyAndUser(company._id, req.mobileUser._id);
    if (!permissions || !permissions.establishment || !permissions.establishment.manage) {
      return res.status(403).json({
        error: "forbidden",
        message: "Vous n'avez pas la permission de modifier cet établissement.",
      });
    }

    req.targetCompany = company;
    req.targetIsOwner = String(company.owner) === String(req.mobileUser._id);
    next();
  } catch (err) {
    console.error("[mobile] establishmentSettings.requireManage", err);
    return res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// Charge le compte propriétaire : il reste la source de REPLI de l'identité
// pour l'établissement d'origine (cf. utils/establishmentIdentity.js), donc
// identityFor() a besoin de lui.
async function loadOwner(company, currentUser) {
  if (String(company.owner) === String(currentUser._id)) return currentUser;
  return User.findById(company.owner).lean();
}

function serializeSettings(company, owner, { isOwner }) {
  const identity = identityFor(company, owner);
  const loc = (identity.location && typeof identity.location === "object") ? identity.location : {};
  return {
    establishment: {
      id: String(company._id),
      // Repli sur le compte propriétaire pour les établissements créés avant
      // le multi-établissements (même règle que la liste).
      name: company.name || (owner && (owner.businessName || owner.fullName)) || "",
      businessType: company.businessType || (owner && owner.businessType) || "",
      photo: company.photo || (owner && owner.businessPicture) || NO_PHOTO,
      hasPhoto: !!(company.photo && company.photo !== NO_PHOTO),
      isPaused: !!company.isPaused,
      plan: getCompanyPlan(company, owner || {}),
      isOwner,
      createdAt: company.createdAt || null,
    },
    contact: {
      // "establishment" : ces champs sont propres à CET établissement, rien
      // n'est partagé avec les autres du même propriétaire. L'app le dit à
      // l'utilisateur.
      scope: "establishment",
      editable: true,
      description: identity.description || "",
      emailPro: identity.emailPro || "",
      phonePro: identity.phonePro || "",
      website: identity.website || "",
      address: loc.address || "",
      city: loc.city || "",
      zip: loc.zip === undefined || loc.zip === null ? "" : String(loc.zip),
      country: loc.country || "",
    },
  };
}

// ── GET /api/v1/establishments/:id/settings ───────────────────────────────
exports.get = async (req, res) => {
  try {
    const company = req.targetCompany;
    const owner = await loadOwner(company, req.mobileUser);
    return res.json(serializeSettings(company, owner, { isOwner: req.targetIsOwner }));
  } catch (err) {
    console.error("[mobile] establishmentSettings.get", err);
    return res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── PATCH /api/v1/establishments/:id/settings ─────────────────────────────
// Seules les clés présentes dans le corps sont touchées : l'app n'a jamais à
// renvoyer l'objet entier (et ne peut donc pas effacer un champ par omission).
exports.update = async (req, res) => {
  try {
    const company = req.targetCompany;
    const body = req.body || {};

    const companyUpdate = {};

    // ── Champs de l'établissement ──────────────────────────────────────────
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        return res.status(400).json({ error: "missing_name", message: "Le nom ne peut pas être vide." });
      }
      if (name.length > MAX.name) {
        return res.status(400).json({
          error: "name_too_long",
          message: `Le nom ne peut pas dépasser ${MAX.name} caractères.`,
        });
      }
      // Même garde que le web (isSafePlainText) : ces valeurs sont réaffichées
      // sur la page publique de l'établissement.
      if (/[<>]/.test(name)) {
        return res.status(400).json({
          error: "invalid_name",
          message: "Le nom ne peut pas contenir les caractères < ou >.",
        });
      }
      companyUpdate.name = name;
    }

    if (body.businessType !== undefined) {
      const businessType = String(body.businessType).trim();
      if (businessType.length > MAX.businessType) {
        return res.status(400).json({
          error: "business_type_too_long",
          message: `Le métier ne peut pas dépasser ${MAX.businessType} caractères.`,
        });
      }
      if (/[<>]/.test(businessType)) {
        return res.status(400).json({
          error: "invalid_business_type",
          message: "Le métier ne peut pas contenir les caractères < ou >.",
        });
      }
      companyUpdate.businessType = businessType;
    }

    if (body.isPaused !== undefined) companyUpdate.isPaused = !!body.isPaused;

    // ── Identité publique : portée par l'ÉTABLISSEMENT ─────────────────────
    // Ces champs partaient sur le compte propriétaire : chaque enregistrement
    // depuis l'app re-déposait donc l'adresse d'un établissement sur tous les
    // autres. Ils vont désormais sur la Company, comme sur le site.
    if (body.description !== undefined) {
      const description = String(body.description).trim();
      if (description.length > MAX.description) {
        return res.status(400).json({
          error: "description_too_long",
          message: `La description ne peut pas dépasser ${MAX.description} caractères.`,
        });
      }
      if (/[<>]/.test(description)) {
        return res.status(400).json({
          error: "invalid_description",
          message: "La description ne peut pas contenir les caractères < ou >.",
        });
      }
      companyUpdate.description = description;
    }

    if (body.emailPro !== undefined) {
      const emailPro = String(body.emailPro).trim();
      if (emailPro && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailPro)) {
        return res.status(400).json({
          error: "invalid_email",
          message: "Adresse email invalide. Ex : contact@monactivite.com",
        });
      }
      if (emailPro.length > MAX.emailPro) {
        return res.status(400).json({ error: "email_too_long", message: "Cette adresse email est trop longue." });
      }
      companyUpdate.emailPro = emailPro;
    }

    if (body.phonePro !== undefined) {
      const phonePro = String(body.phonePro).trim();
      if (phonePro && !/^\+?[\d\s\-().]{6,20}$/.test(phonePro)) {
        return res.status(400).json({
          error: "invalid_phone",
          message: "Numéro invalide. Ex : +32 476 12 34 56",
        });
      }
      companyUpdate.phonePro = phonePro;
    }

    if (body.website !== undefined) {
      const website = String(body.website).trim();
      if (website && !/^https?:\/\/.+\..+/.test(website)) {
        return res.status(400).json({
          error: "invalid_website",
          message: "Lien invalide. Il doit commencer par https:// (ex : https://monsite.be)",
        });
      }
      if (website.length > MAX.website) {
        return res.status(400).json({ error: "website_too_long", message: "Ce lien est trop long." });
      }
      companyUpdate.website = website;
    }

    // Le compte est encore le porteur de l'identité de l'établissement
    // D'ORIGINE tant que la migration n'a pas tourné : on part de la valeur
    // EFFECTIVE (identityFor) pour ne pas perdre au premier enregistrement ce
    // que l'app n'envoie pas — carte, coordonnées GPS, mode « en ligne »…
    // `Company.location` étant Mixed (null par défaut), un `$set` sur
    // "location.address" échouerait : on réécrit l'objet entier.
    const ownerDoc = await loadOwner(company, req.mobileUser);
    const currentLoc = identityFor(company, ownerDoc).location;
    const nextLoc = (currentLoc && typeof currentLoc === "object") ? { ...currentLoc } : {};
    let locTouched = false;

    const locFields = { address: "address", city: "city", country: "country" };
    for (const [key, field] of Object.entries(locFields)) {
      if (body[key] === undefined) continue;
      const value = String(body[key]).trim();
      if (value.length > MAX[key]) {
        return res.status(400).json({
          error: `${key}_too_long`,
          message: `Ce champ ne peut pas dépasser ${MAX[key]} caractères.`,
        });
      }
      if (/[<>]/.test(value)) {
        return res.status(400).json({
          error: `invalid_${key}`,
          message: "Ce champ ne peut pas contenir les caractères < ou >.",
        });
      }
      nextLoc[field] = value;
      locTouched = true;
    }

    if (body.zip !== undefined) {
      const zip = String(body.zip).trim();
      if (zip === "") {
        nextLoc.zip = null;
      } else if (!/^\d{1,10}$/.test(zip)) {
        // Le modèle User stocke `location.zip` en Number : une valeur non
        // numérique ferait échouer l'écriture côté Mongoose lors de
        // l'alignement du compte.
        return res.status(400).json({
          error: "invalid_zip",
          message: "Code postal invalide : chiffres uniquement.",
        });
      } else {
        nextLoc.zip = Number(zip);
      }
      locTouched = true;
    }

    if (locTouched) companyUpdate.location = nextLoc;

    if (!Object.keys(companyUpdate).length) {
      return res.status(400).json({ error: "nothing_to_update", message: "Aucune modification envoyée." });
    }

    await Company.updateOne({ _id: company._id }, { $set: companyUpdate });

    // Le compte reste le repli de l'établissement D'ORIGINE : on l'aligne pour
    // que les deux ne divergent pas — uniquement si c'est le propriétaire
    // lui-même qui édite (un collaborateur gérant n'a pas à réécrire le compte
    // de quelqu'un d'autre ; la valeur de l'établissement prime de toute façon).
    if (req.targetIsOwner && String(req.mobileUser.company || "") === String(company._id)) {
      const ownerUpdate = {};
      for (const key of ["description", "emailPro", "phonePro", "website", "location"]) {
        if (companyUpdate[key] !== undefined) ownerUpdate[key] = companyUpdate[key];
      }
      if (Object.keys(ownerUpdate).length) {
        await User.updateOne({ _id: company.owner }, { $set: ownerUpdate });
      }
    }

    const fresh = await Company.findById(company._id).lean();
    const owner = await loadOwner(fresh, req.mobileUser);

    logActivity({
      company: company._id,
      user: req.mobileUser,
      role: req.targetIsOwner ? "owner" : "employee",
      action: "establishment.update",
      description: describeTarget("a modifié les informations", fresh.name || company.name),
    });

    return res.json({
      ok: true,
      ...serializeSettings(fresh, owner, { isOwner: req.targetIsOwner }),
    });
  } catch (err) {
    console.error("[mobile] establishmentSettings.update", err);
    return res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── Chaîne d'upload de la photo ───────────────────────────────────────────
// Même principe que le site (config/multer.js) : stockage EN MÉMOIRE, puis
// middlewares/processImageUpload qui valide réellement l'image avec sharp,
// corrige l'orientation EXIF, redimensionne (max 1600 px) et écrit un JPEG
// compressé dans public/uploads/profiles. Le filtre de type ci-dessous n'est
// qu'un premier tri : c'est sharp qui fait foi.
const PHOTO_MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_MIME = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  // Photos prises avec un iPhone : le fichier arrive en HEIC/HEIF et est
  // converti en JPEG par processImageUpload.
  "image/heic",
  "image/heif",
];

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(String(file.mimetype).toLowerCase())) return cb(null, true);
    const err = new Error("unsupported_type");
    err.code = "UNSUPPORTED_TYPE";
    cb(err);
  },
}).single("photo");

// Sans ce relais, une image trop lourde ou d'un mauvais type sortait par le
// gestionnaire d'erreurs d'Express — donc en HTML, illisible pour l'app.
exports.photoUploadMiddleware = function photoUploadMiddleware(req, res, next) {
  photoUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "file_too_large",
        message: "Cette image est trop lourde (12 Mo maximum).",
      });
    }
    if (err.code === "UNSUPPORTED_TYPE") {
      return res.status(400).json({
        error: "unsupported_type",
        message: "Format non pris en charge. Envoyez une image JPG, PNG ou WEBP.",
      });
    }
    console.error("[mobile] establishmentSettings.photoUpload", err.message);
    return res.status(400).json({ error: "upload_failed", message: "Envoi de l'image impossible." });
  });
};

// ── POST /api/v1/establishments/:id/photo ─────────────────────────────────
exports.setPhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "missing_file", message: "Aucune image reçue." });
    }
    const company = req.targetCompany;
    const photo = `/uploads/profiles/${req.file.filename}`;

    await Company.updateOne({ _id: company._id }, { $set: { photo } });

    logActivity({
      company: company._id,
      user: req.mobileUser,
      role: req.targetIsOwner ? "owner" : "employee",
      action: "establishment.update",
      description: describeTarget("a changé la photo", company.name),
    });

    return res.json({ ok: true, photo });
  } catch (err) {
    console.error("[mobile] establishmentSettings.setPhoto", err);
    return res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};

// ── DELETE /api/v1/establishments/:id/photo ───────────────────────────────
// On remet le placeholder du site plutôt qu'une chaîne vide : sinon
// l'établissement retomberait sur la photo du compte propriétaire et donnerait
// l'impression d'une image « copiée » d'un établissement à l'autre.
exports.deletePhoto = async (req, res) => {
  try {
    const company = req.targetCompany;
    await Company.updateOne({ _id: company._id }, { $set: { photo: NO_PHOTO } });

    logActivity({
      company: company._id,
      user: req.mobileUser,
      role: req.targetIsOwner ? "owner" : "employee",
      action: "establishment.update",
      description: describeTarget("a retiré la photo", company.name),
    });

    return res.json({ ok: true, photo: NO_PHOTO });
  } catch (err) {
    console.error("[mobile] establishmentSettings.deletePhoto", err);
    return res.status(500).json({ error: "server_error", message: "Erreur serveur." });
  }
};
