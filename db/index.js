const mongoose = require("mongoose");

const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
console.log("MONGO_URI =", process.env.MONGO_URI);
console.log("MONGO_URI_SERVER =", process.env.MONGO_URI_SERVER);
mongoose
  .connect(env.dbUri)
  .then(() => {
    console.log("DB CONNECTED 2:", mongoose.connection.name);
  })
  .catch((err) => {
    console.error(err);
  });
