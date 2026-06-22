const multer = require("multer");

// Stockage en mémoire : le buffer brut est ensuite traité par
// middlewares/processImageUpload.js (sharp) qui valide le format réel,
// corrige l'orientation et écrit le fichier final sur disque. On ne peut
// plus se fier à l'extension/MIME envoyée par le navigateur (les photos
// iPhone/HEIC arrivent parfois avec un type MIME générique).
const storage = multer.memoryStorage();

module.exports = multer({
  storage,
  // Aligné sur le plafond client (image-upload.js) : le navigateur compresse
  // déjà la photo avant l'envoi — cette limite ne sert que de filet de
  // sécurité pour le cas de secours où l'original brut est envoyé tel quel
  // (échec de préparation côté navigateur).
  limits: { fileSize: 60 * 1024 * 1024 },
});
