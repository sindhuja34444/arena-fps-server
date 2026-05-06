const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const players = {};

io.on("connection", (socket) => {

  console.log("Player joined:", socket.id);

  players[socket.id] = {
    x: 0,
    y: 1.7,
    z: 0,
    rotationY: 0
  };

  socket.emit("currentPlayers", players);

  socket.broadcast.emit("newPlayer", {
    id: socket.id,
    player: players[socket.id]
  });

  socket.on("move", (data) => {

    if (players[socket.id]) {

      players[socket.id] = data;

      socket.broadcast.emit("playerMoved", {
        id: socket.id,
        player: data
      });
    }
  });

  socket.on("disconnect", () => {

    console.log("Player left:", socket.id);

    delete players[socket.id];

    io.emit("playerDisconnected", socket.id);
  });

});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});