import { useEffect, useRef, useState } from 'react';
import {
  LogOut,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Radio,
  Send,
  Shield,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  ArenaMap,
  ChatMessage,
  ClientInputCmd,
  ClientWsMessage,
  KillFeedEntry,
  LaserBeamEvent,
  MatchEndSummary,
  PlayerSnapshot,
  TeamId,
} from '../../shared/types.ts';
import { tacticalAudio } from '../lib/audio.ts';
import { LaserTagEngine, type HudTelemetry } from '../lib/gameEngine.ts';
import { TeamVoiceChannel } from '../lib/voiceChannel.ts';

export interface ActiveRoomSession {
  roomId: string;
  roomName: string;
  map: ArenaMap;
  selfId: string;
  team: TeamId;
  chatHistory: ChatMessage[];
  voicePeers: { id: string; username: string; team: TeamId; speaking?: boolean }[];
}

interface GameArenaViewProps {
  session: ActiveRoomSession;
  snapshot: {
    serverTime: number;
    status: 'waiting' | 'active' | 'finished';
    timeLeftSec: number;
    scores: { cobalt: number; ember: number };
    players: PlayerSnapshot[];
    padCooldowns: Record<string, number>;
  } | null;
  latestBeams: LaserBeamEvent[];
  killFeed: KillFeedEntry[];
  chatMessages: ChatMessage[];
  voicePeers: { id: string; username: string; team: TeamId; speaking?: boolean }[];
  matchEnd: MatchEndSummary | null;
  hitFeedback: { id: number; headshot: boolean } | null;
  damageFlashId: number;
  voiceSignalQueue: (
    | { kind: 'offer'; fromId: string; sdp: RTCSessionDescriptionInit }
    | { kind: 'answer'; fromId: string; sdp: RTCSessionDescriptionInit }
    | { kind: 'ice'; fromId: string; candidate: RTCIceCandidateInit }
  )[];
  onConsumeVoiceSignals: () => void;
  onSendWs: (msg: ClientWsMessage) => void;
  onLeaveRoom: () => void;
}

