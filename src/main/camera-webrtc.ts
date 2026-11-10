import type { CameraWs } from './camera-service';

export type RtcSignal = { type: 'answer'; answer: string } | { type: 'candidate'; candidate: RTCIceCandidateInit } | { type: 'error'; message: string };
/** HA's native camera WebRTC signaling. Media is recvonly in the isolated viewer. */
export class CameraWebRtcSession {
  private closed = false;
  private sessionId: string | null = null;
  private candidates: RTCIceCandidateInit[] = [];
  private pendingKeys = new Set<string>();
  private nextId = 2;
  private timeout: ReturnType<typeof setTimeout>;
  constructor(private socket: CameraWs, token: string, private entity: string, offer: string, private signal: (value: RtcSignal) => void, invalidAuth: () => void) {
    this.timeout = setTimeout(() => this.fail('Camera did not start. Try again'), 30_000);
    socket.addEventListener('message', event => {
      if (this.closed) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: token }));
        else if (message.type === 'auth_invalid') { invalidAuth(); this.fail('Home Assistant rejected the saved token. Reconnect to view cameras'); }
        else if (message.type === 'auth_ok') socket.send(JSON.stringify({ id: 1, type: 'camera/webrtc/offer', entity_id: entity, offer }));
        else if (message.type === 'result' && !message.success) this.fail('This camera is offline or its live stream is unavailable');
        else if (message.type === 'event' && message.id === 1) {
          const value = message.event;
          if (value?.type === 'session' && typeof value.session_id === 'string') {
            this.sessionId = value.session_id;
            this.pendingKeys.clear();
            for (const candidate of this.candidates.splice(0)) this.candidate(candidate);
          } else if (value?.type === 'answer' && typeof value.answer === 'string' && value.answer.length <= 1_000_000) {
            clearTimeout(this.timeout);
            signal({ type: 'answer', answer: value.answer });
          } else if (value?.type === 'candidate' && value.candidate && typeof value.candidate.candidate === 'string') signal({ type: 'candidate', candidate: value.candidate });
          else if (value?.type === 'error') this.fail('This camera is offline or its live stream is unavailable');
        }
      } catch { this.fail('Home Assistant returned invalid camera signaling'); }
    });
    socket.addEventListener('error', () => this.fail('Camera connection failed'));
    socket.addEventListener('close', () => { if (!this.closed) this.fail('Camera connection closed'); });
  }
  candidate(candidate: RTCIceCandidateInit): void {
    if (this.closed) return;
    if (!candidate || typeof candidate.candidate !== 'string' || candidate.candidate.length > 8192 || (candidate.sdpMid !== undefined && candidate.sdpMid !== null && typeof candidate.sdpMid !== 'string') || (candidate.sdpMLineIndex !== undefined && candidate.sdpMLineIndex !== null && (!Number.isSafeInteger(candidate.sdpMLineIndex) || candidate.sdpMLineIndex < 0))) throw new Error('Invalid camera ICE candidate');
    if (!this.sessionId) {
      const key = JSON.stringify([candidate.candidate, candidate.sdpMid ?? null, candidate.sdpMLineIndex ?? null]);
      if (this.pendingKeys.has(key)) return;
      if (this.candidates.length >= 128) { this.fail('Camera connection could not start. Try again when the camera is online'); return; }
      this.pendingKeys.add(key);
      this.candidates.push(candidate); return;
    }
    try { this.socket.send(JSON.stringify({ id: this.nextId++, type: 'camera/webrtc/candidate', entity_id: this.entity, session_id: this.sessionId, candidate })); }
    catch { this.fail('Camera connection closed'); }
  }
  private fail(message: string): void {
    if (this.closed) return;
    this.close();
    this.signal({ type: 'error', message });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; clearTimeout(this.timeout); this.candidates = []; this.pendingKeys.clear();
    try { this.socket.send(JSON.stringify({ id: this.nextId++, type: 'unsubscribe_events', subscription: 1 })); } catch { /* connection was lost */ }
    try { this.socket.close(); } catch { /* connection was already unavailable */ }
  }
}
