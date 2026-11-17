import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import type {
  ArenaMap,
  ChatMessage,
  ClientInputCmd,
  ClientWsMessage,
  KillFeedEntry,
  LaserBeamEvent,
  MatchEndSummary,
  PlayerSnapshot,
  RoomSummary,
  ServerWsMessage,
  TeamId,
} from '../shared/types.ts';
import { signMatchTicket, verifyMatchTicket, verifySessionToken } from './auth.ts';
import {
  findUserById,
  getArenaById,
  listAllArenas,
  recordMatchHistory,
  recordPlayerMatchStats,
} from './db.ts';
import { ArenaPhysicsWorld } from './physicsWorld.ts';

interface ConnectedClient {
  socket: WebSocket;
  userId: string;
  username: string;
  isGuest: boolean;
  mmr: number;
  roomId: string | null;
  inQueue: boolean;
  preferredMapId?: string;
}

interface RoomPlayerState {
  id: string;
  username: string;
  isGuest: boolean;
  team: TeamId;
  mmr: number;
  health: number;
  shield: number;
  alive: boolean;
  respawnAt: number;
  invulnUntil: number;
  overchargeUntil: number;
  lastDamagedAt: number;
  lastFireAt: number;
  score: number;
  kills: number;
  deaths: number;
  assists: number;
  shotsFired: number;
  shotsHit: number;
  pingMs: number;
  lastProcessedSeq: number;
  inputQueue: ClientInputCmd[];
  damageContributors: Map<string, number>;
  isDrone: boolean;
  dronePhase?: number;
  droneAnchor?: { x: number; y: number; z: number };
  voiceJoined: boolean;
  voiceSpeaking: boolean;
}

const MATCH_DURATION_SEC = 180;
const SCORE_LIMIT = 25;
const RESPAWN_DELAY_MS = 2600;
const INVULN_DURATION_MS = 2200;
const FIRE_COOLDOWN_MS = 165;
const OVERCHARGE_COOLDOWN_MS = 95;
const PAD_COOLDOWN_MS = 12000;

class GameRoom {
  public readonly roomId: string;
  public readonly name: string;
  public readonly map: ArenaMap;
  public readonly mode: 'tdm' | 'practice';
  public readonly maxPlayers = 16;
  public status: 'waiting' | 'active' | 'finished' = 'active';
  public scores: { cobalt: number; ember: number } = { cobalt: 0, ember: 0 };
  public readonly physics: ArenaPhysicsWorld;
  public readonly players = new Map<string, RoomPlayerState>();
  public readonly sockets = new Map<string, WebSocket>();
  public readonly chatHistory: ChatMessage[] = [];
  public readonly padCooldowns = new Map<string, number>();
  public roundEndsAt: number;
  public resetAt = 0;
  public hasDrones: boolean;
  private droneCounter = 0;

  constructor(roomId: string, name: string, map: ArenaMap, mode: 'tdm' | 'practice', hasDrones: boolean) {
    this.roomId = roomId;
    this.name = name;
    this.map = map;
    this.mode = mode;
    this.hasDrones = hasDrones;
    this.physics = new ArenaPhysicsWorld(map);
    this.roundEndsAt = Date.now() + MATCH_DURATION_SEC * 1000;

    if (hasDrones) {
      this.spawnPracticeDrones();
    }
  }

