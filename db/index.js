const mongoose = require("mongoose");

mongoose
  .connect("mongodb://localhost:27017/rdv")
  .then(() => {
    console.log("db connected");
  })
  .catch((err) => {
    console.error(err);
  });
