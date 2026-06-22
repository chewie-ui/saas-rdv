const multer = require("multer");

// Stockage en mémoire : le buffer brut est ensuite traité par
// middlewares/processImageUpload.js (sharp) qui valide le format réel,
// corrige l'orientation et écrit le fichier final sur disque. On ne peut
// plus se fier à l'extension/MIME envoyée par le navigateur (les photos
// iPhone/HEIC arrivent parfois avec un type MIME générique).
const storage = multer.memoryStorage();

module.exports = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 Mo avant compression
});