  private spawnPracticeDrones(): void {
    const dronePoints = [
      { x: -8, y: 0.4, z: 6, team: 'ember' as TeamId },
      { x: 8, y: 0.4, z: 6, team: 'ember' as TeamId },
      { x: 0, y: 0.4, z: 12, team: 'ember' as TeamId },
    ];
    for (const pt of dronePoints) {
      this.droneCounter++;
      const droneId = `drone-${this.droneCounter}`;
      this.physics.addPlayer(droneId, pt.team, pt.x, pt.y, pt.z, Math.PI);
      this.players.set(droneId, {
        id: droneId,
        username: `Target Drone 0${this.droneCounter}`,
        isGuest: true,
        team: pt.team,
        mmr: 1000,
        health: 100,
        shield: 50,
        alive: true,
        respawnAt: 0,
        invulnUntil: 0,
        overchargeUntil: 0,
        lastDamagedAt: 0,
        lastFireAt: 0,
        score: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        shotsFired: 0,
        shotsHit: 0,
        pingMs: 0,
        lastProcessedSeq: 0,
        inputQueue: [],
        damageContributors: new Map(),
        isDrone: true,
        dronePhase: this.droneCounter * 1.7,
        droneAnchor: { x: pt.x, y: pt.y, z: pt.z },
        voiceJoined: false,
        voiceSpeaking: false,
      });
    }
  }

  public getHumanCount(): number {
    let count = 0;
    for (const p of this.players.values()) {
      if (!p.isDrone) count++;
    }
    return count;
  }

  public getSummary(): RoomSummary {
    return {
      roomId: this.roomId,
      name: this.name,
      mapId: this.map.id,
      mapName: this.map.name,
      mode: this.mode,
      playerCount: this.getHumanCount(),
      maxPlayers: this.maxPlayers,
      status: this.status,
      timeLeftSec: Math.max(0, Math.ceil((this.roundEndsAt - Date.now()) / 1000)),
      scores: { ...this.scores },
      hasDrones: this.hasDrones,
    };
  }

  public pickSpawn(team: TeamId) {
    const teamSpawns = this.map.spawns.filter((s) => s.team === team);
    const pool = teamSpawns.length > 0 ? teamSpawns : this.map.spawns;
    return pool[Math.floor(Math.random() * pool.length)] || { x: 0, y: 0.4, z: 0, team, yaw: 0 };
  }

  public addHumanPlayer(
    client: ConnectedClient,
    team: TeamId,
  ): void {
    const spawn = this.pickSpawn(team);
    this.physics.addPlayer(client.userId, team, spawn.x, spawn.y, spawn.z, spawn.yaw);
    const state: RoomPlayerState = {
      id: client.userId,
      username: client.username,
      isGuest: client.isGuest,
      team,
      mmr: client.mmr,
      health: 100,
      shield: 50,
      alive: true,
      respawnAt: 0,
      invulnUntil: Date.now() + INVULN_DURATION_MS,
      overchargeUntil: 0,
      lastDamagedAt: 0,
      lastFireAt: 0,
      score: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      shotsFired: 0,
      shotsHit: 0,
      pingMs: 18,
      lastProcessedSeq: 0,
      inputQueue: [],
      damageContributors: new Map(),
      isDrone: false,
      voiceJoined: false,
      voiceSpeaking: false,
    };
    this.players.set(client.userId, state);
    this.sockets.set(client.userId, client.socket);

    this.sendTo(client.userId, {
      type: 'room:joined',
      roomId: this.roomId,
      roomName: this.name,
      map: this.map,
      selfId: client.userId,
      team,
      chatHistory: this.chatHistory.slice(-40),
      voicePeers: this.getVoicePeersForTeam(team),
    });
  }

  public removeHumanPlayer(userId: string): void {
    const p = this.players.get(userId);
    const wasVoice = p?.voiceJoined;
    const team = p?.team;
    this.physics.removePlayer(userId);
    this.players.delete(userId);
    this.sockets.delete(userId);
    if (wasVoice && team) {
      this.broadcastVoicePeers(team);
    }
  }

  public getVoicePeersForTeam(team: TeamId): { id: string; username: string; team: TeamId; speaking?: boolean }[] {
    const peers: { id: string; username: string; team: TeamId; speaking?: boolean }[] = [];
    for (const p of this.players.values()) {
      if (!p.isDrone && p.voiceJoined && p.team === team) {
        peers.push({ id: p.id, username: p.username, team: p.team, speaking: p.voiceSpeaking });
      }
    }
    return peers;
  }

