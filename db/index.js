const mongoose = require("mongoose");

const env = require(`../environment/${process.env.NODE_ENV || "development"}`);

mongoose
  .connect(env.dbUri)
  .then(async () => {
    console.log("DB CONNECTED 2:", mongoose.connection.name);

    // Drop the old unique index { date, startTime } that was replaced by
    // { company, date, startTime, employee } to allow multiple employees
    // to have bookings at the same time slot.
    try {
      const Booking = require("./models/book.model");
      await Booking.collection.dropIndex("date_1_startTime_1");
      console.log("[DB] Dropped legacy booking index date_1_startTime_1");
    } catch (e) {
      // Index doesn't exist — nothing to do
    }
  })
  .catch((err) => {
    console.error(err);
  });
