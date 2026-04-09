# 🃏 Omi — Sri Lankan Card Game (Multiplayer)

Real-time 4-player Omi. Uses Socket.io (WebSocket + polling fallback).

> ⚠️ Do NOT host on Vercel — it's serverless and can't hold WebSocket state.
> Use Railway, Render, or Fly.io (all free tiers available).

## Deploy to Railway (Easiest)

1. Push this folder to GitHub
2. railway.app → New Project → Deploy from GitHub repo
3. Settings → Networking → Generate Domain
4. Share the URL — done! ✅

## Deploy to Render

1. Push to GitHub → render.com → New Web Service
2. Build command: `npm install` | Start command: `npm start`

## Run Locally

```bash
npm install && npm start
# http://localhost:3000
```

## Rules
- 4 players, 2 teams (N/S vs E/W)
- Player to dealer's right picks trumps from first 4 cards
- Trump choosers win 5-7 tricks = +1 token
- Non-choosers win 5-7 tricks = +2 tokens  
- All 8 tricks (Kapothi) = +3 tokens
- First to 10 tokens wins
