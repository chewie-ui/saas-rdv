// ── Routeur de l'API mobile (app pro Branshee) ────────────────────────────
// Monté sur /api/v1 dans app.js, AVANT la session : l'API est stateless (JWT).
// Toutes les réponses sont en JSON. Auth par en-tête Authorization: Bearer.
const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const mobileAuth = require("../../middlewares/mobileAuth");
const mobileCompany = require("../../middlewares/mobileCompany");
const { requirePermission } = mobileCompany;

const authCtrl = require("../../controllers/mobile/auth.mobile.controller");
const dashboardCtrl = require("../../controllers/mobile/dashboard.mobile.controller");
const bookingsCtrl = require("../../controllers/mobile/bookings.mobile.controller");
const catalogCtrl = require("../../controllers/mobile/catalog.mobile.controller");
const writeCtrl = require("../../controllers/mobile/bookingWrite.mobile.controller");
const pushCtrl = require("../../controllers/mobile/push.mobile.controller");
const clientsCtrl = require("../../controllers/mobile/clients.mobile.controller");
const servicesWriteCtrl = require("../../controllers/mobile/servicesWrite.mobile.controller");
const scheduleCtrl = require("../../controllers/mobile/schedule.mobile.controller");
const groupSessionsCtrl = require("../../controllers/mobile/groupSessions.mobile.controller");
const formsCtrl = require("../../controllers/mobile/forms.mobile.controller");
const teamCtrl = require("../../controllers/mobile/team.mobile.controller");
const gradesCtrl = require("../../controllers/mobile/grades.mobile.controller");
const logsCtrl = require("../../controllers/mobile/logs.mobile.controller");
const accountCtrl = require("../../controllers/mobile/account.mobile.controller");
const billingCtrl = require("../../controllers/mobile/billing.mobile.controller");
const integrationsCtrl = require("../../controllers/mobile/integrations.mobile.controller");
const establishmentsCtrl = require("../../controllers/mobile/establishments.mobile.controller");
const establishmentSettingsCtrl = require("../../controllers/mobile/establishmentSettings.mobile.controller");
const businessTypesCtrl = require("../../controllers/mobile/businessTypes.mobile.controller");
const { processSingleImage } = require("../../middlewares/processImageUpload");

// ── CORS ──────────────────────────────────────────────────────────────────
// L'app native ne s'en soucie pas, mais la version web (Expo web, servie sur
// un autre port) est bloquée sans ces en-têtes. Sûr ici : cette API
// s'authentifie exclusivement au token Bearer, jamais au cookie — on
// n'autorise donc PAS les credentials, et aucune session n'est exposée.
router.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Company-Id");
  res.setHeader("Access-Control-Max-Age", "86400");
  // Le préflight doit répondre AVANT toute vérification de token.
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Sonde de vie (utile pour vérifier que l'app pointe le bon serveur).
router.get("/health", (req, res) => res.json({ ok: true, service: "branshee-mobile-api", version: 1 }));

// ── Anti brute-force ──────────────────────────────────────────────────────
// Ces routes tapent exactement la même base `User` que le site : sans limite,
// il suffisait de viser /api/v1/auth/login au lieu de /login pour bourriner
// les mots de passe sans aucun frein. Mêmes fenêtres et mêmes plafonds que
// routes/auth.js. Le comptage se fait par IP — `app.set("trust proxy", 1)`
// est bien actif dans app.js, sinon tout Nginx compterait pour une seule IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Trop de tentatives. Réessayez dans quelques minutes." },
});
// Codes à 6 chiffres (2FA, réinitialisation) : surface bien plus étroite.
const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Trop de tentatives. Réessayez dans quelques minutes." },
});

// ── Auth (public) ─────────────────────────────────────────────────────────
router.post("/auth/login", authLimiter, authCtrl.login);
router.post("/auth/register", authLimiter, authCtrl.register);
router.post("/auth/google", authLimiter, authCtrl.google);
// « Se connecter avec Apple » : exigé par la règle App Store 4.8 dès qu'une
// connexion tierce est proposée. Même limiteur que les autres entrées.
router.post("/auth/apple", authLimiter, authCtrl.apple);
router.post("/auth/2fa", codeLimiter, authCtrl.verify2fa);
router.post("/auth/refresh", authCtrl.refresh);

