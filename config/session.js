const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const session = require("express-session");
const MongoStore = require("connect-mongo").default;

// Le secret DOIT venir de SESSION_SECRET (.env) — un secret en dur dans le repo
// permettrait à n'importe qui ayant le code source de forger des cookies de session.
if (!env.sessionSecret) {
  console.warn(
    "[session] SESSION_SECRET manquant dans .env — un secret de secours est utilisé. " +
    "Définis SESSION_SECRET pour sécuriser les sessions correctement."
  );
}

const store = MongoStore.create({
  mongoUrl: env.dbUri || "mongodb://localhost:27017/rdv",
  collectionName: "sessions",
  autoRemove: "interval",
  autoRemoveInterval: 10,
});

// Visibilité : si le store Mongo perd la connexion, les sessions ne sont plus
// persistées (déconnexions intempestives) — on veut le voir dans les logs.
store.on("error", (err) => {
  console.error("[session] Erreur du store MongoDB :", err);
});

module.exports = session({
  secret: env.sessionSecret || "une_phrase_tres_secrete",
  resave: false,
  saveUninitialized: false,
  rolling: true, // chaque requête prolonge l'expiration → reste connecté tant qu'on est actif
  proxy: true,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 jours, glissant grâce à `rolling`
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  },
  store,
});