import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ArenaMap,
  ChatMessage,
  ClientWsMessage,
  KillFeedEntry,
  LaserBeamEvent,
  MatchEndSummary,
  PlayerSnapshot,
  RoomSummary,
  ServerWsMessage,
  UserProfile,
} from '../shared/types.ts';
import { OFFICIAL_ARENAS } from '../shared/arenas.ts';
import { tacticalAudio } from './lib/audio.ts';
import { apiFetch, getWsUrl } from './lib/config.ts';
import { ArenaBuilder } from './components/ArenaBuilder.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { GameArenaView, type ActiveRoomSession } from './components/GameArenaView.tsx';
import { LeaderboardView } from './components/LeaderboardView.tsx';
import { LobbyView } from './components/LobbyView.tsx';
import { TopNav, type NavTab } from './components/TopNav.tsx';

const TOKEN_STORAGE_KEY = 'prism_arena_token';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('play');
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const [arenas, setArenas] = useState<ArenaMap[]>(OFFICIAL_ARENAS);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);

  // Matchmaking state
  const [inQueue, setInQueue] = useState(false);
  const [queueSize, setQueueSize] = useState(0);
  const [estimatedSec, setEstimatedSec] = useState(12);

  // Active match state
  const [activeSession, setActiveSession] = useState<ActiveRoomSession | null>(null);
  const [snapshot, setSnapshot] = useState<{
    serverTime: number;
    status: 'waiting' | 'active' | 'finished';
    timeLeftSec: number;
    scores: { cobalt: number; ember: number };
    players: PlayerSnapshot[];
    padCooldowns: Record<string, number>;
  } | null>(null);
  const [latestBeams, setLatestBeams] = useState<LaserBeamEvent[]>([]);
  const [killFeed, setKillFeed] = useState<KillFeedEntry[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [voicePeers, setVoicePeers] = useState<{ id: string; username: string; team: 'cobalt' | 'ember'; speaking?: boolean }[]>([]);
  const [matchEnd, setMatchEnd] = useState<MatchEndSummary | null>(null);
  const [hitFeedback, setHitFeedback] = useState<{ id: number; headshot: boolean } | null>(null);
  const [damageFlashId, setDamageFlashId] = useState(0);
  const [voiceSignals, setVoiceSignals] = useState<
    (
      | { kind: 'offer'; fromId: string; sdp: RTCSessionDescriptionInit }
      | { kind: 'answer'; fromId: string; sdp: RTCSessionDescriptionInit }
      | { kind: 'ice'; fromId: string; candidate: RTCIceCandidateInit }
    )[]
  >([]);

  const wsRef = useRef<WebSocket | null>(null);
  const activeSessionRef = useRef<ActiveRoomSession | null>(null);
  activeSessionRef.current = activeSession;

  const loadMetadata = useCallback(async () => {
    try {
      const [arenasRes, roomsRes] = await Promise.all([
        apiFetch<{ arenas: ArenaMap[] }>('/api/arenas'),
        apiFetch<{ rooms: RoomSummary[] }>('/api/rooms'),
      ]);
      setArenas(arenasRes.arenas);
      setRooms(roomsRes.rooms);
    } catch {
      // Ignore transient poll errors
    }
  }, []);

  // Restore session if token exists
  useEffect(() => {
    if (!token) {
      setUser(null);
      return;
    }
    apiFetch<{ user: UserProfile }>('/api/auth/me', { token })
      .then((res) => setUser(res.user))
      .catch(() => {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken(null);
        setUser(null);
      });
  }, [token]);

  // Initial load + room browser polling
  useEffect(() => {
    void loadMetadata();
    const timer = window.setInterval(() => {
      if (!activeSessionRef.current) {
        void loadMetadata();
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [loadMetadata]);

  const sendWs = useCallback((msg: ClientWsMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // Persistent WebSocket lifecycle with auto-reconnect
  useEffect(() => {
    let closedByUnmount = false;
    let reconnectTimer = 0;
    let pingTimer = 0;

    function connect() {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        setBannerError(null);
        if (token) {
          ws.send(JSON.stringify({ type: 'auth:token', token } satisfies ClientWsMessage));
        }
        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping', clientTime: Date.now() } satisfies ClientWsMessage));
          }
        }, 2500);
      };

      ws.onmessage = (ev) => {
        let msg: ServerWsMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ServerWsMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'error':
            setBannerError(msg.message);
            break;
          case 'queue:status':
            setInQueue(msg.inQueue);
            setQueueSize(msg.queueSize);
            setEstimatedSec(msg.estimatedSec);
            break;
          case 'queue:matched':
            setInQueue(false);
            ws.send(JSON.stringify({ type: 'room:join', ticket: msg.ticket } satisfies ClientWsMessage));
            break;
          case 'room:joined':
            setSnapshot(null);
            setLatestBeams([]);
            setKillFeed([]);
            setMatchEnd(null);
            setChatMessages(msg.chatHistory);
            setVoicePeers(msg.voicePeers);
            setActiveSession({
              roomId: msg.roomId,
              roomName: msg.roomName,
              map: msg.map,
              selfId: msg.selfId,
              team: msg.team,
              chatHistory: msg.chatHistory,
              voicePeers: msg.voicePeers,
            });
            break;
          case 'room:snapshot':
            setSnapshot({
              serverTime: msg.serverTime,
              status: msg.status,
              timeLeftSec: msg.timeLeftSec,
              scores: msg.scores,
              players: msg.players,
              padCooldowns: msg.padCooldowns,
            });
            if (msg.status === 'active') {
              setMatchEnd(null);
            }
            break;
          case 'laser:fired':
            setLatestBeams((prev) => [...prev.slice(-14), msg.beam]);
            break;
          case 'player:hit': {
            const selfId = activeSessionRef.current?.selfId;
            if (selfId && msg.attackerId === selfId) {
              tacticalAudio.playHitmarker(msg.headshot);
              setHitFeedback({ id: Date.now(), headshot: msg.headshot });
              setTimeout(() => setHitFeedback(null), 180);
            } else if (selfId && msg.victimId === selfId) {
              tacticalAudio.playDamageTaken();
              setDamageFlashId(Date.now());
            }
            break;
          }
          case 'player:tagged': {
            setKillFeed((prev) => [...prev.slice(-8), msg.entry]);
            const selfId = activeSessionRef.current?.selfId;
            if (selfId && msg.entry.killerId === selfId) {
              tacticalAudio.playTagElimination();
            }
            break;
          }
          case 'chat:message':
            setChatMessages((prev) => [...prev.slice(-49), msg.msg]);
            break;
          case 'voice:peers':
            setVoicePeers(msg.peers);
            break;
          case 'voice:offer':
            setVoiceSignals((prev) => [...prev, { kind: 'offer', fromId: msg.fromId, sdp: msg.sdp }]);
            break;
          case 'voice:answer':
            setVoiceSignals((prev) => [...prev, { kind: 'answer', fromId: msg.fromId, sdp: msg.sdp }]);
            break;
          case 'voice:ice':
            setVoiceSignals((prev) => [...prev, { kind: 'ice', fromId: msg.fromId, candidate: msg.candidate }]);
            break;
          case 'match:ended':
            setMatchEnd(msg.summary);
            if (token) {
              apiFetch<{ user: UserProfile }>('/api/auth/me', { token })
                .then((r) => setUser(r.user))
                .catch(() => {});
            }
            break;
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        clearInterval(pingTimer);
        if (!closedByUnmount) {
          reconnectTimer = window.setTimeout(connect, 2000);
        }
      };
    }

    connect();
    return () => {
      closedByUnmount = true;
      clearTimeout(reconnectTimer);
      clearInterval(pingTimer);
      wsRef.current?.close();
    };
  }, [token]);

  function handleAuthenticated(newToken: string, newUser: UserProfile) {
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
    sendWs({ type: 'auth:token', token: newToken });
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
    setInQueue(false);
  }

  async function handleJoinRoom(roomId: string) {
    if (!token) {
      setAuthModalOpen(true);
      return;
    }
    setBannerError(null);
    try {
      const res = await apiFetch<{ ticket: string }>(`/api/rooms/${roomId}/ticket`, {
        method: 'POST',
        token,
      });
      sendWs({ type: 'room:join', ticket: res.ticket });
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Unable to join room');
    }
  }

  async function handleCreateRoom(params: { name: string; mapId: string; hasDrones: boolean }) {
    if (!token) {
      setAuthModalOpen(true);
      return;
    }
    setBannerError(null);
    try {
      const res = await apiFetch<{ room: RoomSummary; ticket: string }>('/api/rooms', {
        method: 'POST',
        token,
        body: JSON.stringify(params),
      });
      sendWs({ type: 'room:join', ticket: res.ticket });
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Unable to create room');
    }
  }

  async function handleDeleteArena(arenaId: string) {
    if (!token) return;
    try {
      await apiFetch(`/api/arenas/${arenaId}`, { method: 'DELETE', token });
      setArenas((prev) => prev.filter((a) => a.id !== arenaId));
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  function handleLeaveRoom() {
    sendWs({ type: 'room:leave' });
    setActiveSession(null);
    setSnapshot(null);
    setMatchEnd(null);
    void loadMetadata();
    if (token) {
      apiFetch<{ user: UserProfile }>('/api/auth/me', { token })
        .then((r) => setUser(r.user))
        .catch(() => {});
    }
  }

  if (activeSession) {
    return (
      <GameArenaView
        session={activeSession}
        snapshot={snapshot}
        latestBeams={latestBeams}
        killFeed={killFeed}
        chatMessages={chatMessages}
        voicePeers={voicePeers}
        matchEnd={matchEnd}
        hitFeedback={hitFeedback}
        damageFlashId={damageFlashId}
        voiceSignalQueue={voiceSignals}
        onConsumeVoiceSignals={() => setVoiceSignals([])}
        onSendWs={sendWs}
        onLeaveRoom={handleLeaveRoom}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100 flex flex-col">
      <TopNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        user={user}
        onOpenAuth={() => setAuthModalOpen(true)}
      />

      {bannerError && (
        <div className="mx-auto mt-4 w-full max-w-[1280px] px-6">
          <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-300">
            <span>{bannerError}</span>
            <button
              type="button"
              onClick={() => setBannerError(null)}
              className="underline hover:text-white cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="flex-1">
        {(activeTab === 'play' || activeTab === 'arenas') && (
          <LobbyView
            section={activeTab}
            user={user}
            arenas={arenas}
            rooms={rooms}
            inQueue={inQueue}
            queueSize={queueSize}
            estimatedSec={estimatedSec}
            wsConnected={wsConnected}
            onJoinQueue={(mapId) => sendWs({ type: 'queue:join', mapId })}
            onLeaveQueue={() => sendWs({ type: 'queue:leave' })}
            onJoinRoom={handleJoinRoom}
            onCreateRoom={handleCreateRoom}
            onDeleteArena={handleDeleteArena}
            onRefreshRooms={() => void loadMetadata()}
            onOpenAuth={() => setAuthModalOpen(true)}
            onNavigateBuilder={() => setActiveTab('builder')}
          />
        )}

        {activeTab === 'builder' && (
          <ArenaBuilder
            user={user}
            token={token}
            onOpenAuth={() => setAuthModalOpen(true)}
            onArenaSaved={(arena) => {
              setArenas((prev) => [arena, ...prev.filter((a) => a.id !== arena.id)]);
            }}
          />
        )}

        {activeTab === 'leaderboard' && <LeaderboardView />}
      </div>

      <AuthModal
        open={authModalOpen}
        user={user}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={handleAuthenticated}
        onLogout={handleLogout}
      />
    </div>
  );
}
