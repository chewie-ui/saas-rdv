# AI Agent Instructions for BranShee SaaS Booking Platform

## Project Overview

**BranShee** is a multi-tenant SaaS appointment booking platform (`saas-rdv` = SaaS Rendez-vous). It enables service providers to manage bookings, integrate with Google Calendar, accept payments via Stripe, and communicate with clients. The platform supports 6 languages and has both admin (staff) and client interfaces.

## Tech Stack

- **Backend**: Express.js 5.x, Node.js
- **Database**: MongoDB with Mongoose 9.x ODM
- **Frontend**: Pug templating, vanilla JS, Socket.io
- **Authentication**: Passport.js (Local strategy for admins), session-based for clients
- **Integrations**: Google Calendar API, Stripe (payments), Sendinblue (email), Nodemailer
- **Utilities**: node-cron (scheduled tasks), Multer (file uploads), i18n (6 languages)
- **Build/Run**: npm scripts (`npm run dev` for development, `npm start` for production)

## Architecture & Conventions

### Project Structure

```
├── bin/www.js              # Entry point, HTTP server, Socket.io setup
├── app.js                  # Express app configuration, Stripe webhooks
├── package.json            # Dependencies and scripts
├── environment/            # Config by NODE_ENV
│   ├── development.js      # Dev environment variables
│   └── production.js       # Prod environment variables
├── config/                 # Third-party integrations
│   ├── passport.js         # Passport strategy configuration
│   ├── googleCalendar.js   # Google Calendar integration
│   ├── session.js          # Session store (connect-mongo)
│   ├── multer.js           # File upload configuration
│   └── stripe.js           # Stripe setup (if exists)
├── controllers/            # Business logic handlers
│   ├── {entity}.controller.js
│   └── {feature}.controller.js
├── db/                     # Database layer
│   ├── index.js            # MongoDB/Mongoose connection
│   └── models/             # Mongoose schemas
├── middlewares/            # Express middlewares
│   ├── isAuth.js           # Admin authentication guard
│   ├── isClientAuth.js     # Client authentication guard
│   ├── injectCompany.js    # Injects company into res.locals
│   └── injectSubscription.js # Injects subscription status
├── routes/                 # Express Router definitions
│   ├── index.js            # Main router with landing page
│   ├── auth.js             # Admin authentication routes
│   ├── client-auth.js      # Client authentication routes
│   ├── admin.js            # Admin dashboard routes
│   ├── booking.js          # Booking management routes
│   ├── company.js          # Company settings routes
│   ├── user/account.js     # User account routes
│   ├── api.js              # REST API endpoints
│   └── googleCalendar.routes.js # Google Calendar sync routes
├── utils/                  # Helper functions & utilities
│   ├── mailer.js           # Email sending (Sendinblue)
│   ├── reminderScheduler.js # Scheduled reminders (24-48h before booking)
│   ├── googleCalendarSync.js # Google Calendar integration logic
│   ├── defaultSchedule.js  # Default business hours template
│   └── services.js         # Shared service functions
├── queries/                # Reusable database queries
│   └── booking.queries.js  # Booking-specific queries
├── locales/                # Translation files
│   ├── fr.json, en.json, es.json, it.json, nl.json, de.json
│   └── Structure: { "sidebar": {"a_1": "string"}, "common": {...} }
├── public/                 # Static assets
│   ├── css/                # Stylesheets (component & layout based)
│   ├── js/                 # Client-side JavaScript
│   ├── images/             # Images & logos
│   └── uploads/profiles/   # User profile pictures (uploaded via Multer)
├── views/                  # Pug templates
│   ├── common/             # Reusable components (sidebar, topbar, footer)
│   ├── layouts/            # Base templates (admin.pug, client.pug, index.pug)
│   └── pages/              # Page-specific templates
│       ├── admin/          # Admin panel pages
│       ├── client/         # Client portal pages
│       └── auth/           # Authentication pages
└── scripts/                # Utility scripts (data cleanup, migration)
```

