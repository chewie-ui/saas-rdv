// Protection contre les injections NoSQL : un attaquant peut envoyer un champ
// (ex. "email") comme un objet MongoDB ({"$ne": null}, {"$regex": "..."}) au
// lieu d'une chaîne — puisque express.json()/urlencoded({extended:true})
// acceptent les objets imbriqués — et le faire atterrir tel quel dans une
// requête Mongoose (ex. User.findOne({ email })). Ce middleware retire
// récursivement toute clé commençant par "$" ou contenant "." de req.body,
// req.params et req.query, avant que la moindre route ne s'exécute.
//
// N'utilise PAS express-mongo-sanitize : ce paquet réassigne `req.query =
// ...`, ce qu'Express 5 interdit (req.query est un getter en lecture seule
// qui re-parse l'URL à chaque accès — le réassigner lève une TypeError et
// planterait TOUTES les requêtes). On redéfinit la propriété via
// Object.defineProperty pour la figer sur la version nettoyée à la place.

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeInPlace(value) {
  if (Array.isArray(value)) {
    value.forEach(sanitizeInPlace);
    return value;
  }
  if (!isPlainObject(value)) return value;

  for (const key of Object.keys(value)) {
    if (key.startsWith("$") || key.includes(".")) {
      delete value[key];
      continue;
    }
    sanitizeInPlace(value[key]);
  }
  return value;
}

module.exports = function mongoSanitize(req, res, next) {
  if (req.body) sanitizeInPlace(req.body);
  if (req.params) sanitizeInPlace(req.params);

  // req.query est un getter (re-parse l'URL à chaque lecture, non mémorisé)
  // — on le fige sur une copie nettoyée pour que toute lecture ultérieure
  // dans la requête voie la version assainie.
  const cleanQuery = sanitizeInPlace({ ...req.query });
  Object.defineProperty(req, "query", {
    value: cleanQuery,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  next();
};
