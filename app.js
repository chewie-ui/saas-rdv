require("dotenv").config();
const env = require(`./environment/${process.env.NODE_ENV || "development"}`);

const express = require("express");
const compression = require("compression");
const helmet = require("helmet");
const path = require("path");
const passport = require("passport");
const cookieParser = require("cookie-parser");
require("./db");

const googleCalendarRoutes = require("./routes/googleCalendar.routes");
const routes = require("./routes");

const app = express();

app.set("trust proxy", 1);

// ── Domaine canonique (www) ─────────────────────────────────────────────────
// Le cookie de session est "host-only" (pas de Domain explicite) : se connecter
// sur branshee.com puis naviguer vers www.branshee.com (ou l'inverse) atterrit
// dans un AUTRE cookie jar → l'utilisateur semble déconnecté alors que sa
// session est toujours valide sur l'autre hôte. On force tout le trafic vers
// un seul hôte (www) avant toute logique de session. GET/HEAD uniquement pour
// ne jamais rediriger les webhooks Stripe (POST).
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    const host = req.headers.host || "";
    if ((req.method === "GET" || req.method === "HEAD") && host === "branshee.com") {
      return res.redirect(301, `https://www.branshee.com${req.originalUrl}`);
    }
    next();
  });
}

// Compress all HTTP responses (gzip/br)
app.use(compression());

// En-têtes de sécurité de base (retire X-Powered-By, X-Content-Type-Options,
// etc.). On désactive volontairement plusieurs protections par défaut de
// Helmet qui casseraient des fonctionnalités existantes du site :
// - contentSecurityPolicy : le site utilise énormément de <script> inline
//   (window.__t, gtag, Stripe, Clarity...) sans nonce — une CSP par défaut
//   bloquerait tout. À traiter comme un chantier séparé si besoin un jour.
// - frameguard (X-Frame-Options) : la page de réservation est pensée pour
//   être intégrée en iframe sur le site du pro ("widget"), donc jamais DENY.
// - crossOriginEmbedderPolicy / crossOriginOpenerPolicy /
//   crossOriginResourcePolicy : casseraient Stripe Elements (iframe),
//   Google OAuth et l'intégration du widget sur des domaines tiers.
app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
}));

app.set("view engine", "pug");

app.set("view options", {
  compileDebug: true,
});

app.set("views", path.join(__dirname, "views", "pages"));

app.use(express.static(path.join(__dirname, "public")));

app.use(cookieParser());

const User = require("./db/models/user.model");
const Subscription = require("./db/models/subscription.model");
const Company = require("./db/models/company/company.model");
const Stripe = require("stripe");
const stripe = Stripe(env.stripeSecretKey); // Assure-toi que la clé est dans ton .env
const injectSubscription = require("./middlewares/injectSubscription");
// Middleware spécial pour Stripe qui a besoin du body "raw" pour vérifier la signature
// ── Révoque l'accès premium suite à une fin d'abonnement (annulation ou
// échecs de paiement). On retrouve l'utilisateur par son abonnement Stripe
// courant — si son sub courant ne correspond pas (ex : il s'est déjà
// réabonné avec un nouveau sub), on ne touche à rien. manualPremium (octroi
// superadmin) survit : on ne coupe que isPremium/status, et getPlan continue
// d'accorder l'accès aux comptes manualPremium.
// Déduit le plan (« business » / « essentiel » / « pro ») à partir d'un price ID
// Stripe. Couvre toutes les périodicités (mensuel / 6 mois / annuel). Renvoie
// null si le prix est inconnu → dans ce cas on ne modifie PAS le plan (sécurité).
function planFromPriceId(priceId) {
  if (!priceId) return null;
  const inList = (arr) => arr.filter(Boolean).includes(priceId);
  if (inList([env.stripePriceBusinessMonthly, env.stripePriceBusinessSixMonths, env.stripePriceBusinessYearly])) return "business";
  if (inList([env.stripePriceEssentielMonthly, env.stripePriceEssentielYearly])) return "essentiel";
  if (inList([env.stripePricePremiumMonthly, env.stripePricePremiumSixMonths, env.stripePricePremiumYearly])) return "pro";
  return null;
}

