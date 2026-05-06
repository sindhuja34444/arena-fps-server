const cors = require("cors");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

let waitingPlayer = null;

const rooms = {};

io.on("connection", (socket) => {

  console.log("Player connected:", socket.id);

  // PLAYER DATA
  socket.playerData = {
    x: 0,
    y: 1.7,
    z: 0,
    yaw: 0,
    pitch: 0,
    hp: 100,
    shield: 100
  };

  // ─────────────────────────────
  // MATCHMAKING
  // ─────────────────────────────

  if (waitingPlayer === null) {

    waitingPlayer = socket;

    socket.emit("pvp:waiting");

  } else {

    const roomId = "room_" + waitingPlayer.id + "_" + socket.id;

    rooms[roomId] = {
      players: [waitingPlayer.id, socket.id]
    };

    waitingPlayer.join(roomId);
    socket.join(roomId);

    waitingPlayer.roomId = roomId;
    socket.roomId = roomId;

    // SEND PLAYER INFO
    waitingPlayer.emit("pvp:opponentJoined", {
      id: socket.id,
      player: socket.playerData
    });

    socket.emit("pvp:opponentJoined", {
      id: waitingPlayer.id,
      player: waitingPlayer.playerData
    });

    // START MATCH
    io.to(roomId).emit("pvp:start");

    waitingPlayer = null;
  }

  // ─────────────────────────────
  // MOVEMENT
  // ─────────────────────────────

  socket.on("pvp:move", (data) => {

    socket.playerData = {
      ...socket.playerData,
      ...data
    };

    socket.to(socket.roomId).emit("pvp:opponentMoved", {
      id: socket.id,
      ...data
    });

  });

  // ─────────────────────────────
  // DAMAGE
  // ─────────────────────────────

  socket.on("pvp:hit", ({ targetId, damage, headshot }) => {

    const target = io.sockets.sockets.get(targetId);

    if (!target) return;

    let remainingDamage = damage;

    // DAMAGE SHIELD FIRST
    if (target.playerData.shield > 0) {

      const shieldDamage = Math.min(
        target.playerData.shield,
        remainingDamage
      );

      target.playerData.shield -= shieldDamage;

      remainingDamage -= shieldDamage;
    }

    // DAMAGE HP
    if (remainingDamage > 0) {

      target.playerData.hp -= remainingDamage;

    }

    // SEND DAMAGE TO TARGET
    target.emit("pvp:hit", {
      shooterId: socket.id,
      damage,
      headshot,
      hp: target.playerData.hp,
      shield: target.playerData.shield
    });

    // CONFIRM HIT TO SHOOTER
    socket.emit("pvp:hitConfirm", {
      targetId,
      damage,
      headshot,
      hp: target.playerData.hp
    });

    // PLAYER DIED
    if (target.playerData.hp <= 0) {

      io.to(socket.roomId).emit("pvp:playerDied", {
        deadId: target.id,
        killerId: socket.id
      });

    }

  });

  // ─────────────────────────────
  // DISCONNECT
  // ─────────────────────────────

  socket.on("disconnect", () => {

    console.log("Disconnected:", socket.id);

    if (waitingPlayer === socket) {
      waitingPlayer = null;
    }

    socket.to(socket.roomId).emit("pvp:opponentLeft", {
      id: socket.id
    });

  });

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});