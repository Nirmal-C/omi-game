# 🃏 Omi — Sri Lankan Card Game (Multiplayer)

Real-time 4-player Omi card game with WebSocket multiplayer.

## Quick Start

### 1. Install dependencies
```bash
cd omi-game
npm install
```

### 2. Start the server
```bash
npm start
```

The server runs on **http://localhost:3000**

### 3. Play on your local network
- Open `http://localhost:3000` on the host machine
- Other players on the same Wi-Fi open `http://<your-local-IP>:3000`
  - Find your local IP with: `ipconfig` (Windows) or `ifconfig` / `ip a` (Mac/Linux)
  - Example: `http://192.168.1.42:3000`

---

## How to Play

1. **One player** clicks **Create Room** → shares the 4-letter code
2. **Three others** click **Join Room** → enter the code
3. Game starts automatically when all 4 join
4. Teams: Seats 1 & 3 (North/South) = **Team A** | Seats 2 & 4 (East/West) = **Team B**

### Rules Summary
- 32-card deck (7–A in each suit), 4 cards each dealt first
- Player to dealer's right **chooses trumps** based on first 4 cards
- All 8 cards dealt, trump chooser leads the first trick
- Play is **counter-clockwise**, must follow suit if possible
- **Scoring:**
  - Trump choosers win 5–7 tricks → **+1 token**
  - Non-choosers win 5–7 tricks → **+2 tokens**
  - Either team wins all 8 (Kapothi!) → **+3 tokens**
  - 4–4 draw → no tokens, but +1 bonus next round
- **First team to 10 tokens wins!**

---

## Hosting Online (Optional)

To let players join from anywhere (not just your local network):

### Option A: Railway / Render (free hosting)
1. Push this folder to a GitHub repo
2. Deploy on [Railway](https://railway.app) or [Render](https://render.com)
3. Set `PORT` environment variable (they set it automatically)
4. Share your deployment URL

### Option B: ngrok (quick tunnel)
```bash
npm start          # in one terminal
ngrok http 3000    # in another terminal
```
Share the ngrok URL with your friends.

### Option C: VPS (DigitalOcean, Linode, etc.)
```bash
# On your VPS
git clone <your-repo>
cd omi-game
npm install
npm install -g pm2
pm2 start server.js --name omi
pm2 save
```
Open port 3000 in your firewall rules.

---

## Project Structure
```
omi-game/
├── server.js           # Express + WebSocket server
├── package.json
├── src/
│   ├── gameLogic.js    # Card game rules engine
│   └── roomManager.js  # Room & game state management
└── public/
    └── index.html      # Full game UI (single file)
```

## Features
- ✅ Real-time 4-player multiplayer via WebSockets
- ✅ Room codes — share with friends to join
- ✅ Full Omi ruleset (trump selection, trick-taking, Kapothi)
- ✅ Token scoring to 10
- ✅ Perspective-aware table (you're always at the bottom)
- ✅ Reconnection support
- ✅ Mobile friendly
- ✅ Game log with play-by-play