async function revokePremiumBySubId(stripeSubscriptionId) {
  if (!stripeSubscriptionId) return;

  // ── Per-établissement : l'établissement rattaché à cet abonnement repasse
  // en gratuit (source de vérité cible). Cf. facturation par établissement.
  await Company.updateMany(
    { stripeSubscriptionId },
    { plan: "", planStatus: "cancelled", stripeSubscriptionId: "" }
  );

  const user = await User.findOne({ "subscription.stripeSubscriptionId": stripeSubscriptionId }).select("_id manualPremium").lean();
  if (!user) return;
  // Dual-write legacy (compte) — conservé le temps de la transition.
  await User.findByIdAndUpdate(user._id, {
    isPremium: false,
    "subscription.status": "cancelled",
  });
  await Subscription.updateMany(
    { user: user._id, stripeSubscriptionId },
    { status: "cancelled" }
  );
  console.log("🚫 Accès premium révoqué (abonnement terminé) pour user", String(user._id));
}

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
    } else if (session.mode === "payment") {
      // Paiement unique (recharge de solde SMS) — ne touche JAMAIS aux champs
      // subscription.* de l'utilisateur, contrairement au flux abonnement.
      if (session.metadata?.type === "sms_topup") {
        const { creditSmsTopup } = require("./controllers/account.controller");
        await creditSmsTopup(session.metadata.userId, session.id, parseInt(session.metadata.amountCents, 10) || 0);
      }
    } else {
      const expirationDate = new Date();
      expirationDate.setMonth(expirationDate.getMonth() + 1);

      try {
        // Déterminer le plan depuis le price ID
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
        const priceId = lineItems.data[0]?.price?.id || "";
        console.log("💳 priceId:", priceId);
        // Prix inconnu → « pro » par défaut (comportement historique), sinon le
        // plan exact (gère aussi les prix « 6 mois » qui étaient mal classés).
        const planName = planFromPriceId(priceId) || "pro";
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

          // ── Écriture PER-ÉTABLISSEMENT (source de vérité cible) ─────────────
          // Le forfait s'applique à l'établissement ciblé au checkout
          // (metadata.companyId), sinon au 1er établissement possédé (compat).
          let companyId = session.metadata?.companyId || "";
          if (!companyId) {
            const firstOwned = await Company.findOne({ owner: userId, isDeleted: { $ne: true } })
              .sort({ createdAt: 1 }).select("_id").lean();
            companyId = firstOwned?._id ? String(firstOwned._id) : "";
          }
          if (companyId) {
            await Company.findByIdAndUpdate(companyId, {
              plan: planName,
              planStatus: "active",
              stripeSubscriptionId: session.subscription,
            });
            console.log(`✅ Forfait ${planName} rattaché à l'établissement ${companyId}`);
          }

          // Appliquer les limites du plan à CET établissement (rogne l'excédent)
          const { enforcePlanLimits } = require("./controllers/account.controller");
          enforcePlanLimits(userId, planName, companyId || null).catch(() => {});

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

  // ── Renouvellement mensuel réussi → prolonge l'accès (30 j de plus) ─────────
  else if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    try {
      const invoice = event.data.object;
      const subId = invoice.subscription;
      // La 1re facture (création) est déjà gérée par checkout.session.completed ;
      // on ne traite ici que les renouvellements de cycle.
      if (subId && invoice.billing_reason && invoice.billing_reason !== "subscription_create") {
        // Per-établissement : le forfait de l'établissement rattaché reste actif.
        await Company.updateMany({ stripeSubscriptionId: subId }, { planStatus: "active" });

        const user = await User.findOne({ "subscription.stripeSubscriptionId": subId }).select("_id").lean();
        if (user) {
          const newEnd = new Date();
          newEnd.setMonth(newEnd.getMonth() + 1);
          await User.findByIdAndUpdate(user._id, { isPremium: true, "subscription.status": "active" });
          await Subscription.updateMany(
            { user: user._id, stripeSubscriptionId: subId, status: { $ne: "superseded" } },
            { status: "active", endDate: newEnd }
          );
          console.log("✅ Renouvellement abonnement pour user", String(user._id));
        }
      }
    } catch (e) { console.log("❌ Erreur webhook invoice.paid:", e.message); }
  }

  // ── Statut de l'abonnement modifié (impayé, annulé…) → coupe si nécessaire ───
  else if (event.type === "customer.subscription.updated") {
    try {
      const sub = event.data.object;
      // Statuts qui coupent l'accès. On laisse « past_due » tranquille : Stripe
      // réessaie encore le paiement (période de grâce) — l'accès n'est coupé que
      // si ça se solde par unpaid/canceled (ou par l'événement .deleted).
      const revoke = ["canceled", "unpaid", "incomplete_expired"];
      if (revoke.includes(sub.status)) {
        await revokePremiumBySubId(sub.id);
      } else if (sub.status === "active" || sub.status === "trialing") {
        const user = await User.findOne({ "subscription.stripeSubscriptionId": sub.id }).select("_id subscription").lean();
        if (user) {
          // Déduire le plan du prix courant → gère les CHANGEMENTS DE PLAN faits
          // hors de l'app (portail Stripe, dashboard, prorations planifiées…),
          // pas seulement le changement de statut. Prix inconnu → on ne touche
          // pas au plan (sécurité).
          const planName = planFromPriceId(sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id);
          const userUpdate = { isPremium: true, "subscription.status": "active" };
          if (planName) userUpdate["subscription.plan"] = planName;
          await User.findByIdAndUpdate(user._id, userUpdate);

          if (planName) {
            await Subscription.updateMany(
              { user: user._id, stripeSubscriptionId: sub.id, status: { $ne: "superseded" } },
              { plan: planName, status: "active" }
            );
            // ── Per-établissement : répercuter le plan sur l'établissement
            // rattaché à cet abonnement, et rogner son excédent si downgrade.
            const targetCompany = await Company.findOne({ stripeSubscriptionId: sub.id }).select("_id plan").lean();
            if (targetCompany) {
              await Company.findByIdAndUpdate(targetCompany._id, { plan: planName, planStatus: "active" });
              if (targetCompany.plan && targetCompany.plan !== planName) {
                try { require("./controllers/account.controller").enforcePlanLimits(user._id, planName, String(targetCompany._id)).catch(() => {}); } catch (_) {}
              }
            }
            // Si le plan a réellement changé (souvent un downgrade), on rogne le
            // contenu excédentaire selon le nouveau plan (services, employés…).
            const prevPlan = user.subscription && user.subscription.plan;
            if (prevPlan && prevPlan !== planName) {
              if (!targetCompany) {
                try { require("./controllers/account.controller").enforcePlanLimits(user._id, planName).catch(() => {}); } catch (_) {}
              }
              console.log(`🔄 Changement de plan ${prevPlan} → ${planName} pour user ${String(user._id)}`);
            }
          }
        }
      }
    } catch (e) { console.log("❌ Erreur webhook subscription.updated:", e.message); }
  }

  // ── Abonnement supprimé (fin d'engagement OU échecs de paiement) → révoque ───
  else if (event.type === "customer.subscription.deleted") {
    try {
      await revokePremiumBySubId(event.data.object.id);
    } catch (e) { console.log("❌ Erreur webhook subscription.deleted:", e.message); }
  }

  res.json({ received: true });
});
require("./config/passport");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Doit tourner APRÈS les parseurs de body (rien à nettoyer avant) et AVANT
// toute route/session (protège aussi la lecture de la session/passport).
app.use(require("./middlewares/mongoSanitize"));

