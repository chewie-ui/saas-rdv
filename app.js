require("dotenv").config();
const env = require(`./environment/${process.env.NODE_ENV || "development"}`);

const express = require("express");
const compression = require("compression");
const path = require("path");
const passport = require("passport");
const cookieParser = require("cookie-parser");
require("./db");

const googleCalendarRoutes = require("./routes/googleCalendar.routes");
const routes = require("./routes");

const app = express();

app.set("trust proxy", 1);

// Compress all HTTP responses (gzip/br)
app.use(compression());

app.set("view engine", "pug");

app.set("view options", {
  compileDebug: true,
});

app.set("views", path.join(__dirname, "views", "pages"));

app.use(express.static(path.join(__dirname, "public")));

app.use(cookieParser());

const User = require("./db/models/user.model");
const Subscription = require("./db/models/subscription.model");
const Stripe = require("stripe");
const stripe = Stripe(env.stripeSecretKey); // Assure-toi que la clé est dans ton .env
const injectSubscription = require("./middlewares/injectSubscription");
// Middleware spécial pour Stripe qui a besoin du body "raw" pour vérifier la signature
app.post("/account/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  console.log("--- Webhook Reçu ---"); // Pour vérifier que la route est touchée

  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    console.log("✅ Signature Webhook valide ! Type:", event.type);
  } catch (err) {
    console.log("❌ Erreur de signature :", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    console.log("📦 Session reçue :", session.id);
    console.log("👤 User ID (client_reference_id) :", session.client_reference_id);
    const expirationDate = new Date();
    expirationDate.setMonth(expirationDate.getMonth() + 1);

    try {
      // Determine plan from the Stripe price ID used
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
      const priceId = lineItems.data[0]?.price?.id || "";
      const env = require("./environment");
      const isBusinessPrice = [
        env.stripePriceBusinessMonthly,
        env.stripePriceBusinessYearly,
        env.stripePricePlanBusiness,
      ].filter(Boolean).includes(priceId);
      const planName = isBusinessPrice ? "business" : "pro";

      // Désactiver les anciens docs Subscription actifs
      await Subscription.updateMany(
        { user: session.client_reference_id, status: "active" },
        { status: "superseded" }
      );

      await Subscription.findOneAndUpdate(
        { user: session.client_reference_id, stripeSubscriptionId: session.subscription },
        {
          user: session.client_reference_id,
          plan: planName,
          status: "active",
          startDate: new Date(),
          endDate: expirationDate,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          amount: session.amount_total / 100,
          currency: session.currency,
        },
        { upsert: true, new: true },
      );
      // Update user: isPremium + subscription.plan
      await User.findByIdAndUpdate(session.client_reference_id, {
        isPremium: true,
        "subscription.plan":   planName,
        "subscription.status": "active",
        "subscription.stripeCustomerId":    session.customer,
        "subscription.stripeSubscriptionId": session.subscription,
      });
      console.log(`✅ Plan activé : ${planName} pour user ${session.client_reference_id}`);
    } catch (dbErr) {
      console.log("❌ Erreur lors du Subscription.create :", dbErr.message);
    }
  }

  res.json({ received: true });
});
require("./config/passport");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(require("./config/session"));

app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
  res.locals.user = req.user;
  // Make request path available to all views (used for canonical URL)
  res.locals.reqPath = req.path === "/" ? "" : req.path;
  next();
});

const fs = require("fs");

app.use((req, res, next) => {
  const lang = req.cookies.user_lang || "fr";

  const supported = ["fr", "en", "nl", "de", "es", "it"];
  const safeLang = supported.includes(lang) ? lang : "fr";
  const filePath = path.join(__dirname, `./locales/${safeLang}.json`);
  const translations = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  res.locals.t = translations;
  res.locals.lang = lang;

  next();
});

app.use((req, res, next) => {
  console.log("REQ =>", req.method, req.originalUrl);
  next();
});

app.use((req, res, next) => {
  next();
});
app.use(injectSubscription);

app.use(googleCalendarRoutes);
app.use(routes);

module.exports = app;
