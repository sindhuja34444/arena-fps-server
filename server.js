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

// ─────────────────────────────────────────────
// SPAWN POINTS
// ─────────────────────────────────────────────

const SPAWNS = [
  { x: -28, y: 1.7, z: 0, yaw: 0 },
  { x: 28, y: 1.7, z: 0, yaw: Math.PI }
];

// roomCode -> waiting socket
const waitingRooms = {};

// roomId -> room data
const rooms = {};

io.on("connection", (socket) => {

  console.log("Player connected:", socket.id);

  socket.roomId = null;

  socket.playerData = {
    x: 0,
    y: 1.7,
    z: 0,
    yaw: 0,
    pitch: 0,
    hp: 100,
    shield: 100
  };

  // ─────────────────────────────────────────────
  // ROOM JOIN
  // ─────────────────────────────────────────────

  socket.on("pvp:joinRoom", (roomCode) => {

    roomCode = String(roomCode || "").slice(0, 4);

    if (roomCode.length !== 4) {
      socket.emit("pvp:error", {
        msg: "Invalid room code"
      });
      return;
    }

    console.log(socket.id, "joining code", roomCode);

    // REMOVE DEAD SOCKETS
    if (
      waitingRooms[roomCode] &&
      !waitingRooms[roomCode].connected
    ) {
      delete waitingRooms[roomCode];
    }

    // FIRST PLAYER
    if (!waitingRooms[roomCode]) {

      waitingRooms[roomCode] = socket;

      socket.roomCode = roomCode;

      socket.emit("pvp:waiting");

      console.log("Waiting in room:", roomCode);

      return;
    }

    // SAME PLAYER CHECK
    if (waitingRooms[roomCode].id === socket.id) {
      return;
    }

    // SECOND PLAYER FOUND
    const opponent = waitingRooms[roomCode];

    delete waitingRooms[roomCode];

    const roomId =
      "room_" + roomCode + "_" + Date.now();

    rooms[roomId] = {
      code: roomCode,
      players: [
        opponent.id,
        socket.id
      ]
    };

    opponent.join(roomId);
    socket.join(roomId);

    opponent.roomId = roomId;
    socket.roomId = roomId;

    // RESET PLAYER STATS
    opponent.playerData.hp = 100;
    opponent.playerData.shield = 100;

    socket.playerData.hp = 100;
    socket.playerData.shield = 100;

    // SEND OPPONENT DATA
    opponent.emit("pvp:opponentJoined", {
      id: socket.id,
      player: {
        ...socket.playerData,
        ...SPAWNS[1]
      }
    });

    socket.emit("pvp:opponentJoined", {
      id: opponent.id,
      player: {
        ...opponent.playerData,
        ...SPAWNS[0]
      }
    });

    // START MATCH
    opponent.emit("pvp:start", {
      spawn: SPAWNS[0]
    });

    socket.emit("pvp:start", {
      spawn: SPAWNS[1]
    });

    console.log(
      "MATCH STARTED:",
      opponent.id,
      "vs",
      socket.id,
      "CODE:",
      roomCode
    );
  });

  // ─────────────────────────────────────────────
  // MOVEMENT
  // ─────────────────────────────────────────────

  socket.on("pvp:move", (data) => {

    Object.assign(socket.playerData, data);

    if (!socket.roomId) return;

    socket.to(socket.roomId).emit(
      "pvp:opponentMoved",
      {
        id: socket.id,
        ...data
      }
    );
  });

  // ─────────────────────────────────────────────
  // DAMAGE
  // ─────────────────────────────────────────────

  socket.on("pvp:hit", ({
    targetId,
    damage,
    headshot
  }) => {

    const target =
      io.sockets.sockets.get(targetId);

    if (!target) return;

    let finalDamage = damage || 25;

    if (headshot) {
      finalDamage *= 2;
    }

    // SHIELD
    if (target.playerData.shield > 0) {

      const absorbed = Math.min(
        target.playerData.shield,
        finalDamage
      );

      target.playerData.shield -= absorbed;

      finalDamage -= absorbed;
    }

    // HP
    if (finalDamage > 0) {

      target.playerData.hp -= finalDamage;

      if (target.playerData.hp < 0) {
        target.playerData.hp = 0;
      }
    }

    // SEND DAMAGE TO TARGET
    target.emit("pvp:hit", {
      shooterId: socket.id,
      damage,
      headshot,
      hp: target.playerData.hp,
      shield: target.playerData.shield
    });

    // CONFIRM TO SHOOTER
    socket.emit("pvp:hitConfirm", {
      targetId,
      damage,
      headshot,
      hp: target.playerData.hp
    });

    // PLAYER DEAD
    if (target.playerData.hp <= 0) {

      io.to(socket.roomId).emit(
        "pvp:playerDied",
        {
          deadId: target.id,
          killerId: socket.id
        }
      );
    }
  });

  // ─────────────────────────────────────────────
  // REMATCH
  // ─────────────────────────────────────────────

  socket.on("pvp:rematch", () => {

    if (!socket.roomId) return;

    const room = rooms[socket.roomId];

    if (!room) return;

    const p1 =
      io.sockets.sockets.get(room.players[0]);

    const p2 =
      io.sockets.sockets.get(room.players[1]);

    if (p1) {
      p1.playerData.hp = 100;
      p1.playerData.shield = 100;

      p1.emit("pvp:start", {
        spawn: SPAWNS[0]
      });
    }

    if (p2) {
      p2.playerData.hp = 100;
      p2.playerData.shield = 100;

      p2.emit("pvp:start", {
        spawn: SPAWNS[1]
      });
    }
  });

  // ─────────────────────────────────────────────
  // DISCONNECT
  // ─────────────────────────────────────────────

  socket.on("disconnect", () => {

    console.log("Disconnected:", socket.id);

    // REMOVE WAITING PLAYER
    for (const code in waitingRooms) {

      if (
        waitingRooms[code] &&
        waitingRooms[code].id === socket.id
      ) {
        delete waitingRooms[code];
      }
    }

    // INFORM OPPONENT
    if (socket.roomId) {

      socket.to(socket.roomId).emit(
        "pvp:opponentLeft",
        {
          id: socket.id
        }
      );

      delete rooms[socket.roomId];
    }
  });

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    "Server running on port " + PORT
  );
});