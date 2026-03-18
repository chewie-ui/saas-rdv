const mongoose = require("mongoose");

const env = process.env.NODE_ENV || "development";

console.log({ env });

const config = require(`../environment/${env}.js`);
console.log({ config });

mongoose
  .connect(config.dbUri)
  .then(() => {
    console.log("db connected");
  })
  .catch((err) => {
    console.error(err);
  });
