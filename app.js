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
  // LOCAL : STRIPE_WEBHOOK_SECRET  |  SERVER : stripeWebhookSecret via env config
  const endpointSecret = env.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET;

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
    console.log("📦 Session reçue :", session.id, "| payment_status:", session.payment_status);
    console.log("👤 User ID (client_reference_id) :", session.client_reference_id);

    // Accepter paid ET no_payment_required (code promo 100%)
    const validPaymentStatus = ["paid", "no_payment_required"];
    if (!validPaymentStatus.includes(session.payment_status)) {
      console.log("⚠️ payment_status non valide:", session.payment_status, "— skip");
    } else {
      const expirationDate = new Date();
      expirationDate.setMonth(expirationDate.getMonth() + 1);

      try {
        // Déterminer le plan depuis le price ID
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
        const priceId = lineItems.data[0]?.price?.id || "";
        console.log("💳 priceId:", priceId);
        const isBusinessPrice = [
          env.stripePriceBusinessMonthly,
          env.stripePriceBusinessYearly,
        ].filter(Boolean).includes(priceId);
        const planName = isBusinessPrice ? "business" : "pro";
        console.log("📋 planName:", planName);

        const userId = session.client_reference_id;
        if (!userId) {
          console.log("❌ client_reference_id manquant dans la session Stripe");
        } else {
          // Désactiver les anciens docs Subscription actifs
          await Subscription.updateMany(
            { user: userId, status: "active" },
            { status: "superseded" }
          );

          await Subscription.findOneAndUpdate(
            { user: userId, stripeSubscriptionId: session.subscription },
            {
              user:                userId,
              plan:                planName,
              status:              "active",
              startDate:           new Date(),
              endDate:             expirationDate,
              stripeCustomerId:    session.customer,
              stripeSubscriptionId: session.subscription,
              amount:              (session.amount_total || 0) / 100,
              currency:            session.currency,
            },
            { upsert: true, new: true },
          );

          await User.findByIdAndUpdate(userId, {
            isPremium:                           true,
            manualPremium:                       false,
            "subscription.plan":                 planName,
            "subscription.status":               "active",
            "subscription.stripeCustomerId":     session.customer,
            "subscription.stripeSubscriptionId": session.subscription,
          });
          console.log(`✅ Plan activé : ${planName} pour user ${userId}`);

          // ── Activer les add-ons si présents dans les metadata ──────────────
          const addon = session.metadata?.addon;
          if (addon === "customUrl" && userId) {
            await User.findByIdAndUpdate(userId, { "addons.customUrl": true });
            console.log(`✅ Add-on customUrl activé pour user ${userId}`);
          }

          // ── Récompense parrainage : incrémenter le parrain ──────────────────
          try {
            const newUser = await User.findById(userId).select("referredBy").lean();
            if (newUser?.referredBy) {
              const referrer = await User.findByIdAndUpdate(
                newUser.referredBy,
                { $inc: { "referral.totalPaying": 1, "referral.creditMonths": 1 } },
                { new: true }
              ).select("email fullName subscription referral").lean();

              if (referrer) {
                console.log(`🎁 Parrainage : ${referrer.fullName} gagne 1 mois gratuit (filleul payant)`);
                // Appliquer le mois gratuit sur l'abonnement Stripe du parrain si possible
                const subId = referrer.subscription?.stripeSubscriptionId;
                if (subId) {
                  try {
                    const monthlyAmount = planName === "business" ? 4900 : 1900; // centimes
                    const coupon = await stripe.coupons.create({
                      amount_off: monthlyAmount,
                      currency: "eur",
                      duration: "once",
                      name: `Parrainage — 1 mois offert`,
                    });
                    await stripe.subscriptions.update(subId, {
                      discounts: [{ coupon: coupon.id }],
                    });
                    await User.findByIdAndUpdate(newUser.referredBy, {
                      $inc: { "referral.creditMonths": -1 },
                    });
                    console.log(`✅ Coupon parrainage appliqué sur sub ${subId}`);
                  } catch (couponErr) {
                    console.warn("Coupon parrainage non appliqué:", couponErr.message);
                    // Le credit reste en attente, sera appliqué manuellement
                  }
                }
              }
            }
          } catch (refErr) {
            console.error("Referral reward error:", refErr.message);
          }
        }
      } catch (dbErr) {
        console.log("❌ Erreur webhook:", dbErr.message);
      }
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
