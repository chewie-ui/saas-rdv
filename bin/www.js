const http = require("http");
const https = require("https");

const app = require("../app.js");
const server = http.createServer(app);

const { Server } = require("socket.io");
const io = new Server(server);

io.on("connection", (socket) => {});

server.listen(3000, () => {
  console.log("server on");
});
