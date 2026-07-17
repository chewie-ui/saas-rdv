const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");
const User = require("../db/models/user.model");

passport.use(
  new LocalStrategy(
    { usernameField: "email" },
    async (email, password, done) => {
      try {
        const user = await User.findOne({ email });

        if (!user) {
          return done(null, false);
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
          return done(null, false);
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    },
  ),
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    // On EXCLUT les champs sensibles de `req.user` (présent sur res.locals.user,
    // donc potentiellement rendu dans un template) : mot de passe haché, secret
    // 2FA, jetons Google Calendar. Aucun handler ne lit ces champs depuis
    // req.user (ils re-chargent l'user au besoin), donc c'est sans effet
    // fonctionnel — juste une réduction de surface d'exposition.
    const user = await User.findById(id).select(
      "-password -twoFA.secret -googleCalendar.refreshToken -googleCalendar.accessToken"
    );
    done(null, user);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;
