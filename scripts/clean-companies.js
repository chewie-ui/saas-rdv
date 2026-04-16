const mongoose = require("mongoose");

const Companies = require("../db/models/company/company.model");
const User = require("../db/models/user.model");

async function clean() {
  await mongoose.connect(
retryWrites=true&w=majority",
  );

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