### MVC Pattern

- **Models**: `db/models/*.model.js` define Mongoose schemas with validation, timestamps, and indexes
- **Controllers**: `controllers/*.controller.js` contain route handlers with exports like `exports.dashboard`, `exports.createBooking`
- **Views**: Pug templates in `views/pages/` or `views/layouts/`
- **Routes**: `routes/*.js` define Express routers, mounted in `routes/index.js`

### Authentication & Authorization

**Admins (Service Providers)**:
- Login with email + password via Passport.js Local strategy
- Password hashed with bcrypt (`^6.0.0`)
- Session stored in MongoDB via `connect-mongo`
- Protected routes use `isAuth` middleware
- Role enforcement: checking if user owns the `Company` or checking `isPremium` boolean

**Clients**:
- Session-based authentication without Passport
- `req.session.clientId` tracks logged-in client
- Protected routes use `isClientAuth` middleware
- No role/permission system; clients see only their own bookings

**Premium Features**:
- Gated by `user.isPremium` boolean
- Synced with Stripe `Subscription` model on webhook (`checkout.session.completed`)
- Subscription expiry checked in `injectSubscription` middleware; renewal required on expiration

### Middleware Stack for Protected Routes

```javascript
// Typical admin route pattern:
router.get("/dashboard", isAuth, injectCompany, injectSubscription, (req, res) => {
  res.render("admin/dashboard", {
    user: req.user,
    company: res.locals.company,
    isPremium: res.locals.isPremium
  });
});

// Middleware order:
// 1. isAuth - verifies req.user exists (Passport middleware)
// 2. injectCompany - loads company, sets res.locals.company
// 3. injectSubscription - loads subscription, sets res.locals.isPremium
```

### Translations (i18n)

- Language cookie: `user_lang` (defaults to `en`)
- Loaded from `locales/{lang}.json` on each request via middleware
- Injected as `res.locals.t` for view access: `#{t.sidebar.a_1}`
- 6 supported languages: `fr`, `en`, `nl`, `es`, `it`, `de`
- **All JSON files must have identical key structure** across languages

### Key Models & Relationships

```
User
├── email (unique, lowercase)
├── password (bcrypt hashed)
├── company (ObjectId → Company)
├── isPremium (boolean)
├── profilePicture (default: /images/no-user.webp)
└── Other: fullName, phone, bio, calendarColor, googleRefreshToken, etc.

Company
├── owner (ObjectId → User)
├── name
├── description
└── settings (daysOff, schedule, etc.)

Booking
├── company (ObjectId → Company)
├── user (ObjectId → User) - service provider
├── client (ObjectId → Client)
├── status (enum: ["canceled", "confirmed", "pending"])
├── date
├── startTime, endTime
├── googleEventId (for Calendar sync)
└── reminderSent (boolean, prevents duplicate reminders)

Client
├── email (unique)
├── name
├── phone
└── company (ObjectId → Company)

Subscription
├── user (ObjectId → User)
├── plan (enum: ["premium"])
├── status (enum: ["active", "inactive"])
├── startDate, endDate
├── stripeCustomerId, stripeSubscriptionId
└── amount, currency
```

## Common Development Tasks

### Adding a New Admin Route

1. **Create controller** in `controllers/{feature}.controller.js`:
```javascript
exports.getFeature = async (req, res) => {
  const company = res.locals.company;
  const data = await Model.find({ company: company._id });
  res.render("admin/feature", { data, title: "Feature" });
};
```

2. **Add route** in `routes/{feature}.js` or append to existing route file:
```javascript
const router = require("express").Router();
const { getFeature } = require("../controllers/feature.controller");
const isAuth = require("../middlewares/isAuth");
const injectCompany = require("../middlewares/injectCompany");

router.get("/feature", isAuth, injectCompany, getFeature);
module.exports = router;
```

3. **Mount route** in `routes/index.js`:
```javascript
router.use(require("./feature"));
```

