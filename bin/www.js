const http = require("http");
const https = require("https");

const app = require("../app.js");

const server = http.createServer(app);

server.listen(3000, () => {
  console.log("server on");
});
