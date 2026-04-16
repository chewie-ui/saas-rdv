const mongoose = require("mongoose");
require("dotenv").config();
const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

const Companies = require("../db/models/company/company.model");

async function clean() {
  await mongoose.connect(env.dbUri);

  const companies = await Companies.find({}).populate("owner");

  const orphans = companies.filter((c) => !c.owner);

  console.log("A supprimer:", orphans.length);

  for (const c of orphans) {
    console.log("DELETE:", c._id.toString());
    await Companies.findByIdAndDelete(c._id);
  }

  console.log("Terminé");
  process.exit();
}

clean();
