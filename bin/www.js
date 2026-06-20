const http = require("http");
const https = require("https");

const app = require("../app.js");
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const { Server } = require("socket.io");
const io = new Server(server);

// Accessible depuis les contrôleurs via req.app.get("io") pour émettre des
// événements temps réel (ex: nouveau message de chat support).
app.set("io", io);

const reminderScheduler = require("../utils/reminderScheduler");

// ── Chat support : chaque socket rejoint sa room explicitement ─────────────
// On a essayé de partager la session Express (passport) avec les sockets via
// io.engine.use(sessionMiddleware), mais c'est peu fiable selon le transport
// (polling vs websocket) — résultat : le temps réel ne marchait pas côté
// utilisateur. Plus simple et fiable : le client, une fois la page chargée
// (donc déjà authentifié côté HTTP), demande explicitement à rejoindre sa
// room. Aucun risque : ces rooms ne servent qu'à déclencher un *signal* de
// rafraîchissement — le contenu réel des messages passe toujours par les
// routes REST authentifiées (req.user._id / isSuperAdmin), jamais par le socket.
io.on("connection", (socket) => {
  socket.on("support:joinUser", (userId) => {
    if (userId && typeof userId === "string") socket.join(`user:${userId}`);
  });
  socket.on("support:joinAdmin", () => {
    socket.join("superadmin");
  });
});

server.listen(PORT, () => {
  console.log("server on Branshee.com");
  // Démarre le système de rappels 24h avant chaque rdv
  reminderScheduler.start();
});
