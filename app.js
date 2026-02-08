const express = require("express");
const path = require("path");

require("./db");

const routes = require("./routes");

const app = express();

app.set("view engine", "pug");
app.set("views", path.join(__dirname, "views"));

app.use(express.static(path.join(__dirname, "public")));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(routes);

module.exports = app;
