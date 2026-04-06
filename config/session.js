const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');

module.exports = session({
  secret: process.env.SESSION_SECRET || 'une_phrase_tres_secrete', // Change ça dans ton .env
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 jours
    secure: process.env.NODE_ENV === 'production' // Active le HTTPS en prod
  },
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI, // Ton lien MongoDB (ex: mongodb://localhost:27017/rdv)
    ttl: 14 * 24 * 60 * 60 // Temps de vie sur le serveur (14 jours)
  })
});