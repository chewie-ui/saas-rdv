const mongoose = require("mongoose");

const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
console.log(process.env.NODE_ENV);

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

    // The unique index on { company, date, startTime, employee } now has a new
    // partialFilterExpression (excludes group bookings). Mongo won't update an
    // existing index's options automatically, so drop the old one and let
    // syncIndexes recreate it with the new definition.
    try {
      const Booking = require("./models/book.model");
      await Booking.collection.dropIndex("company_1_date_1_startTime_1_employee_1");
      console.log("[DB] Dropped legacy booking index company_1_date_1_startTime_1_employee_1");
    } catch (e) {
      // Index doesn't exist — nothing to do
    }
    try {
      const Booking = require("./models/book.model");
      await Booking.syncIndexes();
      console.log("[DB] Booking indexes synced");
    } catch (e) {
      console.error("[DB] Failed to sync Booking indexes:", e.message);
    }
  })
  .catch((err) => {
    console.error(err);
  });
