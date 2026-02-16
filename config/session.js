const session = require("express-session");

module.exports = session({
  name: "app.sid",
  secret: "f93K$!2xZpA8@0LqY#D9wP2mX7B",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    maxAge: 1000 * 60 * 60 * 24,
  },
});
