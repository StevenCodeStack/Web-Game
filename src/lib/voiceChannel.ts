import type { ClientWsMessage } from '../../shared/types.ts';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export class TeamVoiceChannel {
  private localStream: MediaStream | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private audioElements = new Map<string, HTMLAudioElement>();
  private analyser: AnalyserNode | null = null;
  private audioCtx: AudioContext | null = null;
  private vadTimer: number | null = null;
  private lastSpeaking = false;
  public joined = false;
  public muted = false;
  public pushToTalk = false;
  public pttActive = false;

  private sendWs: (msg: ClientWsMessage) => void;
  private selfId: string;
  private onSpeakingChange: (speaking: boolean) => void;

  constructor(
    selfId: string,
    sendWs: (msg: ClientWsMessage) => void,
    onSpeakingChange: (speaking: boolean) => void,
  ) {
    this.selfId = selfId;
    this.sendWs = sendWs;
    this.onSpeakingChange = onSpeakingChange;
  }

  public async join(): Promise<void> {
    if (this.joined) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone API unavailable in this browser context.');
    }
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    this.joined = true;
    this.applyTrackEnabled();
    this.startVoiceActivityMonitor();
    this.sendWs({ type: 'voice:join' });
  }

  public leave(): void {
    if (!this.joined) return;
    this.joined = false;
    this.stopVoiceActivityMonitor();
    this.sendWs({ type: 'voice:speaking', speaking: false });
    this.sendWs({ type: 'voice:leave' });

    for (const pc of this.peers.values()) {
      pc.close();
    }
    this.peers.clear();

    for (const el of this.audioElements.values()) {
      el.srcObject = null;
      el.remove();
    }
    this.audioElements.clear();

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyTrackEnabled();
  }

  public setPushToTalk(enabled: boolean): void {
    this.pushToTalk = enabled;
    this.applyTrackEnabled();
  }

  public setPttActive(active: boolean): void {
    this.pttActive = active;
    this.applyTrackEnabled();
  }

  private applyTrackEnabled(): void {
    if (!this.localStream) return;
    const enabled = !this.muted && (!this.pushToTalk || this.pttActive);
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }

  private startVoiceActivityMonitor(): void {
    if (!this.localStream) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new Ctx();
      const source = this.audioCtx.createMediaStreamSource(this.localStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const data = new Uint8Array(this.analyser.frequencyBinCount);
      this.vadTimer = window.setInterval(() => {
        if (!this.analyser || !this.joined) return;
        const canTransmit = !this.muted && (!this.pushToTalk || this.pttActive);
        let speaking = false;
        if (canTransmit) {
          this.analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length;
          speaking = avg > 14;
        }
        if (speaking !== this.lastSpeaking) {
          this.lastSpeaking = speaking;
          this.onSpeakingChange(speaking);
          this.sendWs({ type: 'voice:speaking', speaking });
        }
      }, 150);
    } catch {
      // VAD optional
    }
  }

  private stopVoiceActivityMonitor(): void {
    if (this.vadTimer !== null) {
      clearInterval(this.vadTimer);
      this.vadTimer = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
    this.analyser = null;
    this.lastSpeaking = false;
  }

  public async syncPeers(peerList: { id: string }[]): Promise<void> {
    if (!this.joined) return;
    const targetIds = new Set(peerList.map((p) => p.id).filter((id) => id !== this.selfId));

    // Close removed peers
    for (const [id, pc] of this.peers.entries()) {
      if (!targetIds.has(id)) {
        pc.close();
        this.peers.delete(id);
        const el = this.audioElements.get(id);
        if (el) {
          el.srcObject = null;
          el.remove();
          this.audioElements.delete(id);
        }
      }
    }

    // Deterministic initiator: lexicographically smaller ID initiates offer
    for (const id of targetIds) {
      if (!this.peers.has(id) && this.selfId < id) {
        const pc = this.createPeerConnection(id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendWs({ type: 'voice:offer', targetId: id, sdp: offer });
      }
    }
  }

  public async handleOffer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.joined) return;
    let pc = this.peers.get(fromId);
    if (!pc) {
      pc = this.createPeerConnection(fromId);
    }
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sendWs({ type: 'voice:answer', targetId: fromId, sdp: answer });
  }

  public async handleAnswer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peers.get(fromId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  public async handleIceCandidate(fromId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peers.get(fromId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore stale ICE candidates
    }
  }

  private createPeerConnection(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peers.set(peerId, pc);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendWs({ type: 'voice:ice', targetId: peerId, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      let audio = this.audioElements.get(peerId);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.style.display = 'none';
        document.body.appendChild(audio);
        this.audioElements.set(peerId, audio);
      }
      audio.srcObject = e.streams[0];
    };

    return pc;
  }
}
