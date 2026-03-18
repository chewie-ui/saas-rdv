const http = require("http");
const https = require("https");
const PORT = process.env.PORT || 3000;

const app = require("../app.js");
const server = http.createServer(app);

const { Server } = require("socket.io");
const io = new Server(server);

io.on("connection", (socket) => {});
console.log(`PORT: `, PORT);

server.listen(PORT, () => {
  console.log("server on");
});
