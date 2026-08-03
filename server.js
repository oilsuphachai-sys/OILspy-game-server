const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('มีผู้ใช้เชื่อมต่อ:', socket.id);

  // --- 1. ระบบ Lobby (สร้าง/เข้าห้อง) ---
  socket.on('createRoom', ({ isHostPlaying, playerName }, callback) => {
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
    rooms[roomCode] = {
      hostId: socket.id,
      isHostPlaying: isHostPlaying,
      players: [],
      settings: { spyCount: 1, includeJoker: false, includeFBI: false, includeSeer: false, timerSeconds: 180, categories: [] },
      state: 'waiting'
    };
    if (isHostPlaying && playerName) {
      rooms[roomCode].players.push({ id: socket.id, name: playerName });
    }
    socket.join(roomCode);
    callback({ success: true, roomCode, roomData: rooms[roomCode] });
  });

  socket.on('joinRoom', ({ roomCode, playerName }, callback) => {
    const room = rooms[roomCode];
    if (!room) return callback({ success: false, message: 'ไม่พบรหัสห้องนี้' });
    if (room.state !== 'waiting') return callback({ success: false, message: 'เกมเริ่มไปแล้ว ไม่สามารถเข้าได้' });

    const newPlayer = { id: socket.id, name: playerName };
    room.players.push(newPlayer);
    socket.join(roomCode);
    
    io.to(roomCode).emit('updatePlayers', room.players);
    callback({ success: true, roomData: room });
  });

  socket.on('updateLobbySettings', ({ roomCode, settings }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.settings = settings;
      socket.to(roomCode).emit('settingsUpdated', settings);
    }
  });

  socket.on('kickPlayer', ({ roomCode, playerId }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.players = room.players.filter(p => p.id !== playerId);
      io.to(roomCode).emit('updatePlayers', room.players);
      io.to(playerId).emit('kicked');
      const targetSocket = io.sockets.sockets.get(playerId);
      if (targetSocket) targetSocket.leave(roomCode);
    }
  });

  // --- 2. ระบบเริ่มเกมและแจกบทบาท ---
  socket.on('startGame', ({ roomCode, roles, word, category }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.state = 'playing';
      // ส่งข้อมูลลับ (บทบาท/คำลับ) ไปให้ผู้เล่นแต่ละคนโดยตรง
      room.players.forEach(p => {
        const playerRole = roles[p.id];
        const playerWord = (playerRole === 'spy') ? '?????' : word;
        io.to(p.id).emit('gameStarted', { role: playerRole, word: playerWord, category });
      });
      // แจ้ง Host ว่าเกมเริ่มแล้ว
      io.to(room.hostId).emit('hostGameStarted', { roles, word, category });
    }
  });

  // --- 3. ระบบรับส่งสถานะเกมระหว่างเล่น (Host <-> Players) ---
  socket.on('changePhase', ({ roomCode, phase }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.state = phase;
      io.to(roomCode).emit('phaseChanged', phase);
    }
  });

  socket.on('updateTimer', ({ roomCode, timeLeft }) => {
    socket.to(roomCode).emit('timerSync', timeLeft);
  });

  socket.on('playerAction', ({ roomCode, action, data }) => {
    const room = rooms[roomCode];
    if (room) {
      io.to(room.hostId).emit('playerActionReceived', { playerId: socket.id, action, data });
    }
  });

  socket.on('hostUpdateGame', ({ roomCode, updateData }) => {
    io.to(roomCode).emit('gameUpdated', updateData);
  });

  // --- 4. ระบบจัดการคนออก ---
  socket.on('disconnect', () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        io.to(roomCode).emit('updatePlayers', room.players);
        
        // ถ้าคนสร้างห้องออก ให้แจ้งเตือนและปิดห้อง
        if (room.hostId === socket.id) {
          io.to(roomCode).emit('roomClosed', 'ผู้สร้างห้องออกจากการเชื่อมต่อ เกมถูกยกเลิก');
          delete rooms[roomCode];
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server กำลังรันที่ Port ${PORT}`);
});