export function GameArenaView({
  session,
  snapshot,
  latestBeams,
  killFeed,
  chatMessages,
  voicePeers,
  matchEnd,
  hitFeedback,
  damageFlashId,
  voiceSignalQueue,
  onConsumeVoiceSignals,
  onSendWs,
  onLeaveRoom,
}: GameArenaViewProps) {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<LaserTagEngine | null>(null);
  const voiceRef = useRef<TeamVoiceChannel | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const processedBeamIds = useRef<Set<string>>(new Set());

  const [pointerLocked, setPointerLocked] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [scoreboardOpen, setScoreboardOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatChannel, setChatChannel] = useState<'team' | 'all'>('team');
  const [chatText, setChatText] = useState('');
  const [hudData, setHudData] = useState<HudTelemetry>({
    x: 0,
    z: 0,
    yaw: 0,
    players: [],
    locked: false,
    contextLost: false,
  });

  // Voice & Audio UI state
  const [sfxMuted, setSfxMuted] = useState(false);
  const [voiceJoined, setVoiceJoined] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [pttMode, setPttMode] = useState(false);
  const [pttDown, setPttDown] = useState(false);
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Mount Three.js engine once per room session
  useEffect(() => {
    const mount = canvasMountRef.current;
    if (!mount) return;

    const engine = new LaserTagEngine({
      container: mount,
      map: session.map,
      selfId: session.selfId,
      selfTeam: session.team,
      onSendInput: (cmd: ClientInputCmd) => {
        onSendWs({ type: 'input', cmd });
      },
      onFire: (yaw, pitch, seq) => {
        const selfSnap = snapshotRef.current?.players.find((p) => p.id === session.selfId);
        const overcharged = selfSnap ? Date.now() < selfSnap.overchargeUntil : false;
        tacticalAudio.playLaserFire(overcharged);
        onSendWs({ type: 'fire', yaw, pitch, seq });
      },
      onHudUpdate: (data) => {
        setHudData(data);
        if (data.contextLost) setContextLost(true);
      },
      onPointerLockChange: (locked) => {
        setPointerLocked(locked);
      },
    });
    engineRef.current = engine;

    const voice = new TeamVoiceChannel(
      session.selfId,
      onSendWs,
      (speaking) => setSelfSpeaking(speaking),
    );
    voiceRef.current = voice;

    return () => {
      voice.leave();
      voiceRef.current = null;
      engine.dispose();
      engineRef.current = null;
      processedBeamIds.current.clear();
    };
  }, [session.roomId, session.selfId]);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Forward server snapshots to Three.js interpolation/reconciliation engine
  useEffect(() => {
    if (snapshot && engineRef.current) {
      engineRef.current.applyServerSnapshot(snapshot.serverTime, snapshot.players, snapshot.padCooldowns);
    }
  }, [snapshot]);

  // Spawn incoming laser beams
  useEffect(() => {
    if (!engineRef.current) return;
    for (const beam of latestBeams) {
      if (!processedBeamIds.current.has(beam.id)) {
        processedBeamIds.current.add(beam.id);
        engineRef.current.spawnLaserBeam(beam);
      }
    }
    if (processedBeamIds.current.size > 200) {
      processedBeamIds.current.clear();
    }
  }, [latestBeams]);

  // Sync WebRTC voice peers
  useEffect(() => {
    if (voiceRef.current && voiceJoined) {
      void voiceRef.current.syncPeers(voicePeers);
    }
  }, [voicePeers, voiceJoined]);

  // Handle WebRTC signaling queue
  useEffect(() => {
    if (voiceSignalQueue.length === 0 || !voiceRef.current) return;
    for (const sig of voiceSignalQueue) {
      if (sig.kind === 'offer') {
        void voiceRef.current.handleOffer(sig.fromId, sig.sdp);
      } else if (sig.kind === 'answer') {
        void voiceRef.current.handleAnswer(sig.fromId, sig.sdp);
      } else if (sig.kind === 'ice') {
        void voiceRef.current.handleIceCandidate(sig.fromId, sig.candidate);
      }
    }
    onConsumeVoiceSignals();
  }, [voiceSignalQueue, onConsumeVoiceSignals]);

  // Global keyboard shortcuts inside Arena (Tab scoreboard, T chat, V PTT)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        e.preventDefault();
        setScoreboardOpen(true);
      } else if ((e.code === 'KeyT' || e.code === 'Enter') && !chatOpen) {
        e.preventDefault();
        setChatOpen(true);
        engineRef.current?.setChatOpen(true);
        setTimeout(() => chatInputRef.current?.focus(), 20);
      } else if (e.code === 'Escape' && chatOpen) {
        setChatOpen(false);
        engineRef.current?.setChatOpen(false);
      } else if (e.code === 'KeyV' && !chatOpen && voiceRef.current && pttMode) {
        voiceRef.current.setPttActive(true);
        setPttDown(true);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Tab') {
        setScoreboardOpen(false);
      } else if (e.code === 'KeyV' && voiceRef.current && pttMode) {
        voiceRef.current.setPttActive(false);
        setPttDown(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [chatOpen, pttMode]);

  async function toggleVoiceJoin() {
    if (!voiceRef.current) return;
    setVoiceError(null);
    if (voiceJoined) {
      voiceRef.current.leave();
      setVoiceJoined(false);
      setSelfSpeaking(false);
    } else {
      try {
        await voiceRef.current.join();
        setVoiceJoined(true);
      } catch (err) {
        setVoiceError(err instanceof Error ? err.message : 'Microphone permission denied');
      }
    }
  }

  function toggleMicMute() {
    if (!voiceRef.current) return;
    const next = !micMuted;
    setMicMuted(next);
    voiceRef.current.setMuted(next);
  }

  function togglePttMode() {
    if (!voiceRef.current) return;
    const next = !pttMode;
    setPttMode(next);
    voiceRef.current.setPushToTalk(next);
  }

  function toggleSfx() {
    const next = !sfxMuted;
    setSfxMuted(next);
    tacticalAudio.muted = next;
  }

  function submitChat(e: React.FormEvent) {
    e.preventDefault();
    if (chatText.trim()) {
      onSendWs({ type: 'chat:send', channel: chatChannel, text: chatText.trim() });
      setChatText('');
    }
    setChatOpen(false);
    engineRef.current?.setChatOpen(false);
  }

  const players = snapshot?.players || [];
  const selfPlayer = players.find((p) => p.id === session.selfId);
  const timeLeft = snapshot?.timeLeftSec ?? 180;
  const scores = snapshot?.scores ?? { cobalt: 0, ember: 0 };
  const overcharged = selfPlayer ? Date.now() < selfPlayer.overchargeUntil : false;

  const cobaltPlayers = players.filter((p) => p.team === 'cobalt').sort((a, b) => b.score - a.score);
  const emberPlayers = players.filter((p) => p.team === 'ember').sort((a, b) => b.score - a.score);

  return (
    <div className="fixed inset-0 z-50 bg-[#070A10] select-none overflow-hidden">
      {/* Isolated WebGL Mount Container */}
      <div ref={canvasMountRef} className="absolute inset-0 w-full h-full" />

      {/* Damage Flash Overlay */}
      {damageFlashId > 0 && (
        <div
          key={damageFlashId}
          className="pointer-events-none absolute inset-0 border-[12px] border-red-500/45 transition-opacity duration-200"
        />
      )}

      {/* Top-Center Match Score & Clock */}
      <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-4 rounded-xl border border-white/10 bg-[#0B0F17]/90 px-5 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold text-sky-400">COBALT</span>
          <span className="font-display text-2xl font-bold font-mono-tabular text-slate-50">
            {scores.cobalt}
          </span>
        </div>

        <div className="px-3 border-x border-white/10 text-center">
          <div className="font-mono-tabular text-base font-bold text-slate-100">
            {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
          </div>
          <div className="text-[10px] text-slate-400 truncate max-w-[140px]">{session.map.name}</div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="font-display text-2xl font-bold font-mono-tabular text-slate-50">
            {scores.ember}
          </span>
          <span className="text-xs font-semibold text-orange-400">EMBER</span>
        </div>
      </div>

      {/* Top-Left Room Actions & Latency */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onLeaveRoom}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/12 bg-[#0B0F17]/90 hover:bg-red-500/20 text-xs font-semibold text-slate-200 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          Exit Match
        </button>

        <button
          type="button"
          onClick={toggleSfx}
          aria-label={sfxMuted ? 'Unmute game audio' : 'Mute game audio'}
          className="p-2 rounded-lg border border-white/12 bg-[#0B0F17]/90 hover:bg-white/10 text-slate-200 cursor-pointer"
        >
          {sfxMuted ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
        </button>

        <button
          type="button"
          onClick={() => setScoreboardOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/12 bg-[#0B0F17]/90 hover:bg-white/10 text-xs font-semibold text-slate-200 cursor-pointer"
        >
          <Users className="w-3.5 h-3.5" />
          Scores (Tab)
        </button>

        {selfPlayer && (
          <span className="hidden sm:inline-block px-2.5 py-1.5 rounded-lg bg-[#0B0F17]/85 border border-white/8 font-mono-tabular text-[11px] text-slate-400">
            {selfPlayer.pingMs} ms
          </span>
        )}
      </div>

      {/* Top-Right Kill Feed */}
      <div className="pointer-events-none absolute top-4 right-4 w-72 space-y-1.5">
        {killFeed.slice(-5).map((k) => (
          <div
            key={k.id}
            className="flex items-center justify-end gap-1.5 rounded-lg bg-[#0B0F17]/85 border border-white/8 px-3 py-1.5 text-xs"
          >
            <span className={k.killerTeam === 'cobalt' ? 'font-semibold text-sky-400' : 'font-semibold text-orange-400'}>
              {k.killerName}
            </span>
            <span className="text-slate-400">{k.headshot ? 'headshot' : 'tagged'}</span>
            <span className={k.victimTeam === 'cobalt' ? 'font-semibold text-sky-400' : 'font-semibold text-orange-400'}>
              {k.victimName}
            </span>
          </div>
        ))}
      </div>

      {/* Center Reticle & Hitmarker */}
      {pointerLocked && selfPlayer?.alive !== false && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="relative flex items-center justify-center">
            <div className="h-1.5 w-1.5 rounded-full bg-white shadow" />
            <div className="absolute -top-3 h-2 w-0.5 bg-white/80" />
            <div className="absolute -bottom-3 h-2 w-0.5 bg-white/80" />
            <div className="absolute -left-3 h-0.5 w-2 bg-white/80" />
            <div className="absolute -right-3 h-0.5 w-2 bg-white/80" />

            {hitFeedback && (
              <div
                key={hitFeedback.id}
                className={`absolute h-7 w-7 rotate-45 border-2 ${
                  hitFeedback.headshot ? 'border-amber-400' : 'border-white'
                }`}
              />
            )}
          </div>
        </div>
      )}

      {/* Respawn Overlay */}
      {selfPlayer && !selfPlayer.alive && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55">
          <div className="rounded-xl border border-white/12 bg-[#0B0F17]/95 px-7 py-5 text-center space-y-1">
            <div className="text-xs font-medium text-red-400">Sensors Offline</div>
            <div className="font-display text-2xl font-bold text-slate-50">Recharging Suit...</div>
            <div className="text-xs text-slate-400">Deploying back to team spawn in 2.5s</div>
          </div>
        </div>
      )}

      {/* Click-to-Lock Pointer Prompt */}
      {!pointerLocked && !chatOpen && !scoreboardOpen && !matchEnd && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45">
          <div className="max-w-md rounded-xl border border-white/12 bg-[#0B0F17]/95 p-6 text-center space-y-4">
            {contextLost ? (
              <p className="text-sm text-red-300">WebGL context interrupted. Reloading graphics surface...</p>
            ) : (
              <>
                <div>
                  <div className="text-xs font-medium text-cyan-400 mb-1">
                    Assigned Team: {session.team === 'cobalt' ? 'Cobalt Alpha' : 'Ember Omega'}
                  </div>
                  <h2 className="font-display text-2xl font-bold text-slate-50">{session.roomName}</h2>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  WASD Move · Space Jump · Shift Sprint · Left Click Fire Laser · T Chat · V Push-to-Talk · Tab Scoreboard
                </p>
                <button
                  type="button"
                  onClick={() => engineRef.current?.lockPointer()}
                  className="w-full py-2.5 px-5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-sm cursor-pointer"
                >
                  Click to Lock Aim & Play
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bottom-Left: Chat + Voice Channel + Health/Shield */}
      <div className="absolute bottom-4 left-4 w-80 space-y-2.5">
        {/* Team Voice Channel Panel */}
        <div className="rounded-xl border border-white/10 bg-[#0B0F17]/90 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Radio className={`w-3.5 h-3.5 ${voiceJoined ? 'text-emerald-400' : 'text-slate-400'}`} />
              <span>Team Voice ({voicePeers.length})</span>
            </div>

            <div className="flex items-center gap-1.5">
              {voiceJoined && (
                <>
                  <button
                    type="button"
                    onClick={togglePttMode}
                    className={`px-2 py-1 rounded text-[10px] font-semibold cursor-pointer ${
                      pttMode ? 'bg-amber-500/20 text-amber-300' : 'bg-white/6 text-slate-300'
                    }`}
                  >
                    {pttMode ? (pttDown ? 'PTT (Active)' : 'PTT [V]') : 'Open Mic'}
                  </button>
                  <button
                    type="button"
                    onClick={toggleMicMute}
                    aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
                    className="p-1.5 rounded bg-white/8 hover:bg-white/15 text-slate-200 cursor-pointer"
                  >
                    {micMuted ? <MicOff className="w-3.5 h-3.5 text-red-400" /> : <Mic className="w-3.5 h-3.5 text-emerald-400" />}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={toggleVoiceJoin}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer ${
                  voiceJoined
                    ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                    : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                }`}
              >
                {voiceJoined ? <PhoneOff className="w-3 h-3" /> : <Phone className="w-3 h-3" />}
                {voiceJoined ? 'Leave' : 'Join'}
              </button>
            </div>
          </div>

          {voiceError && <div className="text-[11px] text-red-400">{voiceError}</div>}

          {voicePeers.length > 0 && (
            <div className="flex flex-wrap gap-2 text-[11px] text-slate-300">
              {voicePeers.map((vp) => {
                const isSpeaking = vp.id === session.selfId ? selfSpeaking : vp.speaking;
                return (
                  <span
                    key={vp.id}
                    className={`px-2 py-0.5 rounded bg-white/6 ${
                      isSpeaking ? 'text-emerald-300 ring-1 ring-emerald-400/60' : 'text-slate-300'
                    }`}
                  >
                    {vp.username}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* In-Game Text Chat */}
        <div className="rounded-xl border border-white/10 bg-[#0B0F17]/88 p-3 space-y-2">
          <div className="max-h-28 overflow-y-auto space-y-1 text-xs">
            {chatMessages.length === 0 ? (
              <div className="text-slate-500">Press T to send team or global chat...</div>
            ) : (
              chatMessages.slice(-8).map((m) => (
                <div key={m.id} className="leading-snug break-words">
                  <span className="text-slate-500 mr-1">[{m.channel === 'team' ? 'TEAM' : 'ALL'}]</span>
                  <span className={m.senderTeam === 'cobalt' ? 'font-semibold text-sky-400' : 'font-semibold text-orange-400'}>
                    {m.senderName}:{' '}
                  </span>
                  <span className="text-slate-200">{m.text}</span>
                </div>
              ))
            )}
          </div>

          {chatOpen && (
            <form onSubmit={submitChat} className="flex items-center gap-1.5 pt-1 border-t border-white/8">
              <button
                type="button"
                onClick={() => setChatChannel((c) => (c === 'team' ? 'all' : 'team'))}
                className="px-2 py-1.5 rounded bg-white/8 text-[10px] font-semibold text-cyan-300 cursor-pointer shrink-0"
              >
                {chatChannel === 'team' ? 'TEAM' : 'ALL'}
              </button>
              <input
                ref={chatInputRef}
                type="text"
                value={chatText}
                maxLength={200}
                onChange={(e) => setChatText(e.target.value)}
                placeholder="Type message..."
                className="flex-1 min-w-0 bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
              />
              <button type="submit" aria-label="Send message" className="p-1.5 text-cyan-400 hover:text-cyan-300 cursor-pointer">
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          )}
        </div>

        {/* Health & Shield Bars */}
        <div className="rounded-xl border border-white/10 bg-[#0B0F17]/92 p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-200">
              <Shield className="w-3.5 h-3.5 text-cyan-400" />
              Armor & Shield
            </span>
            <span className="font-mono-tabular font-bold text-slate-100">
              {selfPlayer?.health ?? 100} HP · {selfPlayer?.shield ?? 50} SHD
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="h-2 w-full rounded bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-cyan-400 transition-all duration-150"
                style={{ width: `${Math.min(100, ((selfPlayer?.shield ?? 50) / 50) * 100)}%` }}
              />
            </div>
            <div className="h-2.5 w-full rounded bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-150 ${
                  (selfPlayer?.health ?? 100) <= 30 ? 'bg-red-500' : 'bg-emerald-400'
                }`}
                style={{ width: `${Math.min(100, selfPlayer?.health ?? 100)}%` }}
              />
            </div>
          </div>

          {overcharged && (
            <div className="text-[11px] font-semibold text-amber-400">
              Overcharge Active · Rapid Fire +25% Laser Output
            </div>
          )}
        </div>
      </div>

      {/* Bottom-Right Tactical Radar Minimap */}
      <div className="pointer-events-none absolute bottom-4 right-4 rounded-xl border border-white/10 bg-[#0B0F17]/90 p-3 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] font-medium text-slate-400">
          <span>Tactical Radar</span>
          <span className="font-mono-tabular">{selfPlayer?.kills ?? 0}K / {selfPlayer?.deaths ?? 0}D</span>
        </div>
        <svg
          width="148"
          height="148"
          viewBox={`${-session.map.width / 2} ${-session.map.depth / 2} ${session.map.width} ${session.map.depth}`}
          className="rounded bg-[#070A10] border border-white/6"
        >
          {session.map.blocks.map((b) => (
            <rect
              key={b.id}
              x={b.x - b.w / 2}
              y={b.z - b.d / 2}
              width={b.w}
              height={b.d}
              fill="rgba(148,163,184,0.22)"
            />
          ))}
          {hudData.players.map((p) => {
            if (!p.alive) return null;
            const isSelf = p.id === session.selfId;
            return (
              <circle
                key={p.id}
                cx={isSelf ? hudData.x : p.x}
                cy={isSelf ? hudData.z : p.z}
                r={isSelf ? 1.8 : 1.3}
                fill={
                  isSelf
                    ? '#FFFFFF'
                    : p.team === 'cobalt'
                      ? '#38BDF8'
                      : '#F97316'
                }
              />
            );
          })}
        </svg>
      </div>

      {/* Live Scoreboard Modal (Tab) */}
      {scoreboardOpen && !matchEnd && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-3xl rounded-xl border border-white/12 bg-[#0B0F17]/95 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl font-bold text-slate-50">{session.roomName}</h2>
              <span className="text-xs text-slate-400">First to 25 Tags · Hold Tab</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { label: 'Team Cobalt', score: scores.cobalt, list: cobaltPlayers, color: 'text-sky-400' },
                { label: 'Team Ember', score: scores.ember, list: emberPlayers, color: 'text-orange-400' },
              ].map((group) => (
                <div key={group.label} className="rounded-lg border border-white/8 bg-[#11151E] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/8">
                    <span className={`font-display text-sm font-bold ${group.color}`}>{group.label}</span>
                    <span className="font-mono-tabular text-lg font-bold text-slate-100">{group.score}</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-white/6">
                        <th className="py-2 px-3 text-left">Operator</th>
                        <th className="py-2 px-2 text-right">K</th>
                        <th className="py-2 px-2 text-right">D</th>
                        <th className="py-2 px-2 text-right">Score</th>
                        <th className="py-2 px-3 text-right">Ping</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 font-mono-tabular">
                      {group.list.map((p) => (
                        <tr key={p.id} className={p.id === session.selfId ? 'bg-white/6' : ''}>
                          <td className="py-2 px-3 font-sans font-medium text-slate-100 truncate max-w-[130px]">
                            {p.username}
                          </td>
                          <td className="py-2 px-2 text-right text-slate-200">{p.kills}</td>
                          <td className="py-2 px-2 text-right text-slate-400">{p.deaths}</td>
                          <td className="py-2 px-2 text-right font-semibold text-cyan-300">{p.score}</td>
                          <td className="py-2 px-3 text-right text-slate-400">{p.pingMs}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Match End Summary Overlay */}
      {matchEnd && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-xl rounded-xl border border-white/12 bg-[#0B0F17]/95 p-7 text-center space-y-5">
            <div>
              <div className="text-xs font-medium text-cyan-400 mb-1">Match Complete</div>
              <h2 className="font-display text-3xl font-bold text-slate-50">
                {matchEnd.winningTeam === 'draw'
                  ? 'Draw Match'
                  : matchEnd.winningTeam === 'cobalt'
                    ? 'Team Cobalt Victory'
                    : 'Team Ember Victory'}
              </h2>
              <div className="font-mono-tabular text-lg font-bold text-slate-300 mt-1">
                Cobalt {matchEnd.scores.cobalt} — {matchEnd.scores.ember} Ember
              </div>
            </div>

            <div className="rounded-lg border border-white/8 bg-[#11151E] p-4 text-xs text-slate-300">
              Match MVP: <span className="font-semibold text-cyan-300">{matchEnd.mvpName}</span> · Stats & MMR persisted
            </div>

            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={onLeaveRoom}
                className="px-5 py-2.5 rounded-lg border border-white/15 hover:bg-white/8 text-sm font-semibold text-slate-200 cursor-pointer"
              >
                Return to Lobby
              </button>
            </div>
            <p className="text-xs text-slate-500">Next round starts automatically in {matchEnd.nextRoundSec}s...</p>
          </div>
        </div>
      )}
    </div>
  );
}
