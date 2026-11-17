import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import type { ArenaMap } from './shared/types.ts';
import { hashPassword, signSessionToken, verifyPassword, verifySessionToken } from './server/auth.ts';
import {
  createUser,
  deleteCustomArena,
  findUserById,
  findUserByUsername,
  getLeaderboard,
  listAllArenas,
  saveCustomArena,
} from './server/db.ts';
import { GameServerManager } from './server/gameServer.ts';

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  // Permissive CORS for optional split Vercel static frontend -> external WS/API host
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const gameServer = new GameServerManager();

  wss.on('connection', (socket) => {
    gameServer.handleConnection(socket);
  });

  function extractAuth(req: express.Request) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    return verifySessionToken(header.slice(7));
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: gameServer.listRooms().length });
  });

  app.post('/api/auth/register', async (req, res) => {
    const rawUser = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(rawUser)) {
      res.status(400).json({ error: 'Username must be 3-20 alphanumeric, dash, or underscore characters.' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters.' });
      return;
    }
    if (findUserByUsername(rawUser)) {
      res.status(409).json({ error: 'Username is already registered.' });
      return;
    }
    const id = crypto.randomUUID();
    const hash = await hashPassword(password);
    const profile = createUser(id, rawUser, hash);
    const token = signSessionToken({ userId: id, username: profile.username, isGuest: false });
    res.json({ token, user: profile });
  });

  app.post('/api/auth/login', async (req, res) => {
    const rawUser = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const row = findUserByUsername(rawUser);
    if (!row) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }
    const profile = findUserById(row.id);
    if (!profile) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }
    const token = signSessionToken({ userId: profile.id, username: profile.username, isGuest: false });
    res.json({ token, user: profile });
  });

  app.post('/api/auth/guest', (req, res) => {
    const requested = String(req.body?.username || '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 14);
    const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
    const username = requested.length >= 3 ? `${requested}_${suffix}` : `Striker_${suffix}`;
    const userId = `guest-${crypto.randomUUID()}`;
    const token = signSessionToken({ userId, username, isGuest: true });
    res.json({
      token,
      user: {
        id: userId,
        username,
        isGuest: true,
        mmr: 1000,
        matchesPlayed: 0,
        wins: 0,
        losses: 0,
        kills: 0,
        deaths: 0,
        shotsFired: 0,
        shotsHit: 0,
        createdAt: Date.now(),
      },
    });
  });

  app.get('/api/auth/me', (req, res) => {
    const session = extractAuth(req);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (session.isGuest) {
      res.json({
        user: {
          id: session.userId,
          username: session.username,
          isGuest: true,
          mmr: 1000,
          matchesPlayed: 0,
          wins: 0,
          losses: 0,
          kills: 0,
          deaths: 0,
          shotsFired: 0,
          shotsHit: 0,
          createdAt: Date.now(),
        },
      });
      return;
    }
    const profile = findUserById(session.userId);
    if (!profile) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json({ user: profile });
  });

  app.get('/api/leaderboard', (_req, res) => {
    res.json({ entries: getLeaderboard(50) });
  });

  app.get('/api/arenas', (_req, res) => {
    res.json({ arenas: listAllArenas() });
  });

  app.post('/api/arenas', (req, res) => {
    const session = extractAuth(req);
    if (!session) {
      res.status(401).json({ error: 'Sign in to publish custom arenas.' });
      return;
    }
    const body = req.body as Partial<ArenaMap>;
    const name = String(body.name || '').trim().slice(0, 42);
    if (name.length < 3) {
      res.status(400).json({ error: 'Arena name must be at least 3 characters.' });
      return;
    }
    const blocks = Array.isArray(body.blocks) ? body.blocks.slice(0, 120) : [];
    const spawns = Array.isArray(body.spawns) ? body.spawns.slice(0, 24) : [];
    const pads = Array.isArray(body.pads) ? body.pads.slice(0, 16) : [];
    if (spawns.filter((s) => s.team === 'cobalt').length < 1 || spawns.filter((s) => s.team === 'ember').length < 1) {
      res.status(400).json({ error: 'Arena must include at least 1 Cobalt spawn and 1 Ember spawn.' });
      return;
    }

    const arena: ArenaMap = {
      id: body.id && body.id.startsWith('custom-') ? body.id : `custom-${crypto.randomBytes(4).toString('hex')}`,
      name,
      description: String(body.description || 'Custom tactical arena').trim().slice(0, 160),
      authorId: session.userId,
      authorName: session.username,
      isOfficial: false,
      width: Math.max(24, Math.min(80, Number(body.width) || 48)),
      depth: Math.max(24, Math.min(90, Number(body.depth) || 60)),
      ceilingHeight: Math.max(10, Math.min(24, Number(body.ceilingHeight) || 14)),
      blocks,
      spawns,
      pads,
      createdAt: Date.now(),
    };
    saveCustomArena(arena);
    res.json({ arena });
  });

  app.delete('/api/arenas/:id', (req, res) => {
    const session = extractAuth(req);
    if (!session) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const deleted = deleteCustomArena(req.params.id, session.userId);
    if (!deleted) {
      res.status(404).json({ error: 'Custom arena not found or not owned by you.' });
      return;
    }
    res.json({ ok: true });
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: gameServer.listRooms() });
  });

  app.post('/api/rooms', (req, res) => {
    const session = extractAuth(req);
    if (!session) {
      res.status(401).json({ error: 'Authentication required to create a room.' });
      return;
    }
    const name = String(req.body?.name || 'Custom Skirmish').trim();
    const mapId = String(req.body?.mapId || 'neon-citadel');
    const hasDrones = Boolean(req.body?.hasDrones);
    const room = gameServer.createCustomRoom({ name, mapId, hasDrones });
    if (!room) {
      res.status(400).json({ error: 'Invalid arena map ID.' });
      return;
    }
    const profile = session.isGuest ? null : findUserById(session.userId);
    const ticket = gameServer.issueTicketForRoom(
      room.roomId,
      session.userId,
      session.username,
      session.isGuest,
      profile ? profile.mmr : 1000,
    );
    res.json({ room, ticket });
  });

  app.post('/api/rooms/:roomId/ticket', (req, res) => {
    const session = extractAuth(req);
    if (!session) {
      res.status(401).json({ error: 'Authentication required to join a match.' });
      return;
    }
    const profile = session.isGuest ? null : findUserById(session.userId);
    const ticket = gameServer.issueTicketForRoom(
      req.params.roomId,
      session.userId,
      session.username,
      session.isGuest,
      profile ? profile.mmr : 1000,
    );
    if (!ticket) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }
    res.json({ ticket });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Prism Arena server listening on http://0.0.0.0:${port}`);
  });
}

bootstrap();
