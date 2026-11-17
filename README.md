# Prism Arena — Multiplayer 3D Laser Tag

A real-time multiplayer first-person laser tag game built with **Three.js** (PBR rendering + client-side snapshot interpolation & prediction), **Cannon.js (`cannon-es`)** (60 Hz server-authoritative physics & laser raycast collision detection), **WebSockets (`ws`)**, **SQLite (`node:sqlite`)**, and **WebRTC** team voice channels.

## Features

- **Authoritative Server Physics (`cannon-es`)**: 60 Hz server physics simulation with static cover blocks, elevated catwalks, walkable ramps, player capsules, and server-side raycast hit/headshot detection.
- **Low-Latency Networking**: Client-side movement prediction + sequence reconciliation for local controls and a 100 ms snapshot interpolation buffer for remote players.
- **Secure Matchmaking & Accounts**: `bcryptjs` password hashing, signed JWT session tokens, and cryptographically signed matchmaking tickets (`roomId`, `team`, `mmr`), with persistent MMR, wins, tags, and accuracy stats in SQLite.
- **Custom Arena Map Builder**: Interactive blueprint editor to design cover layouts, bridges, ramps, spawns, and recharge pads, publish to the server, or export/import JSON.
- **Team Chat & WebRTC Voice Channels**: Team-scoped `[TEAM]` / `[ALL]` text chat and peer-to-peer WebRTC team voice channels with Push-to-Talk (`V`), mute, and voice activity detection.

## Local Development

```bash
npm install
npm run dev
```

Runs the Express + WebSocket + Vite dev server on `http://localhost:3000`.

## Deploying on Vercel Free Tier

Vercel's Hobby (free) serverless functions are stateless and terminate after a short timeout, so they cannot host a persistent 60 Hz `cannon-es` physics loop or long-lived WebSocket connections (`ws`) inside a serverless function.

`vercel.json` is pre-configured so the frontend deploys cleanly on **Vercel Free Tier**:

1. **Deploy the stateful WebSocket + Cannon.js game server** (`npm start` / `node server.ts`) to any Node host with a free tier (Render, Railway, Fly.io, or Koyeb).
2. **Deploy the frontend to Vercel Free Tier**:
   - Framework Preset: `Vite` (handled automatically by `vercel.json`)
   - Set Environment Variables in Vercel Project Settings:
     - `VITE_API_URL=https://your-game-server.example.com`
     - `VITE_WS_URL=wss://your-game-server.example.com/ws`
