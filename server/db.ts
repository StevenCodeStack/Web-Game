import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ArenaMap, LeaderboardEntry, UserProfile } from '../shared/types.ts';
import { OFFICIAL_ARENAS } from '../shared/arenas.ts';

function resolveDbPath(): string {
  const localDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    const probe = path.join(localDir, '.write_probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return path.join(localDir, 'prism_arena.db');
  } catch {
    return '/tmp/prism_arena.db';
  }
}

const db = new DatabaseSync(resolveDbPath());

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    mmr INTEGER NOT NULL DEFAULT 1000,
    matches_played INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    shots_fired INTEGER NOT NULL DEFAULT 0,
    shots_hit INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS custom_arenas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    map_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS match_history (
    id TEXT PRIMARY KEY,
    room_name TEXT NOT NULL,
    map_id TEXT NOT NULL,
    winning_team TEXT NOT NULL,
    cobalt_score INTEGER NOT NULL,
    ember_score INTEGER NOT NULL,
    duration_sec INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

export interface DbUserRow {
  id: string;
  username: string;
  password_hash: string;
  mmr: number;
  matches_played: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  shots_fired: number;
  shots_hit: number;
  created_at: number;
}

function rowToProfile(row: DbUserRow): UserProfile {
  return {
    id: row.id,
    username: row.username,
    mmr: row.mmr,
    matchesPlayed: row.matches_played,
    wins: row.wins,
    losses: row.losses,
    kills: row.kills,
    deaths: row.deaths,
    shotsFired: row.shots_fired,
    shotsHit: row.shots_hit,
    createdAt: row.created_at,
  };
}

export function findUserByUsername(username: string): DbUserRow | undefined {
  const stmt = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1');
  return stmt.get(username) as DbUserRow | undefined;
}

export function findUserById(id: string): UserProfile | null {
  const stmt = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1');
  const row = stmt.get(id) as DbUserRow | undefined;
  return row ? rowToProfile(row) : null;
}

export function createUser(id: string, username: string, passwordHash: string): UserProfile {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO users (id, username, password_hash, mmr, matches_played, wins, losses, kills, deaths, shots_fired, shots_hit, created_at)
    VALUES (?, ?, ?, 1000, 0, 0, 0, 0, 0, 0, 0, ?)
  `);
  stmt.run(id, username, passwordHash, now);
  return {
    id,
    username,
    mmr: 1000,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    shotsFired: 0,
    shotsHit: 0,
    createdAt: now,
  };
}

export function recordPlayerMatchStats(params: {
  userId: string;
  won: boolean;
  draw: boolean;
  kills: number;
  deaths: number;
  shotsFired: number;
  shotsHit: number;
  mmrDelta: number;
}): void {
  const stmt = db.prepare(`
    UPDATE users
    SET
      mmr = MAX(100, mmr + ?),
      matches_played = matches_played + 1,
      wins = wins + ?,
      losses = losses + ?,
      kills = kills + ?,
      deaths = deaths + ?,
      shots_fired = shots_fired + ?,
      shots_hit = shots_hit + ?
    WHERE id = ?
  `);
  stmt.run(
    params.mmrDelta,
    params.won ? 1 : 0,
    !params.won && !params.draw ? 1 : 0,
    params.kills,
    params.deaths,
    params.shotsFired,
    params.shotsHit,
    params.userId,
  );
}

export function recordMatchHistory(params: {
  id: string;
  roomName: string;
  mapId: string;
  winningTeam: string;
  cobaltScore: number;
  emberScore: number;
  durationSec: number;
}): void {
  const stmt = db.prepare(`
    INSERT INTO match_history (id, room_name, map_id, winning_team, cobalt_score, ember_score, duration_sec, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    params.id,
    params.roomName,
    params.mapId,
    params.winningTeam,
    params.cobaltScore,
    params.emberScore,
    params.durationSec,
    Date.now(),
  );
}

export function getLeaderboard(limit = 50): LeaderboardEntry[] {
  const stmt = db.prepare(`
    SELECT id, username, mmr, matches_played, wins, losses, kills, deaths, shots_fired, shots_hit
    FROM users
    ORDER BY mmr DESC, kills DESC
    LIMIT ?
  `);
  const rows = stmt.all(limit) as unknown as DbUserRow[];
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    mmr: r.mmr,
    matchesPlayed: r.matches_played,
    wins: r.wins,
    losses: r.losses,
    kills: r.kills,
    deaths: r.deaths,
    shotsFired: r.shots_fired,
    shotsHit: r.shots_hit,
  }));
}

export function listAllArenas(): ArenaMap[] {
  const stmt = db.prepare('SELECT map_json FROM custom_arenas ORDER BY created_at DESC LIMIT 100');
  const rows = stmt.all() as unknown as { map_json: string }[];
  const custom: ArenaMap[] = [];
  for (const row of rows) {
    try {
      custom.push(JSON.parse(row.map_json) as ArenaMap);
    } catch {
      // skip malformed row
    }
  }
  return [...OFFICIAL_ARENAS, ...custom];
}

export function getArenaById(id: string): ArenaMap | null {
  const official = OFFICIAL_ARENAS.find((a) => a.id === id);
  if (official) return official;
  const stmt = db.prepare('SELECT map_json FROM custom_arenas WHERE id = ? LIMIT 1');
  const row = stmt.get(id) as { map_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.map_json) as ArenaMap;
  } catch {
    return null;
  }
}

export function saveCustomArena(arena: ArenaMap): ArenaMap {
  const stmt = db.prepare(`
    INSERT INTO custom_arenas (id, name, description, author_id, author_name, map_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      map_json = excluded.map_json
  `);
  stmt.run(
    arena.id,
    arena.name,
    arena.description,
    arena.authorId,
    arena.authorName,
    JSON.stringify(arena),
    arena.createdAt,
  );
  return arena;
}

export function deleteCustomArena(id: string, authorId: string): boolean {
  const stmt = db.prepare('DELETE FROM custom_arenas WHERE id = ? AND author_id = ?');
  const res = stmt.run(id, authorId);
  return Number(res.changes) > 0;
}
