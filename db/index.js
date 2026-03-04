const mongoose = require("mongoose");

const env = process.env.NODE_ENV || "development"
const config = require(`../environment/${env}.js`);

mongoose
  .connect(config.dbUri)
  .then(() => {
    console.log("db connected");
  })
  .catch((err) => {
    console.error(err);
});
