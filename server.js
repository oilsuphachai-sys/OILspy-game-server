const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

// ตั้งค่า CORS ให้รับการเชื่อมต่อจากหน้าเว็บได้ทุกที่ (เพื่อความง่ายในการพัฒนา)
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {}; // ตัวแปรเก็บข้อมูลห้องทั้งหมด

io.on('connection', (socket) => {
  console.log('มีผู้ใช้เชื่อมต่อ:', socket.id);

  // 1. ระบบสร้างห้อง
  socket.on('createRoom', ({ isHostPlaying, playerName }, callback) => {
    const roomCode = Math.random().toString(36).substring(2, 6).toUpperCase(); // สุ่มรหัส 4 หลัก
    
    rooms[roomCode] = {
      hostId: socket.id,
      isHostPlaying: isHostPlaying,
      players: [],
      settings: { spyCount: 1, includeJoker: false, includeFBI: false, includeSeer: false, timerSeconds: 180, categories: [] },
      state: 'waiting'
    };
    
    // ถ้าครู/คนสร้าง เลือกเล่นด้วย ก็แอดตัวเองเข้าห้อง
    if (isHostPlaying && playerName) {
      rooms[roomCode].players.push({ id: socket.id, name: playerName });
    }
    
    socket.join(roomCode);
    console.log(`ห้อง ${roomCode} ถูกสร้างโดย ${socket.id}`);
    
    callback({ success: true, roomCode, roomData: rooms[roomCode] });
  });

  // 2. ระบบเข้าร่วมห้อง
  socket.on('joinRoom', ({ roomCode, playerName }, callback) => {
    const room = rooms[roomCode];
    if (!room) return callback({ success: false, message: 'ไม่พบรหัสห้องนี้' });
    if (room.state !== 'waiting') return callback({ success: false, message: 'เกมเริ่มไปแล้ว ไม่สามารถเข้าได้' });

    const newPlayer = { id: socket.id, name: playerName };
    room.players.push(newPlayer);
    socket.join(roomCode);
    
    // บรอดแคสต์บอกทุกคนในห้องว่ามีคนเข้ามาใหม่
    io.to(roomCode).emit('updatePlayers', room.players);
    callback({ success: true, roomData: room });
  });

  // 3. ระบบโชว์การตั้งค่าแบบเรียลไทม์ใน Lobby
  socket.on('updateLobbySettings', ({ roomCode, settings }) => {
    const room = rooms[roomCode];
    // ต้องเป็น Host เท่านั้นถึงจะมีสิทธิ์เปลี่ยนตั้งค่า
    if (room && room.hostId === socket.id) {
      room.settings = settings;
      io.to(roomCode).emit('settingsUpdated', settings);
    }
  });

  // 4. ระบบ Host เตะผู้เล่นออก (เผื่อมีคนแกล้งพิมพ์ชื่อแปลกๆ เข้ามา)
  socket.on('kickPlayer', ({ roomCode, playerId }) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.players = room.players.filter(p => p.id !== playerId);
      io.to(roomCode).emit('updatePlayers', room.players);
      io.to(playerId).emit('kicked'); // เตือนคนที่โดนเตะ
    }
  });

  socket.on('disconnect', () => {
    console.log('ผู้ใช้ตัดการเชื่อมต่อ:', socket.id);
    // (เดี๋ยวเราจะมาเขียนโค้ดจัดการตอนคนหลุดทีหลังครับ)
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server กำลังรันที่ Port ${PORT}`);
});
