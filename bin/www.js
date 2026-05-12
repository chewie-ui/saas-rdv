const http = require("http");
const https = require("https");

const app = require("../app.js");
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const { Server } = require("socket.io");
const io = new Server(server);

const reminderScheduler = require("../utils/reminderScheduler");

io.on("connection", (socket) => {});

server.listen(PORT, () => {
  console.log("server on Branshee.com");
  // Démarre le système de rappels 24h avant chaque rdv
  reminderScheduler.start();
});
