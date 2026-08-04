const mongoose = require("mongoose");

const env = require(`../environment/${process.env.NODE_ENV || "development"}`);
console.log(process.env.NODE_ENV);

mongoose
  .connect(env.dbUri)
  .then(async () => {
    console.log("DB CONNECTED 2:", mongoose.connection.name);

    // Métiers validés par le superadmin : `getServices()` est synchrone (appelé
    // depuis des dizaines de vues), il lit un cache mémoire. Sans ce chargement
    // au démarrage, un métier validé redeviendrait « non reconnu » à chaque
    // redémarrage du serveur.
    try {
      const n = await require("../utils/services").refreshApprovedJobTitles();
      if (n.length) console.log(`[metiers] ${n.length} metier(s) valide(s) charge(s)`);
    } catch (e) {
      console.error("[metiers] chargement impossible:", e.message);
    }

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

    // The unique index on { company, date, startTime, employee } uses
    // partialFilterExpression: { status:"confirmed", isGroup: false }.
    // MongoDB doesn't support $ne in partial filters, so we use isGroup: false
    // (equality). First, backfill all existing bookings that lack the field.
    try {
      const Booking = require("./models/book.model");
      const res = await Booking.collection.updateMany(
        { isGroup: { $exists: false } },
        { $set: { isGroup: false } }
      );
      if (res.modifiedCount > 0) {
        console.log(`[DB] Backfilled isGroup=false on ${res.modifiedCount} bookings`);
      }
    } catch (e) {
      console.error("[DB] Failed to backfill isGroup:", e.message);
    }

    // Même raison pour `isBlock` : le filtre partiel exige l'égalité stricte,
    // donc un document antérieur au champ sortirait de l'index et perdrait sa
    // protection contre le double-booking.
    try {
      const Booking = require("./models/book.model");
      const res = await Booking.collection.updateMany(
        { isBlock: { $exists: false } },
        { $set: { isBlock: false } }
      );
      if (res.modifiedCount > 0) {
        console.log(`[DB] Backfilled isBlock=false on ${res.modifiedCount} bookings`);
      }
    } catch (e) {
      console.error("[DB] Failed to backfill isBlock:", e.message);
    }

    // Drop the old index (may have wrong partialFilterExpression) and let
    // syncIndexes recreate it with the correct definition.
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