  public broadcastVoicePeers(team: TeamId): void {
    const peers = this.getVoicePeersForTeam(team);
    for (const p of this.players.values()) {
      if (!p.isDrone && p.team === team) {
        this.sendTo(p.id, { type: 'voice:peers', peers });
      }
    }
  }

  public sendTo(userId: string, msg: ServerWsMessage): void {
    const ws = this.sockets.get(userId);
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }

  public broadcast(msg: ServerWsMessage): void {
    const raw = JSON.stringify(msg);
    for (const ws of this.sockets.values()) {
      if (ws.readyState === 1) {
        ws.send(raw);
      }
    }
  }

  public step(dt: number, now: number): void {
    if (this.status === 'finished') {
      if (now >= this.resetAt) {
        this.resetRound(now);
      }
      return;
    }

    // Check match timer
    if (now >= this.roundEndsAt) {
      this.finishMatch(now);
      return;
    }

    // Apply queued inputs & drone movement
    for (const p of this.players.values()) {
      if (p.isDrone && p.alive && p.droneAnchor) {
        const phase = (p.dronePhase || 0) + now * 0.0014;
        const targetX = p.droneAnchor.x + Math.sin(phase) * 5.2;
        const pos = this.physics.getPlayerPosition(p.id);
        const vx = pos ? (targetX - pos.x) * 3.5 : Math.cos(phase) * 4.5;
        this.physics.setDroneVelocity(p.id, vx, 0, Math.sin(phase * 0.6) * 1.8, Math.PI);
        continue;
      }

      if (!p.alive) {
        p.inputQueue.length = 0;
        if (now >= p.respawnAt) {
          this.respawnPlayer(p, now);
        }
        continue;
      }

      // Process up to 4 inputs per step
      const toProcess = p.inputQueue.splice(0, 4);
      for (const cmd of toProcess) {
        this.physics.applyPlayerInput(p.id, cmd, now);
        p.lastProcessedSeq = cmd.seq;
      }

      // Shield passive regen (after 4 seconds out of combat)
      if (p.shield < 50 && now - p.lastDamagedAt > 4000) {
        p.shield = Math.min(50, p.shield + 12 * dt);
      }
    }

    // Step Cannon.js world
    this.physics.step(dt);

    // Check recharge pads
    for (const pad of this.map.pads) {
      const cdUntil = this.padCooldowns.get(pad.id) || 0;
      if (now < cdUntil) continue;
      for (const p of this.players.values()) {
        if (!p.alive || p.isDrone) continue;
        const pos = this.physics.getPlayerPosition(p.id);
        if (!pos) continue;
        const distSq =
          (pos.x - pad.x) ** 2 +
          (pos.y - pad.y) ** 2 +
          (pos.z - pad.z) ** 2;
        if (distSq < 2.2) {
          if (pad.kind === 'shield' && (p.shield < 50 || p.health < 100)) {
            p.shield = 50;
            p.health = Math.min(100, p.health + 35);
            this.padCooldowns.set(pad.id, now + PAD_COOLDOWN_MS);
            break;
          } else if (pad.kind === 'overcharge') {
            p.overchargeUntil = now + 7000;
            this.padCooldowns.set(pad.id, now + PAD_COOLDOWN_MS);
            break;
          }
        }
      }
    }
  }

  private respawnPlayer(p: RoomPlayerState, now: number): void {
    const spawn = this.pickSpawn(p.team);
    this.physics.teleportPlayer(p.id, spawn.x, spawn.y, spawn.z, spawn.yaw);
    p.health = 100;
    p.shield = 50;
    p.alive = true;
    p.invulnUntil = now + INVULN_DURATION_MS;
    p.overchargeUntil = 0;
    p.damageContributors.clear();
  }

