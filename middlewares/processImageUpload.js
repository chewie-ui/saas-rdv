const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const DEST_DIR = path.join(__dirname, "..", "public", "uploads", "profiles");
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 82;

const UNSUPPORTED_MSG =
  "Ce format d'image n'est pas pris en charge. Essayez en JPG, PNG, WEBP ou HEIC (photo iPhone).";

// Les binaires sharp/libvips standards ne savent PAS décoder le HEIC (codec
// HEVC soumis à licence, exclu des builds par défaut) — seul AVIF passe par
// sharp. Les photos prises directement avec l'appareil d'un iPhone/iPad
// (et certains AirDrop/exports Mac) sont en HEIC : sharp échoue dessus.
// On détecte la signature de fichier HEIF/HEIC (boîte ISOBMFF "ftyp") et on
// pré-décode avec heic-convert (lib JS pure, pas de dépendance native) avant
// de repasser par sharp pour la normalisation finale (rotation, resize, jpeg).
function isHeic(buffer) {
  if (!buffer || buffer.length < 12) return false;
  if (buffer.toString("ascii", 4, 8) !== "ftyp") return false;
  const subtype = buffer.toString("ascii", 8, 12);
  return ["heic", "heix", "hevc", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(subtype);
}

async function decodeHeic(buffer) {
  const convert = require("heic-convert");
  const jpegBuffer = await convert({ buffer, format: "JPEG", quality: 1 });
  return jpegBuffer;
}

// Toute image décodable (jpg, png, webp, gif, bmp, tiff, avif, et HEIC/HEIF
// des photos iPhone via le fallback ci-dessus) est normalisée en JPEG —
// orientation EXIF corrigée, redimensionnée si trop grande. Ça évite les
// échecs silencieux constatés avec les photos prises au téléphone / AirDrop.
async function convertToFile(buffer, fieldname) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
  const filename = `${fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;

  let sourceBuffer = buffer;
  if (isHeic(buffer)) {
    sourceBuffer = await decodeHeic(buffer);
  } else {
    try {
      await sharp(buffer).metadata();
    } catch (err) {
      // Sharp n'a pas reconnu le format (parfois le cas pour du HEIC mal
      // formé / sans signature standard) — dernier essai via heic-convert
      // avant d'abandonner.
      sourceBuffer = await decodeHeic(buffer);
    }
  }

  await sharp(sourceBuffer)
    .rotate()
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(path.join(DEST_DIR, filename));
  return filename;
}

function processSingleImage(fieldname) {
  return async (req, res, next) => {
    if (!req.file) return next();
    try {
      req.file.filename = await convertToFile(req.file.buffer, fieldname || req.file.fieldname);
    } catch (err) {
      console.error("[upload] Conversion image impossible:", err.message);
      return res.status(400).json({ success: false, message: UNSUPPORTED_MSG });
    }
    next();
  };
}

function processMultipleImages(fieldname) {
  return async (req, res, next) => {
    if (!req.files || req.files.length === 0) return next();
    try {
      for (const file of req.files) {
        file.filename = await convertToFile(file.buffer, fieldname || file.fieldname);
      }
    } catch (err) {
      console.error("[upload] Conversion image impossible:", err.message);
      return res.status(400).json({ success: false, message: UNSUPPORTED_MSG });
    }
    next();
  };
}

module.exports = { processSingleImage, processMultipleImages, UNSUPPORTED_MSG };