4. **Create view** in `views/pages/admin/feature.pug`:
```pug
extends ../../layouts/admin.pug

block content
  h1= title
  each item in data
    p= item.name
```

### Sending Email

Use `sendEmail(to, subject, html)` from `utils/mailer.js`:
```javascript
const { sendEmail } = require("../utils/mailer");

// In a controller:
await sendEmail(
  user.email,
  "Booking Confirmation",
  `<p>Your booking is confirmed for ${date}</p>`
);
```

**Note**: Uses **Sendinblue API** (SibApiV3Sdk), not Nodemailer directly. API key required in `.env` as `SENDINBLUE_API_KEY`.

### Syncing with Google Calendar

Use functions from `utils/googleCalendarSync.js`:
```javascript
const { addEventToCalendar, deleteEventFromCalendar } = require("../utils/googleCalendarSync");

// Add booking to calendar
await addEventToCalendar(user, booking);

// Delete booking from calendar
await deleteEventFromCalendar(user, booking);
```

**Requirements**:
- User must have `googleRefreshToken` stored (obtained during OAuth flow in `/auth/google` or similar)
- Config in `config/googleCalendar.js` must have Google API credentials

### Handling File Uploads (Profile Pictures)

Multer is configured in `config/multer.js` for `public/uploads/profiles/`:
```javascript
const multer = require("../config/multer");

router.post("/upload-profile", multer.single("profilePicture"), async (req, res) => {
  const filename = req.file.filename;
  await User.findByIdAndUpdate(req.user._id, {
    profilePicture: `/uploads/profiles/${filename}`
  });
  res.redirect("/profile");
});
```

### Processing Stripe Webhooks

Webhook handler in `app.js` processes `checkout.session.completed`. On payment success:
1. Creates or updates `Subscription` document
2. Sets `User.isPremium = true`
3. Scheduled reminders and premium features become available

**Key**: Stripe signature validation must succeed; webhook endpoint `/account/webhook` requires raw body.

### Scheduling Reminders

`reminderScheduler.js` runs via `node-cron` on server startup:
1. Finds bookings with status `confirmed` and date in 24–48h window
2. Checks `reminderSent` flag; skips if already sent
3. Renders Pug email template from `views/templates/emails/`
4. Sends email and marks `reminderSent: true`

To customize reminder timing, edit `reminderScheduler.js` cron expression and date range logic.

## Common Patterns & Best Practices

### Query Patterns

**Lean queries** for read-only operations (faster):
```javascript
const company = await Company.findById(companyId).lean();
```

**Populate** for related data:
```javascript
const bookings = await Booking.find({ company: id }).populate("user", "fullName email");
```

**Uniqueness checks** before create (no unique constraint on create in Mongoose by default):
```javascript
const existing = await User.findOne({ email });
if (existing) return res.render("form", { error: "Email taken" });
```

### Error Handling

No global error handler middleware in use. Pattern:
- Controllers use try/catch; on error, re-render form with `error` property or send 500
- Validation errors render the form with submitted data + error message
- Async route handlers should be wrapped to prevent unhandled promise rejections