// Mot de passe oublié : public par nature (l'utilisateur n'a plus d'accès).
// Le parcours est stateless — chaque étape rejoue le jeton signé renvoyé par
// la précédente. Voir le contrôleur pour le détail des garanties.
router.post("/auth/forgot-password", authLimiter, authCtrl.forgotPassword);
router.post("/auth/forgot-password/verify", codeLimiter, authCtrl.forgotPasswordVerify);
router.post("/auth/forgot-password/reset", codeLimiter, authCtrl.forgotPasswordReset);

// Liste des métiers — PUBLIQUE à dessein : l'écran d'inscription la propose
// avant toute connexion, et c'est la même information que le site affiche
// librement. Aucune donnée personnelle, aucun accès à un établissement.
router.get("/business-types", businessTypesCtrl.list);

// ── À partir d'ici : token requis ─────────────────────────────────────────
router.use(mobileAuth);

router.get("/auth/me", authCtrl.me);

// ── Notifications push (liées au compte, pas à un établissement) ──────────
router.post("/push/register", pushCtrl.register);
router.delete("/push/register", pushCtrl.unregister);
router.post("/push/test", pushCtrl.test);

// ── Paramètres du compte & sécurité (liés au compte, pas à un établissement)
// Aucune permission d'établissement ici : chacun gère son propre compte.
// L'activation/désactivation de la 2FA reste sur le site (QR code) — l'app
// n'en affiche que l'état.
router.get("/account/settings", accountCtrl.getSettings);
router.patch("/account/profile", accountCtrl.updateProfile);
router.post("/account/password", accountCtrl.updatePassword);
router.patch("/account/language", accountCtrl.updateLanguage);
router.patch("/account/notifications", accountCtrl.updateNotifications);
// Photo de profil : exactement la chaîne du site (multer en mémoire, filtre de
// type et de taille, puis processSingleImage → sharp → JPEG dans
// public/uploads/profiles). Le chemin stocké est le même des deux côtés.
router.post(
  "/account/photo",
  accountCtrl.photoUploadMiddleware,
  processSingleImage("profilePicture"),
  accountCtrl.setPhoto,
);
router.delete("/account/photo", accountCtrl.deletePhoto);
router.get("/account/2fa/status", accountCtrl.twoFactorStatus);
// Suppression du compte depuis l'app — imposé par la règle App Store 5.1.1(v)
// pour toute app qui permet d'en créer un. Même flux que le site : un code à
// 6 chiffres par email, puis la suppression. `codeLimiter` sur les deux : la
// demande envoie un email (donc pas en boucle), la confirmation teste un code.
router.post("/account/delete/request", codeLimiter, accountCtrl.requestDeletion);
router.post("/account/delete/confirm", codeLimiter, accountCtrl.confirmDeletion);

// ── Intégrations agenda (liées au compte, pas à un établissement) ─────────
// La connexion à Google Calendar reste sur le site (flux OAuth navigateur) :
// l'app affiche l'état, permet la déconnexion, et donne l'URL du flux iCal.
router.get("/integrations", integrationsCtrl.get);
router.post("/integrations/google-calendar/disconnect", integrationsCtrl.disconnectGoogleCalendar);

// ── Établissements : choisir, créer, rejoindre (liés au COMPTE) ───────────
// Volontairement AVANT `mobileCompany` : on ne travaille pas DANS un
// établissement, on choisit lequel — un compte fraîchement créé peut n'en
// avoir aucun et doit quand même pouvoir en créer/rejoindre un.
// `/search` et `/invitations/...` avant les routes à paramètre, sinon elles
// seraient prises pour des identifiants.
router.get("/establishments/search", establishmentsCtrl.search);
router.patch("/establishments/invitations/:membershipId", establishmentsCtrl.respondInvitation);
router.get("/establishments", establishmentsCtrl.list);
router.post("/establishments", establishmentsCtrl.create);
router.post("/establishments/:id/join", establishmentsCtrl.requestJoin);
router.delete("/establishments/:id/join", establishmentsCtrl.cancelJoin);

// ── Réglages d'un établissement (nom, métier, photo, coordonnées) ─────────
// Ici aussi AVANT `mobileCompany` : la permission porte sur l'établissement
// de l'URL, pas sur l'établissement actif — on doit pouvoir régler un
// établissement sans avoir à basculer dessus. `requireManage` fait donc
// lui-même le contrôle `establishment.manage` sur `:id`.
// La photo suit exactement la chaîne du site : multer en mémoire (filtre de
// type + taille) puis processSingleImage (sharp → JPEG dans
// public/uploads/profiles).
router.get("/establishments/:id/settings", establishmentSettingsCtrl.requireManage, establishmentSettingsCtrl.get);
router.patch("/establishments/:id/settings", establishmentSettingsCtrl.requireManage, establishmentSettingsCtrl.update);
router.post(
  "/establishments/:id/photo",
  establishmentSettingsCtrl.requireManage,
  establishmentSettingsCtrl.photoUploadMiddleware,
  processSingleImage("photo"),
  establishmentSettingsCtrl.setPhoto,
);
router.delete("/establishments/:id/photo", establishmentSettingsCtrl.requireManage, establishmentSettingsCtrl.deletePhoto);

