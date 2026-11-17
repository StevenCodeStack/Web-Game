export type TeamId = 'cobalt' | 'ember';

export type ArenaBlockType = 'wall' | 'platform' | 'pillar' | 'ramp' | 'bridge';

export interface ArenaBlock {
  id: string;
  type: ArenaBlockType;
  x: number;
  y: number; // bottom Y (0 = floor)
  z: number;
  w: number; // width along X
  h: number; // height along Y
  d: number; // depth along Z
  rotY?: number; // radians around Y
  accent?: 'cobalt' | 'ember' | 'neutral';
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  team: TeamId;
  yaw: number;
}

export interface PadPoint {
  id: string;
  x: number;
  y: number;
  z: number;
  kind: 'shield' | 'overcharge';
}

export interface ArenaMap {
  id: string;
  name: string;
  description: string;
  authorId: string;
  authorName: string;
  isOfficial: boolean;
  thumbnailUrl?: string;
  width: number;
  depth: number;
  ceilingHeight: number;
  blocks: ArenaBlock[];
  spawns: SpawnPoint[];
  pads: PadPoint[];
  createdAt: number;
}

export interface UserProfile {
  id: string;
  username: string;
  isGuest?: boolean;
  mmr: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  shotsFired: number;
  shotsHit: number;
  createdAt: number;
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  mmr: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  shotsFired: number;
  shotsHit: number;
}

export interface PlayerSnapshot {
  id: string;
  username: string;
  team: TeamId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  health: number;
  shield: number;
  alive: boolean;
  invulnUntil: number;
  overchargeUntil: number;
  score: number;
  kills: number;
  deaths: number;
  assists: number;
  shotsFired: number;
  shotsHit: number;
  pingMs: number;
  isDrone?: boolean;
  lastProcessedSeq?: number;
}

export interface LaserBeamEvent {
  id: string;
  shooterId: string;
  shooterName: string;
  team: TeamId;
  start: [number, number, number];
  end: [number, number, number];
  hitPlayerId?: string;
  headshot?: boolean;
  timestamp: number;
}

export interface KillFeedEntry {
  id: string;
  killerId: string;
  killerName: string;
  killerTeam: TeamId;
  victimId: string;
  victimName: string;
  victimTeam: TeamId;
  headshot: boolean;
  timestamp: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderTeam: TeamId;
  channel: 'team' | 'all';
  text: string;
  timestamp: number;
}

export interface RoomSummary {
  roomId: string;
  name: string;
  mapId: string;
  mapName: string;
  mode: 'tdm' | 'practice';
  playerCount: number;
  maxPlayers: number;
  status: 'waiting' | 'active' | 'finished';
  timeLeftSec: number;
  scores: {
    cobalt: number;
    ember: number;
  };
  hasDrones: boolean;
}

export interface ClientInputCmd {
  seq: number;
  dt: number;
  forward: number; // -1..1
  strafe: number; // -1..1
  jump: boolean;
  sprint: boolean;
  yaw: number;
  pitch: number;
  clientTime: number;
}

export interface MatchEndSummary {
  roomId: string;
  winningTeam: TeamId | 'draw';
  scores: {
    cobalt: number;
    ember: number;
  };
  players: PlayerSnapshot[];
  mvpName: string;
  nextRoundSec: number;
}

export type ClientWsMessage =
  | { type: 'auth:token'; token: string }
  | { type: 'queue:join'; mapId?: string }
  | { type: 'queue:leave' }
  | { type: 'room:join'; ticket: string }
  | { type: 'room:leave' }
  | { type: 'input'; cmd: ClientInputCmd }
  | { type: 'fire'; yaw: number; pitch: number; seq: number }
  | { type: 'chat:send'; channel: 'team' | 'all'; text: string }
  | { type: 'voice:join' }
  | { type: 'voice:leave' }
  | { type: 'voice:speaking'; speaking: boolean }
  | { type: 'voice:offer'; targetId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'voice:answer'; targetId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'voice:ice'; targetId: string; candidate: RTCIceCandidateInit }
  | { type: 'ping'; clientTime: number };

export type ServerWsMessage =
  | { type: 'auth:ok'; userId: string; username: string }
  | { type: 'error'; message: string }
  | { type: 'queue:status'; inQueue: boolean; queueSize: number; estimatedSec: number }
  | { type: 'queue:matched'; ticket: string; roomId: string; mapId: string; team: TeamId }
  | {
      type: 'room:joined';
      roomId: string;
      roomName: string;
      map: ArenaMap;
      selfId: string;
      team: TeamId;
      chatHistory: ChatMessage[];
      voicePeers: { id: string; username: string; team: TeamId }[];
    }
  | {
      type: 'room:snapshot';
      serverTime: number;
      status: 'waiting' | 'active' | 'finished';
      timeLeftSec: number;
      scores: { cobalt: number; ember: number };
      players: PlayerSnapshot[];
      padCooldowns: Record<string, number>;
    }
  | { type: 'laser:fired'; beam: LaserBeamEvent }
  | { type: 'player:hit'; victimId: string; attackerId: string; damage: number; headshot: boolean; shieldBroken: boolean }
  | { type: 'player:tagged'; entry: KillFeedEntry }
  | { type: 'chat:message'; msg: ChatMessage }
  | { type: 'voice:peers'; peers: { id: string; username: string; team: TeamId; speaking?: boolean }[] }
  | { type: 'voice:offer'; fromId: string; fromName: string; sdp: RTCSessionDescriptionInit }
  | { type: 'voice:answer'; fromId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'voice:ice'; fromId: string; candidate: RTCIceCandidateInit }
  | { type: 'match:ended'; summary: MatchEndSummary }
  | { type: 'pong'; clientTime: number; serverTime: number };
