const express = require("express");
const path = require("path");
const passport = require("passport");

require("./db");

const routes = require("./routes");

const app = express();

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views", "pages"));

app.use(express.static(path.join(__dirname, "public")));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(require("./config/session"));

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

require("./config/passport");

app.use(routes);

module.exports = app;