// ── Tout ce qui suit dépend d'un établissement actif ──────────────────────
router.use(mobileCompany);

router.get("/dashboard", requirePermission("appointments.view"), dashboardCtrl.dashboard);

router.get("/bookings", requirePermission("appointments.view"), bookingsCtrl.dayAgenda);
router.get("/bookings/upcoming", requirePermission("appointments.view"), bookingsCtrl.upcoming);
// Avant /bookings/:id, sinon "slots" serait pris pour un identifiant.
router.get("/bookings/slots", requirePermission("appointments.view"), writeCtrl.slots);
router.get("/bookings/:id", requirePermission("appointments.view"), bookingsCtrl.detail);

// ── Écritures sur l'agenda ────────────────────────────────────────────────
router.post("/bookings", requirePermission("appointments.manage"), writeCtrl.create);
router.post("/bookings/block", requirePermission("appointments.manage"), writeCtrl.block);
router.patch("/bookings/:id", requirePermission("appointments.manage"), writeCtrl.update);
router.patch("/bookings/:id/no-show", requirePermission("appointments.manage"), writeCtrl.noShow);
// L'annulation exige un droit distinct, comme sur le web.
router.patch("/bookings/:id/cancel", requirePermission("appointments.cancelDelete"), writeCtrl.cancel);

// ── Clients & dossiers de suivi ───────────────────────────────────────────
// La lecture suit la même règle que le web (la liste est adossée à l'agenda),
// l'écriture exige le droit dédié aux fiches clients.
// La fiche suit la même permission que la liste — comme sur le web, où
// /clients-hub et /clients-hub/:id exigent tous deux `appointments.view`.
// Les garder désalignées ne protégeait rien (la liste expose déjà email et
// téléphone) tout en rendant chaque ligne intappable pour ces grades-là.
router.get("/clients", requirePermission("appointments.view"), clientsCtrl.list);
router.get("/clients/:bookingId", requirePermission("appointments.view"), clientsCtrl.detail);
router.patch("/clients/:bookingId", requirePermission("clients.manage"), clientsCtrl.update);
router.patch("/clients/:bookingId/block", requirePermission("clients.manage"), clientsCtrl.block);
// Entrées du dossier de suivi (texte seul depuis l'app — les PDF restent
// ajoutés depuis le site, mais ne sont jamais perdus par ces routes).
// Lecture du PDF d'une entrée : même droit que le web (`clients.view`), car
// ces fichiers peuvent contenir des données de santé.
router.get("/clients/:bookingId/dossier/entries/:entryId/file", requirePermission("clients.view"), clientsCtrl.entryFile);
router.post("/clients/:bookingId/dossier/entries", requirePermission("clients.manage"), clientsCtrl.addEntry);
router.patch("/clients/:bookingId/dossier/entries/:entryId", requirePermission("clients.manage"), clientsCtrl.updateEntry);
router.delete("/clients/:bookingId/dossier/entries/:entryId", requirePermission("clients.manage"), clientsCtrl.deleteEntry);

router.get("/services", requirePermission("services.view"), catalogCtrl.services);
router.post("/services", requirePermission("services.manage"), servicesWriteCtrl.create);
router.patch("/services/:id", requirePermission("services.manage"), servicesWriteCtrl.update);
router.patch("/services/:id/toggle", requirePermission("services.manage"), servicesWriteCtrl.toggle);
router.delete("/services/:id", requirePermission("services.manage"), servicesWriteCtrl.remove);
router.get("/team", catalogCtrl.team);

