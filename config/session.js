const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const session = require("express-session");
const MongoStore = require("connect-mongo").default;

module.exports = session({
  secret: env.sessionSecret || "une_phrase_tres_secrete",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  },
  store: MongoStore.create({
    mongoUrl: env.dbUri || "mongodb://localhost:27017/rdv",
    collectionName: "sessions",
    // Optionnel : ajoute autoRemove: 'interval' pour nettoyer les vieilles sessions
    autoRemove: "interval",
    autoRemoveInterval: 10,
  }),
});