  public handleFire(userId: string, yaw: number, pitch: number, now: number): void {
    if (this.status !== 'active') return;
    const shooter = this.players.get(userId);
    if (!shooter || !shooter.alive) return;

    const cooldown = now < shooter.overchargeUntil ? OVERCHARGE_COOLDOWN_MS : FIRE_COOLDOWN_MS;
    if (now - shooter.lastFireAt < cooldown) return;
    shooter.lastFireAt = now;
    shooter.shotsFired += 1;

    const deadIds = new Set<string>();
    for (const p of this.players.values()) {
      if (!p.alive) deadIds.add(p.id);
    }

    const { start, hit } = this.physics.raycastLaser(userId, yaw, pitch, 120, deadIds);

    let hitEnemyId: string | undefined;
    let isHeadshot = false;

    if (hit.hitPlayerId) {
      const victim = this.players.get(hit.hitPlayerId);
      if (victim && victim.alive && victim.team !== shooter.team && now >= victim.invulnUntil) {
        hitEnemyId = victim.id;
        isHeadshot = hit.headshot;
        shooter.shotsHit += 1;

        const baseDamage = isHeadshot ? 48 : 30;
        const damage = now < shooter.overchargeUntil ? Math.round(baseDamage * 1.25) : baseDamage;
        let remaining = damage;
        let shieldBroken = false;

        if (victim.shield > 0) {
          const absorbed = Math.min(victim.shield, remaining);
          victim.shield -= absorbed;
          remaining -= absorbed;
          if (victim.shield <= 0) shieldBroken = true;
        }
        if (remaining > 0) {
          victim.health = Math.max(0, victim.health - remaining);
        }
        victim.lastDamagedAt = now;
        victim.damageContributors.set(shooter.id, now);

        this.broadcast({
          type: 'player:hit',
          victimId: victim.id,
          attackerId: shooter.id,
          damage,
          headshot: isHeadshot,
          shieldBroken,
        });

        if (victim.health <= 0) {
          victim.alive = false;
          victim.deaths += 1;
          victim.respawnAt = now + RESPAWN_DELAY_MS;

          shooter.kills += 1;
          shooter.score += isHeadshot ? 150 : 100;
          this.scores[shooter.team] += 1;

          // Assists
          for (const [contribId, ts] of victim.damageContributors.entries()) {
            if (contribId !== shooter.id && now - ts < 6000) {
              const ally = this.players.get(contribId);
              if (ally) {
                ally.assists += 1;
                ally.score += 40;
              }
            }
          }

          const entry: KillFeedEntry = {
            id: crypto.randomUUID(),
            killerId: shooter.id,
            killerName: shooter.username,
            killerTeam: shooter.team,
            victimId: victim.id,
            victimName: victim.username,
            victimTeam: victim.team,
            headshot: isHeadshot,
            timestamp: now,
          };
          this.broadcast({ type: 'player:tagged', entry });

          if (this.scores[shooter.team] >= SCORE_LIMIT && this.mode === 'tdm') {
            this.finishMatch(now);
          }
        }
      }
    }

    const beam: LaserBeamEvent = {
      id: crypto.randomUUID(),
      shooterId: shooter.id,
      shooterName: shooter.username,
      team: shooter.team,
      start,
      end: hit.hitPoint,
      hitPlayerId: hitEnemyId,
      headshot: isHeadshot,
      timestamp: now,
    };
    this.broadcast({ type: 'laser:fired', beam });
  }

  public getSnapshots(): PlayerSnapshot[] {
    const physMap = (this.physics as unknown as {
      players: Map<string, { body: { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } }; yaw: number; pitch: number }>;
    }).players;

