require("dotenv").config();
const mongoose = require("mongoose");

const env = require(`../environment/${process.env.NODE_ENV}`);

mongoose
  .connect(env.dbUri)
  .then(() => {
    console.log("DB CONNECTED TO:", mongoose.connection.name);
  })
  .catch((err) => {
    console.error(err);
  });
