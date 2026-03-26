require("dotenv").config();
const mongoose = require("mongoose");

const uri = process.env.MONGO_URI || config.dbUri;

mongoose
  .connect(uri)
  .then(() => {
    console.log("DB CONNECTED TO:", mongoose.connection.name);
  })
  .catch((err) => {
    console.error(err);
  });
