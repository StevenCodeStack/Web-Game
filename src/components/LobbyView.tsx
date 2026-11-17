import { useState } from 'react';
import { Crosshair, Play, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import type { ArenaMap, RoomSummary, UserProfile } from '../../shared/types.ts';

interface LobbyViewProps {
  section: 'play' | 'arenas';
  user: UserProfile | null;
  arenas: ArenaMap[];
  rooms: RoomSummary[];
  inQueue: boolean;
  queueSize: number;
  estimatedSec: number;
  wsConnected: boolean;
  onJoinQueue: (mapId?: string) => void;
  onLeaveQueue: () => void;
  onJoinRoom: (roomId: string) => void;
  onCreateRoom: (params: { name: string; mapId: string; hasDrones: boolean }) => void;
  onDeleteArena: (arenaId: string) => void;
  onRefreshRooms: () => void;
  onOpenAuth: () => void;
  onNavigateBuilder: () => void;
}

export function LobbyView({
  section,
  user,
  arenas,
  rooms,
  inQueue,
  queueSize,
  estimatedSec,
  wsConnected,
  onJoinQueue,
  onLeaveQueue,
  onJoinRoom,
  onCreateRoom,
  onDeleteArena,
  onRefreshRooms,
  onOpenAuth,
  onNavigateBuilder,
}: LobbyViewProps) {
  const [selectedMapId, setSelectedMapId] = useState<string>('neon-citadel');
  const [customRoomName, setCustomRoomName] = useState('');
  const [hasDrones, setHasDrones] = useState(false);

  const heroArena = arenas.find((a) => a.id === selectedMapId) || arenas[0];
  const kd = user
    ? user.deaths > 0
      ? (user.kills / user.deaths).toFixed(2)
      : user.kills.toFixed(2)
    : '0.00';
  const acc = user && user.shotsFired > 0 ? `${Math.round((user.shotsHit / user.shotsFired) * 100)}%` : '0%';
  const winRate =
    user && user.matchesPlayed > 0 ? `${Math.round((user.wins / user.matchesPlayed) * 100)}%` : '0%';

  if (section === 'arenas') {
    return (
      <section className="mx-auto max-w-[1280px] px-6 py-10 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-cyan-400 mb-1">Arena Directory</div>
            <h1 className="font-display text-3xl font-bold text-slate-50">Official & Custom Arenas</h1>
            <p className="text-sm text-slate-400 mt-1">
              Every arena compiles directly into a Cannon.js 3D collision world on the server.
            </p>
          </div>

          <button
            type="button"
            onClick={onNavigateBuilder}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-xs font-semibold text-slate-950 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Build Custom Arena
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {arenas.map((arena) => (
            <article
              key={arena.id}
              className="flex flex-col overflow-hidden rounded-xl border border-white/8 bg-[#11151E]"
            >
              <div className="relative h-44 w-full bg-[#090C12] overflow-hidden">
                {arena.thumbnailUrl ? (
                  <img
                    src={arena.thumbnailUrl}
                    alt={`${arena.name} tactical laser tag arena`}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-[#0F172A] via-[#111827] to-[#0B0F17] p-4 text-center">
                    <Crosshair className="w-7 h-7 text-cyan-400/70 mb-2" />
                    <span className="font-display text-sm font-semibold text-slate-300">{arena.name}</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[#11151E] via-transparent to-transparent" />
              </div>

              <div className="flex flex-1 flex-col justify-between p-5 space-y-4">
                <div className="space-y-1.5">
                  <div className="text-xs text-slate-400">
                    {arena.isOfficial ? 'Official League Map' : `By ${arena.authorName}`} · {arena.width}m × {arena.depth}m
                  </div>
                  <h2 className="font-display text-xl font-bold text-slate-50">{arena.name}</h2>
                  <p className="text-xs text-slate-400 leading-relaxed">{arena.description}</p>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-white/6">
                  <button
                    type="button"
                    onClick={() =>
                      onCreateRoom({
                        name: `${arena.name} Skirmish`,
                        mapId: arena.id,
                        hasDrones: false,
                      })
                    }
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-xs font-semibold text-slate-950 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Launch Match
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onCreateRoom({
                        name: `${arena.name} Solo Range`,
                        mapId: arena.id,
                        hasDrones: true,
                      })
                    }
                    className="px-3 py-2 rounded-lg border border-white/12 hover:bg-white/6 text-xs font-semibold text-slate-200 cursor-pointer whitespace-nowrap"
                  >
                    Practice Drones
                  </button>
                  {!arena.isOfficial && user && arena.authorId === user.id && (
                    <button
                      type="button"
                      onClick={() => onDeleteArena(arena.id)}
                      aria-label={`Delete ${arena.name}`}
                      className="p-2 rounded-lg border border-red-500/25 text-red-400 hover:bg-red-500/15 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-8 space-y-10">
      {/* Hero Split: Matchmaking + Featured Arena */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-7 relative overflow-hidden rounded-xl border border-white/8 bg-[#11151E] min-h-[360px] flex flex-col justify-end">
          {heroArena?.thumbnailUrl ? (
            <img
              src={heroArena.thumbnailUrl}
              alt={`${heroArena.name} arena preview`}
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#0F172A] to-[#090B10]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#090B10] via-[#090B10]/75 to-black/25" />

          <div className="relative z-10 p-7 space-y-4">
            <div className="text-xs font-medium text-cyan-300">
              Authoritative Cannon.js Physics · 60 Hz Server Tick · Client Interpolation
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-slate-50 leading-tight max-w-xl [text-wrap:balance]">
              First-Person Tactical Laser Tag Arena
            </h1>
            <p className="text-sm text-slate-300 max-w-lg leading-relaxed">
              Enter skill-balanced matchmaking or deploy directly into an active arena with real-time WebRTC team voice and custom map support.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {inQueue ? (
                <button
                  type="button"
                  onClick={onLeaveQueue}
                  className="px-5 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
                >
                  Leave Queue ({queueSize} in queue · ~{estimatedSec}s)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => (user ? onJoinQueue(selectedMapId) : onOpenAuth())}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer"
                >
                  <Play className="w-4 h-4" />
                  {user ? 'Enter Ranked Matchmaking' : 'Sign In to Deploy'}
                </button>
              )}

              <select
                aria-label="Preferred arena map"
                value={selectedMapId}
                onChange={(e) => setSelectedMapId(e.target.value)}
                className="px-3.5 py-2.5 rounded-lg bg-[#0B0E15]/90 border border-white/15 text-xs font-semibold text-slate-100 focus:outline-none focus:border-cyan-400"
              >
                {arenas.map((a) => (
                  <option key={a.id} value={a.id}>
                    Map: {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Right Column: Persistent Account Stats & Custom Room Launcher */}
        <div className="lg:col-span-5 flex flex-col justify-between gap-5 rounded-xl border border-white/8 bg-[#11151E] p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-slate-50">
                {user ? user.username : 'Operator Profile'}
              </h2>
              <span className="text-xs text-slate-400">
                {wsConnected ? 'Server Linked' : 'Connecting...'}
              </span>
            </div>

            {user ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="rounded-lg bg-[#0B0E15] border border-white/6 p-3">
                  <div className="text-xs text-slate-400">MMR Rating</div>
                  <div className="font-mono-tabular text-xl font-bold text-cyan-400 mt-0.5">{user.mmr}</div>
                </div>
                <div className="rounded-lg bg-[#0B0E15] border border-white/6 p-3">
                  <div className="text-xs text-slate-400">Win Rate</div>
                  <div className="font-mono-tabular text-xl font-bold text-slate-100 mt-0.5">{winRate}</div>
                </div>
                <div className="rounded-lg bg-[#0B0E15] border border-white/6 p-3">
                  <div className="text-xs text-slate-400">K/D Ratio</div>
                  <div className="font-mono-tabular text-xl font-bold text-slate-100 mt-0.5">{kd}</div>
                </div>
                <div className="rounded-lg bg-[#0B0E15] border border-white/6 p-3">
                  <div className="text-xs text-slate-400">Total Tags</div>
                  <div className="font-mono-tabular text-lg font-semibold text-slate-200 mt-0.5">{user.kills}</div>
                </div>
                <div className="rounded-lg bg-[#0B0E15] border border-white/6 p-3">
                  <div className="text-xs text-slate-400">Accuracy</div>
                  <div className="font-mono-tabular text-lg font-semibold text-slate-200 mt-0.5">{acc}</div>
                </div>
                <div className="rounded-lg bg-[#0B0E15] border border-white/6 p-3">
                  <div className="text-xs text-slate-400">Matches</div>
                  <div className="font-mono-tabular text-lg font-semibold text-slate-200 mt-0.5">{user.matchesPlayed}</div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-[#0B0E15] border border-white/6 p-4 space-y-3">
                <p className="text-xs text-slate-300 leading-relaxed">
                  Create a persistent account to track MMR, tag accuracy, and leaderboard rank, or enter instantly as a Guest Striker.
                </p>
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-100 cursor-pointer"
                >
                  Sign In / Guest Access
                </button>
              </div>
            )}
          </div>

          {/* Launch Custom Match */}
          <div className="border-t border-white/8 pt-4 space-y-3">
            <h3 className="font-display text-sm font-bold text-slate-200">Host Custom Match</h3>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={customRoomName}
                maxLength={40}
                onChange={(e) => setCustomRoomName(e.target.value)}
                placeholder="Room title (optional)"
                className="flex-1 px-3 py-2 rounded-lg bg-[#0B0E15] border border-white/10 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400"
              />
              <button
                type="button"
                onClick={() =>
                  user
                    ? onCreateRoom({
                        name: customRoomName.trim() || `${heroArena?.name || 'Arena'} Room`,
                        mapId: selectedMapId,
                        hasDrones,
                      })
                    : onOpenAuth()
                }
                className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-white text-slate-950 text-xs font-semibold whitespace-nowrap cursor-pointer"
              >
                Create & Join
              </button>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hasDrones}
                onChange={(e) => setHasDrones(e.target.checked)}
                className="rounded border-white/20 bg-[#0B0E15] text-cyan-500"
              />
              Include automated target practice drones (for solo warm-up)
            </label>
          </div>
        </div>
      </section>

      {/* Active Multiplayer Rooms */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-50">Active Arena Instances</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Drop straight into a live server-authoritative match with signed matchmaking tickets.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefreshRooms}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/10 bg-[#11151E] hover:bg-[#181D29] text-xs font-semibold text-slate-200 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {rooms.map((room) => (
            <div
              key={room.roomId}
              className="flex flex-col justify-between rounded-xl border border-white/8 bg-[#11151E] p-5 space-y-4"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{room.mapName}</span>
                  <span className="font-mono-tabular">
                    {Math.floor(room.timeLeftSec / 60)}:{String(room.timeLeftSec % 60).padStart(2, '0')}
                  </span>
                </div>
                <h3 className="font-display text-lg font-bold text-slate-100 truncate">{room.name}</h3>
                <div className="flex items-center gap-3 text-xs text-slate-400 font-mono-tabular">
                  <span className="inline-flex items-center gap-1 text-slate-300">
                    <Users className="w-3.5 h-3.5" />
                    {room.playerCount}/{room.maxPlayers}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-sky-400">Cobalt {room.scores.cobalt}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-orange-400">Ember {room.scores.ember}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => (user ? onJoinRoom(room.roomId) : onOpenAuth())}
                className="w-full py-2.5 px-4 rounded-lg bg-cyan-500/15 hover:bg-cyan-500 text-cyan-300 hover:text-slate-950 border border-cyan-500/30 text-xs font-semibold transition-colors cursor-pointer"
              >
                Join Match
              </button>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