// ── Cours collectifs ──────────────────────────────────────────────────────
// Lecture : `groupSessions.view` ; planification et désinscription :
// `groupSessions.manage`, comme la page du site.
router.get("/group-sessions", requirePermission("groupSessions.view"), groupSessionsCtrl.list);
router.get(
  "/group-sessions/:serviceId/participants",
  requirePermission("groupSessions.view"),
  groupSessionsCtrl.participants,
);
// Avant les routes à `:serviceId`, sinon "participants" serait pris pour un id.
router.patch(
  "/group-sessions/participants/:bookingId/remove",
  requirePermission("groupSessions.manage"),
  groupSessionsCtrl.removeParticipant,
);
router.post(
  "/group-sessions/:serviceId/sessions",
  requirePermission("groupSessions.manage"),
  groupSessionsCtrl.addSession,
);
router.delete(
  "/group-sessions/:serviceId/sessions/:index",
  requirePermission("groupSessions.manage"),
  groupSessionsCtrl.removeSession,
);
router.patch(
  "/group-sessions/:serviceId/recurring",
  requirePermission("groupSessions.manage"),
  groupSessionsCtrl.setRecurring,
);

// ── Horaires & congés ─────────────────────────────────────────────────────
// La lecture est ouverte à tout membre (l'app en a besoin pour les créneaux) ;
// l'écriture de l'horaire commun exige `availability.manageShared`. Les congés
// vérifient eux-mêmes la permission selon les personnes concernées.
router.get("/schedule", scheduleCtrl.get);
router.patch("/schedule/:weekdayIndex", requirePermission("availability.manageShared"), scheduleCtrl.updateDay);
router.get("/timeoff", scheduleCtrl.listTimeOff);
router.post("/timeoff", scheduleCtrl.addTimeOff);
router.delete("/timeoff/:dateId", scheduleCtrl.removeTimeOff);

// ── Formulaire de pré-réservation ─────────────────────────────────────────
// Un seul formulaire par établissement : lecture et enregistrement complet.
router.get("/forms", requirePermission("forms.manage"), formsCtrl.get);
router.put("/forms", requirePermission("forms.manage"), formsCtrl.save);

// ── Collaborateurs (l'équipe) ─────────────────────────────────────────────
// Lecture : collaborators.view ; écriture : collaborators.manage. Le
// changement de grade exige EN PLUS grades.manage — vérifié dans le
// contrôleur, car la même route sert aussi à (dés)activer un accès, qui ne
// demande que collaborators.manage (cf. règle anti-élévation du web,
// routes/user/account.js).
router.get("/collaborators", requirePermission("collaborators.view"), teamCtrl.list);
router.post("/collaborators", requirePermission("collaborators.manage"), teamCtrl.invite);
// Avant /collaborators/:membershipId, sinon "requests" serait pris pour un id.
router.patch(
  "/collaborators/requests/:membershipId",
  requirePermission("collaborators.manage"),
  teamCtrl.respondRequest,
);
router.patch("/collaborators/:membershipId", requirePermission("collaborators.manage"), teamCtrl.update);
router.delete("/collaborators/:membershipId", requirePermission("collaborators.manage"), teamCtrl.remove);

// ── Grades & permissions ──────────────────────────────────────────────────
// Le référentiel des zones/clés (utils/permissions.js) est servi par /schema :
// l'app construit sa matrice à partir du serveur, jamais en dur.
// Avant /grades/:gradeId, sinon "schema" serait pris pour un identifiant.
router.get("/grades/schema", requirePermission("grades.view"), gradesCtrl.schema);
router.get("/grades", requirePermission("grades.view"), gradesCtrl.list);
router.post("/grades", requirePermission("grades.manage"), gradesCtrl.create);
router.patch("/grades/:gradeId", requirePermission("grades.manage"), gradesCtrl.update);
router.delete("/grades/:gradeId", requirePermission("grades.manage"), gradesCtrl.remove);

// ── Journal d'activité ────────────────────────────────────────────────────
// Lecture seule : l'historique ne se modifie jamais depuis l'app.
router.get("/logs", requirePermission("logs.view"), logsCtrl.list);

// ── Abonnement, crédits SMS/WhatsApp & parrainage ─────────────────────────
// LECTURE SEULE côté paiement : changer de forfait, recharger des SMS ou
// réclamer un mois de parrainage renvoie vers le site (Apple et Google
// prélèvent une commission sur tout achat effectué dans une app). Les seules
// écritures ici sont les bascules d'envoi SMS/WhatsApp, qui ne coûtent rien
// en elles-mêmes et suivent la même permission que le web (page /sms).
router.get("/billing", requirePermission("billing.manage"), billingCtrl.overview);
router.get("/billing/sms", requirePermission("customization.manage"), billingCtrl.sms);
router.patch("/billing/sms-settings", requirePermission("customization.manage"), billingCtrl.updateSmsSettings);
router.get("/billing/referral", requirePermission("billing.manage"), billingCtrl.referral);

module.exports = router;
