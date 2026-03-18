require("dotenv").config();
const mongoose = require("mongoose");

const env = process.env.NODE_ENV || "development";
console.log({ env });

const config = require(`../environment/${env}.js`);
console.log({ config });

const uri = process.env.MONGO_URI || config.dbUri;
console.log({ uri });

mongoose
  .connect(uri)
  .then(() => {
    console.log("db connected");
  })
  .catch((err) => {
    console.error(err);
  });
