const mongoose = require("mongoose");

const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

mongoose
  .connect(env.dbUri)
  .then(() => {
    console.log("DB CONNECTED 2:", mongoose.connection.name);
  })
  .catch((err) => {
    console.error(err);
  });