    const list: PlayerSnapshot[] = [];
    for (const p of this.players.values()) {
      const phys = physMap.get(p.id);
      list.push({
        id: p.id,
        username: p.username,
        team: p.team,
        x: phys ? phys.body.position.x : 0,
        y: phys ? phys.body.position.y : 0,
        z: phys ? phys.body.position.z : 0,
        vx: phys ? phys.body.velocity.x : 0,
        vy: phys ? phys.body.velocity.y : 0,
        vz: phys ? phys.body.velocity.z : 0,
        yaw: phys ? phys.yaw : 0,
        pitch: phys ? phys.pitch : 0,
        health: Math.ceil(p.health),
        shield: Math.ceil(p.shield),
        alive: p.alive,
        invulnUntil: p.invulnUntil,
        overchargeUntil: p.overchargeUntil,
        score: p.score,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        shotsFired: p.shotsFired,
        shotsHit: p.shotsHit,
        pingMs: p.pingMs,
        isDrone: p.isDrone,
        lastProcessedSeq: p.lastProcessedSeq,
      });
    }
    return list;
  }

  public broadcastSnapshot(now: number): void {
    const padCooldowns: Record<string, number> = {};
    for (const [id, until] of this.padCooldowns.entries()) {
      if (until > now) padCooldowns[id] = until;
    }

    this.broadcast({
      type: 'room:snapshot',
      serverTime: now,
      status: this.status,
      timeLeftSec: Math.max(0, Math.ceil((this.roundEndsAt - now) / 1000)),
      scores: { ...this.scores },
      players: this.getSnapshots(),
      padCooldowns,
    });
  }

  private finishMatch(now: number): void {
    if (this.status === 'finished') return;
    this.status = 'finished';
    this.resetAt = now + 9000;

    const winningTeam: TeamId | 'draw' =
      this.scores.cobalt > this.scores.ember
        ? 'cobalt'
        : this.scores.ember > this.scores.cobalt
          ? 'ember'
          : 'draw';

    const snapshots = this.getSnapshots();
    const humanSnapshots = snapshots.filter((p) => !p.isDrone);
    const mvp = [...humanSnapshots].sort((a, b) => b.score - a.score)[0];

    // Persist stats for registered users
    if (this.mode === 'tdm' && humanSnapshots.length > 0) {
      try {
        recordMatchHistory({
          id: crypto.randomUUID(),
          roomName: this.name,
          mapId: this.map.id,
          winningTeam,
          cobaltScore: this.scores.cobalt,
          emberScore: this.scores.ember,
          durationSec: MATCH_DURATION_SEC,
        });
      } catch {
        // Ignore history write error
      }
    }

    for (const p of this.players.values()) {
      if (p.isDrone || p.isGuest) continue;
      const won = winningTeam !== 'draw' && p.team === winningTeam;
      const draw = winningTeam === 'draw';
      const mmrDelta = draw ? 2 : won ? 22 : -14;
      try {
        recordPlayerMatchStats({
          userId: p.id,
          won,
          draw,
          kills: p.kills,
          deaths: p.deaths,
          shotsFired: p.shotsFired,
          shotsHit: p.shotsHit,
          mmrDelta,
        });
      } catch {
        // Ignore user stat update error
      }
    }

    const summary: MatchEndSummary = {
      roomId: this.roomId,
      winningTeam,
      scores: { ...this.scores },
      players: snapshots,
      mvpName: mvp ? mvp.username : 'None',
      nextRoundSec: 9,
    };
    this.broadcast({ type: 'match:ended', summary });
  }

  private resetRound(now: number): void {
    this.status = 'active';
    this.scores = { cobalt: 0, ember: 0 };
    this.roundEndsAt = now + MATCH_DURATION_SEC * 1000;
    this.padCooldowns.clear();

    for (const p of this.players.values()) {
      p.score = 0;
      p.kills = 0;
      p.deaths = 0;
      p.assists = 0;
      p.shotsFired = 0;
      p.shotsHit = 0;
      this.respawnPlayer(p, now);
    }
  }
}

export class GameServerManager {
  public readonly rooms = new Map<string, GameRoom>();
  private readonly clients = new Map<WebSocket, ConnectedClient>();
  private readonly queue: ConnectedClient[] = [];
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private snapshotInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Boot default public arenas so players can always drop into a live match immediately
    const allMaps = listAllArenas();
    const citadel = allMaps.find((m) => m.id === 'neon-citadel') || allMaps[0];
    const reactor = allMaps.find((m) => m.id === 'reactor-core') || allMaps[0];
    this.rooms.set('alpha-citadel', new GameRoom('alpha-citadel', 'Ranked Lobby · Neon Citadel', citadel, 'tdm', false));
    this.rooms.set('beta-reactor', new GameRoom('beta-reactor', 'Tactical Skirmish · Reactor Core', reactor, 'tdm', false));
    this.rooms.set('training-range', new GameRoom('training-range', 'Target Range (Practice Drones)', citadel, 'practice', true));