app.use(require("./config/session"));

app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
  res.locals.user = req.user;
  // Make request path available to all views (used for canonical URL)
  res.locals.reqPath = req.path === "/" ? "" : req.path;
  next();
});

// Rend `clientUser`/`clientSession` disponibles sur TOUTES les pages (pas
// uniquement celles qui pensaient à les calculer) → corrige le bouton
// « Espace client » manquant dans la topbar sur certaines pages publiques.
app.use(require("./middlewares/injectClientUser"));

// Cache du sidebar admin les liens de nav désactivés par le superadmin
// (page /superadmin → section Navigation). Détecté automatiquement depuis
// sidebar.pug — aucune liste à maintenir quand un nouveau lien est ajouté.
app.use(require("./middlewares/navVisibility"));

// Compteur de vues du site (total + visiteurs uniques), affiché dans le
// superadmin. Cookie longue durée, fire-and-forget, ne bloque jamais la requête.
app.use(require("./middlewares/trackPageView"));

const fs = require("fs");

app.use((req, res, next) => {
  const lang = req.cookies.user_lang || "fr";

  const supported = ["fr", "en", "nl", "de", "es", "it"];
  const safeLang = supported.includes(lang) ? lang : "fr";
  const filePath = path.join(__dirname, `./locales/${safeLang}.json`);
  const translations = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  res.locals.t = translations;
  // safeLang (pas le cookie brut) : un cookie user_lang invalide donnait un
  // attribut html lang="<valeur arbitraire>" sur toutes les pages.
  res.locals.lang = safeLang;

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

// Body JSON invalide (bots/scanners qui POSTent du JSON pourri comme "@" ou
// "test_data" sur toutes les routes) — renvoyer un 400 propre au lieu de
// laisser body-parser cracher une stack trace à chaque requête. Ces requêtes
// sont du bruit d'Internet, pas une vraie erreur de l'app : on les jette
// silencieusement pour garder les logs lisibles.
app.use((err, req, res, next) => {
  if (err && (err.type === "entity.parse.failed" || (err.status === 400 && err instanceof SyntaxError))) {
    return res.status(400).json({ success: false, message: "Requête invalide." });
  }
  next(err);
});

// Erreurs multer (ex: fichier image trop volumineux) — renvoyer un message
// clair en JSON plutôt que de laisser planter la requête en page d'erreur.
app.use((err, req, res, next) => {
  if (err && err.name === "MulterError") {
    const message = err.code === "LIMIT_FILE_SIZE"
      ? "Cette image est trop volumineuse (60 Mo max)."
      : "Erreur lors de l'envoi du fichier.";
    return res.status(400).json({ success: false, message });
  }
  next(err);
});

// Filet final : toute autre erreur non gérée par une route est logguée puis
// renvoyée en 500 propre, SANS jamais faire tomber le process. Sans ça,
// Express affiche sa page d'erreur par défaut et loggue une stack brute.
app.use((err, req, res, next) => {
  console.error("[app error]", req.method, req.originalUrl, "-", err && err.message);
  if (res.headersSent) return next(err);
  res.status(err && err.status ? err.status : 500).json({
    success: false,
    message: "Une erreur est survenue.",
  });
});

module.exports = app;
