// omi-game/server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { handleJoin, handleAction, handleDisconnect } = require('./src/roomManager');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for all routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw);
      switch (data.type) {
        case 'join':
          handleJoin(ws, data);
          break;
        case 'action':
          handleAction(ws, data);
          break;
        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (e) {
      console.error('Message parse error:', e);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err);
  });

  // Ping keepalive
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Heartbeat to detect dead connections
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🃏 Omi Game Server running on http://localhost:${PORT}`);
  console.log(`   Share your local IP so others on the same network can join.\n`);
});
