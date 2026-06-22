const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const DEST_DIR = path.join(__dirname, "..", "public", "uploads", "profiles");
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 82;

const UNSUPPORTED_MSG =
  "Ce format d'image n'est pas pris en charge. Essayez en JPG, PNG, WEBP ou HEIC (photo iPhone).";

// Toute image décodable par sharp (jpg, png, webp, gif, bmp, tiff, avif,
// HEIC/HEIF des photos iPhone...) est normalisée en JPEG — orientation EXIF
// corrigée, redimensionnée si trop grande. Ça évite les échecs silencieux
// constatés avec les photos prises au téléphone / AirDrop.
async function convertToFile(buffer, fieldname) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
  const filename = `${fieldname}-${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;
  await sharp(buffer)
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