    this.startLoops();
  }

  private startLoops(): void {
    const fixedDt = 1 / 60;
    this.tickInterval = setInterval(() => {
      const now = Date.now();
      for (const room of this.rooms.values()) {
        room.step(fixedDt, now);
      }
    }, 1000 / 60);

    this.snapshotInterval = setInterval(() => {
      const now = Date.now();
      for (const room of this.rooms.values()) {
        if (room.sockets.size > 0) {
          room.broadcastSnapshot(now);
        }
      }
    }, 50);
  }

  public stop(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.snapshotInterval) clearInterval(this.snapshotInterval);
  }

  public listRooms(): RoomSummary[] {
    return Array.from(this.rooms.values()).map((r) => r.getSummary());
  }

  public createCustomRoom(params: { name: string; mapId: string; hasDrones: boolean }): RoomSummary | null {
    const map = getArenaById(params.mapId);
    if (!map) return null;
    const roomId = `room-${crypto.randomBytes(3).toString('hex')}`;
    const mode = params.hasDrones ? 'practice' : 'tdm';
    const room = new GameRoom(roomId, params.name.slice(0, 48) || map.name, map, mode, params.hasDrones);
    this.rooms.set(roomId, room);
    return room.getSummary();
  }

  public issueTicketForRoom(roomId: string, userId: string, username: string, isGuest: boolean, mmr: number): string | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    // Balance teams by headcount & total MMR
    let cobaltCount = 0;
    let emberCount = 0;
    let cobaltMmr = 0;
    let emberMmr = 0;
    for (const p of room.players.values()) {
      if (p.isDrone) continue;
      if (p.team === 'cobalt') {
        cobaltCount++;
        cobaltMmr += p.mmr;
      } else {
        emberCount++;
        emberMmr += p.mmr;
      }
    }
    let team: TeamId = 'cobalt';
    if (room.mode === 'practice') {
      team = 'cobalt';
    } else if (cobaltCount > emberCount) {
      team = 'ember';
    } else if (emberCount > cobaltCount) {
      team = 'cobalt';
    } else {
      team = cobaltMmr <= emberMmr ? 'cobalt' : 'ember';
    }

    return signMatchTicket({ userId, username, isGuest, roomId, team, mmr });
  }

  public handleConnection(socket: WebSocket): void {
    socket.on('message', (raw) => {
      let msg: ClientWsMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientWsMessage;
      } catch {
        return;
      }
      this.handleMessage(socket, msg);
    });

    socket.on('close', () => {
      this.handleDisconnect(socket);
    });
  }

  private send(socket: WebSocket, msg: ServerWsMessage): void {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(msg));
    }
  }

  private handleMessage(socket: WebSocket, msg: ClientWsMessage): void {
    if (msg.type === 'auth:token') {
      const payload = verifySessionToken(msg.token);
      if (!payload) {
        this.send(socket, { type: 'error', message: 'Invalid or expired session token.' });
        return;
      }
      const profile = payload.isGuest ? null : findUserById(payload.userId);
      const client: ConnectedClient = {
        socket,
        userId: payload.userId,
        username: payload.username,
        isGuest: payload.isGuest,
        mmr: profile ? profile.mmr : 1000,
        roomId: null,
        inQueue: false,
      };
      this.clients.set(socket, client);
      this.send(socket, { type: 'auth:ok', userId: client.userId, username: client.username });
      return;
    }

    const client = this.clients.get(socket);
    if (!client) {
      this.send(socket, { type: 'error', message: 'Authenticate session before issuing commands.' });
      return;
    }

    switch (msg.type) {
      case 'ping': {
        const room = client.roomId ? this.rooms.get(client.roomId) : null;
        if (room) {
          const player = room.players.get(client.userId);
          if (player) {
            player.pingMs = Math.max(1, Math.min(999, Math.round(Date.now() - msg.clientTime)));
          }
        }
        this.send(socket, { type: 'pong', clientTime: msg.clientTime, serverTime: Date.now() });
        break;
      }
      case 'queue:join': {
        if (!client.inQueue) {
          client.inQueue = true;
          client.preferredMapId = msg.mapId;
          this.queue.push(client);
        }
        this.broadcastQueueStatus();
        this.tryMatchmake();
        break;
      }
      case 'queue:leave': {
        this.removeFromQueue(client);
        this.send(socket, { type: 'queue:status', inQueue: false, queueSize: this.queue.length, estimatedSec: 15 });
        this.broadcastQueueStatus();
        break;
      }
      case 'room:join': {
        const ticket = verifyMatchTicket(msg.ticket);
        if (!ticket || ticket.userId !== client.userId) {
          this.send(socket, { type: 'error', message: 'Matchmaking ticket verification failed.' });
          return;
        }
        const room = this.rooms.get(ticket.roomId);
        if (!room) {
          this.send(socket, { type: 'error', message: 'Target arena room no longer exists.' });
          return;
        }
        if (client.roomId && client.roomId !== room.roomId) {
          this.rooms.get(client.roomId)?.removeHumanPlayer(client.userId);
        }
        this.removeFromQueue(client);
        // Remove stale instance of same user if reconnecting
        room.removeHumanPlayer(client.userId);
        client.roomId = room.roomId;
        room.addHumanPlayer(client, ticket.team);
        break;
      }
      case 'room:leave': {
        if (client.roomId) {
          this.rooms.get(client.roomId)?.removeHumanPlayer(client.userId);
          client.roomId = null;
        }
        break;
      }
      case 'input': {
        if (!client.roomId) return;
        const room = this.rooms.get(client.roomId);
        const player = room?.players.get(client.userId);
        if (player && player.inputQueue.length < 16) {
          player.inputQueue.push(msg.cmd);
        }
        break;
      }
      case 'fire': {
        if (!client.roomId) return;
        const room = this.rooms.get(client.roomId);
        room?.handleFire(client.userId, msg.yaw, msg.pitch, Date.now());
        break;
      }
      case 'chat:send': {
        if (!client.roomId) return;
        const room = this.rooms.get(client.roomId);
        const sender = room?.players.get(client.userId);
        if (!room || !sender) return;
        const clean = msg.text.trim().slice(0, 220);
        if (!clean) return;
        const chatMsg: ChatMessage = {
          id: crypto.randomUUID(),
          senderId: sender.id,
          senderName: sender.username,
          senderTeam: sender.team,
          channel: msg.channel,
          text: clean,
          timestamp: Date.now(),
        };
        room.chatHistory.push(chatMsg);
        if (room.chatHistory.length > 100) room.chatHistory.shift();

        if (msg.channel === 'team') {
          for (const p of room.players.values()) {
            if (!p.isDrone && p.team === sender.team) {
              room.sendTo(p.id, { type: 'chat:message', msg: chatMsg });
            }
          }
        } else {
          room.broadcast({ type: 'chat:message', msg: chatMsg });
        }
        break;
      }
      case 'voice:join': {
        if (!client.roomId) return;
        const room = this.rooms.get(client.roomId);
        const sender = room?.players.get(client.userId);
        if (!room || !sender) return;
        sender.voiceJoined = true;
        room.broadcastVoicePeers(sender.team);
        break;
      }
      case 'voice:leave': {
        if (!client.roomId) return;
        const room = this.rooms.get(client.roomId);
        const sender = room?.players.get(client.userId);
        if (!room || !sender) return;
        sender.voiceJoined = false;
        sender.voiceSpeaking = false;
        room.broadcastVoicePeers(sender.team);
        break;
      }
      case 'voice:speaking': {
        if (!client.roomId) return;
        const room = this.rooms.get(client.roomId);
        const sender = room?.players.get(client.userId);
        if (!room || !sender) return;
        if (sender.voiceSpeaking !== msg.speaking) {
          sender.voiceSpeaking = msg.speaking;
          room.broadcastVoicePeers(sender.team);
        }
        break;
      }
      case 'voice:offer': {
        if (!client.roomId) return;
        const room = this.rooms.get(client.roomId);
        const sender = room?.players.get(client.userId);
        const target = room?.players.get(msg.targetId);
        if (!room || !sender || !target || sender.team !== target.team) return;
        room.sendTo(msg.targetId, {
          type: 'voice:offer',
          fromId: sender.id,
          fromName: sender.username,
          sdp: msg.sdp,
        });
        break;
      }
      case 'voice:answer': {
        if (!client.roomId) return;
        const room = this.rooms.get(client.roomId);
        const sender = room?.players.get(client.userId);
        const target = room?.players.get(msg.targetId);
        if (!room || !sender || !target || sender.team !== target.team) return;
        room.sendTo(msg.targetId, {
          type: 'voice:answer',
          fromId: sender.id,
          sdp: msg.sdp,
        });
        break;
      }
      case 'voice:ice': {
        if (!client.roomId) return;
        const room = this.rooms.get(client.roomId);
        const sender = room?.players.get(client.userId);
        const target = room?.players.get(msg.targetId);
        if (!room || !sender || !target || sender.team !== target.team) return;
        room.sendTo(msg.targetId, {
          type: 'voice:ice',
          fromId: sender.id,
          candidate: msg.candidate,
        });
        break;
      }
    }
  }

  private removeFromQueue(client: ConnectedClient): void {
    client.inQueue = false;
    const idx = this.queue.indexOf(client);
    if (idx !== -1) this.queue.splice(idx, 1);
  }

  private broadcastQueueStatus(): void {
    for (const c of this.queue) {
      this.send(c.socket, {
        type: 'queue:status',
        inQueue: true,
        queueSize: this.queue.length,
        estimatedSec: this.queue.length >= 2 ? 2 : 12,
      });
    }
  }

  private tryMatchmake(): void {
    if (this.queue.length < 2) return;
    // Pair players sorted by MMR for balanced teams
    const batch = this.queue.splice(0, Math.min(8, this.queue.length));
    batch.sort((a, b) => b.mmr - a.mmr);

    const mapId = batch.find((c) => c.preferredMapId)?.preferredMapId || 'neon-citadel';
    const map = getArenaById(mapId) || listAllArenas()[0];
    const roomId = `ranked-${crypto.randomBytes(3).toString('hex')}`;
    const room = new GameRoom(roomId, `Ranked Match · ${map.name}`, map, 'tdm', false);
    this.rooms.set(roomId, room);

    let cobaltMmr = 0;
    let emberMmr = 0;
    for (const c of batch) {
      c.inQueue = false;
      const team: TeamId = cobaltMmr <= emberMmr ? 'cobalt' : 'ember';
      if (team === 'cobalt') cobaltMmr += c.mmr;
      else emberMmr += c.mmr;

      const ticket = signMatchTicket({
        userId: c.userId,
        username: c.username,
        isGuest: c.isGuest,
        roomId,
        team,
        mmr: c.mmr,
      });
      this.send(c.socket, {
        type: 'queue:matched',
        ticket,
        roomId,
        mapId: map.id,
        team,
      });
    }
    this.broadcastQueueStatus();
  }

  private handleDisconnect(socket: WebSocket): void {
    const client = this.clients.get(socket);
    if (!client) return;
    this.removeFromQueue(client);
    if (client.roomId) {
      this.rooms.get(client.roomId)?.removeHumanPlayer(client.userId);
    }
    this.clients.delete(socket);
  }
}
