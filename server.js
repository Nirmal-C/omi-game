// server.js — Omi card game server using Socket.io
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { handleJoin, handleAction, handleDisconnect } = require('./src/roomManager');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);
  socket.on('join', (data) => handleJoin(socket, data, io));
  socket.on('action', (data) => handleAction(socket, data, io));
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    handleDisconnect(socket, io);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🃏 Omi running on http://0.0.0.0:${PORT}\n`);
});