**Recommendation**: Use [express-async-errors](https://www.npmjs.com/package/express-async-errors) for automatic error propagation, or wrap manually:
```javascript
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.get("/", asyncHandler(getFeature));
```

### Translation Keys

All keys nested under namespaces (e.g., `t.sidebar`, `t.common`, `t.auth`). Add new keys:
1. Add to all 6 JSON files in `locales/` with identical keys
2. Use in views: `h1= t.newNamespace.key_name`
3. Use in controllers (if needed): `res.locals.t.auth.error_message`

### View Structure

- **Layouts**: Base HTML structure with blocks (`extends ../../layouts/admin.pug`)
- **Includes**: Reusable components (`include ../../common/sidebar.pug`)
- **Blocks**: `block content`, `block scripts` for child template overrides
- **Locals**: Access `user`, `company`, `isPremium`, `t` (translations) in all views

## Development Workflow

### Starting Development

```bash
npm run dev  # Nodemon watches for changes, restarts on file save
```

Environment: Loads `environment/development.js`; uses local Stripe keys, MongoDB dev instance.

### Production Build

```bash
npm start  # NODE_ENV=production, uses production config
```

### Environment Variables (`.env`)

Required keys for development:
```
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/saas-rdv
STRIPE_SECRET_KEY_LOCAL=sk_test_...
STRIPE_WEBHOOK_KEY_LOCAL=whsec_test_...
SENDINBLUE_API_KEY=xsb-...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
SESSION_SECRET=your_session_secret
```

## Important Files & Key Functions

| File | Purpose |
|------|---------|
| `app.js` | Express setup, Stripe webhook handler, Pug engine config |
| `bin/www.js` | Server creation, Socket.io, reminder scheduler startup |
| `routes/index.js` | Router mounting, landing page GET `/` |
| `db/index.js` | MongoDB/Mongoose connection initialization |
| `middlewares/injectCompany.js` | Loads company, injects into `res.locals` |
| `utils/reminderScheduler.js` | Cron-based booking reminders (24–48h window) |
| `utils/googleCalendarSync.js` | Add/delete events to Google Calendar |
| `config/passport.js` | Passport Local strategy setup with bcrypt |
| `locales/fr.json` (+ others) | Translation strings for all UI text |
| `views/layouts/admin.pug` | Admin base template with sidebar |
| `views/layouts/client.pug` | Client base template |

## Common Pitfalls & Solutions

| Pitfall | Solution |
|---------|----------|
| **Email not sending** | Verify `SENDINBLUE_API_KEY` in `.env`. Emails are async; check logs for API errors. |
| **Google Calendar sync fails** | User must have valid `googleRefreshToken`. Check Google API credentials in `config/googleCalendar.js`. |
| **Route 404 on new feature** | Ensure router is mounted in `routes/index.js` with `router.use()`. |
| **Translations missing** | Must add keys to **all 6 JSON files** in `locales/` with identical structure. |
| **Premium features not gating** | Check `injectSubscription` middleware; verify Stripe webhook fires on payment. |
| **File upload fails** | Verify `public/uploads/profiles/` directory exists and is writable. Check Multer config in `config/multer.js`. |
| **Database queries slow** | Use `.lean()` for read-only operations; add indexes on frequently queried fields. |
| **Unhandled promise rejections** | Wrap async route handlers with try/catch or use `express-async-errors` middleware. |

## Code Style & Naming Conventions

- **Controllers**: `{feature}.controller.js`, exports named functions: `exports.create`, `exports.update`, `exports.delete`
- **Models**: `{entity}.model.js`, Mongoose schema + export
- **Routes**: `{feature}.js`, mounted with `router.use(require("./feature"))`
- **Middleware**: `{purpose}.js`, named exports: `module.exports = (req, res, next) => {}`
- **Utils**: descriptive names: `reminderScheduler.js`, `googleCalendarSync.js`, `mailer.js`
- **Variables**: camelCase for JS, kebab-case for HTML attributes/CSS classes
- **Database**: Use `.lean()` for performance; `.populate()` for relationships

## Resources & Integration Documentation

- **Express.js**: [https://expressjs.com/](https://expressjs.com/)
- **Mongoose**: [https://mongoosejs.com/](https://mongoosejs.com/)
- **Passport.js**: [https://www.passportjs.org/](https://www.passportjs.org/)
- **Stripe API**: [https://stripe.com/docs/api](https://stripe.com/docs/api)
- **Google Calendar API**: [https://developers.google.com/calendar](https://developers.google.com/calendar)
- **Pug Templating**: [https://pugjs.org/](https://pugjs.org/)
- **i18n Node**: [https://www.npmjs.com/package/i18n](https://www.npmjs.com/package/i18n)

---

**Last Updated**: May 5, 2026  
**Project**: BranShee SaaS Booking Platform  
**Target Audience**: AI coding agents, new developers
