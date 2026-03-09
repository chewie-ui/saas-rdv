require("dotenv").config();
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
const injectCompanyRole = require("./middlewares/companyRole");

app.use(injectCompanyRole);
app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

require("./config/passport");
app.use((req, res, next) => {
  console.log("REQUEST:", req.method, req.url);
  next();
});

// Route temporaire de preview
app.get("/preview", (req, res) => {
  res.render("../templates/emails/booking-confirmed", {
    startHour: "14:30",
    endHour: "15:30",
    slotTime: 60,
    name: "John",
    surname: "Doe",
    date: "12/03/2026",
  });
});

app.use(routes);

module.exports = app;
