import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraWebRtcSession } from '../src/main/camera-webrtc';
import type { CameraWs } from '../src/main/camera-service';
class Socket implements CameraWs {
  callbacks = new Map<string, ((event: any) => void)[]>();
  send = vi.fn(); close = vi.fn();
  addEventListener(type: string, callback: (event: any) => void) { this.callbacks.set(type, [...this.callbacks.get(type) ?? [], callback]); }
  emit(value: unknown) { for (const callback of this.callbacks.get('message') ?? []) callback({ data: JSON.stringify(value) }); }
}
const sessions: CameraWebRtcSession[] = [];
afterEach(() => { for (const session of sessions.splice(0)) session.close(); vi.useRealTimers(); });
function fixture() {
  const socket = new Socket(), signal = vi.fn(), invalid = vi.fn();
  const session = new CameraWebRtcSession(socket, 'dummy-rtc-token', 'camera.ring', 'v=0\r\nfixture-offer', signal, invalid); sessions.push(session);
  return { socket, signal, invalid, session };
}
describe('Home Assistant camera WebRTC signaling', () => {
  it('authenticates, subscribes to the camera and queues ICE until HA provides its session', () => {
    const f = fixture();
    f.socket.emit({ type: 'auth_required' });
    expect(JSON.parse(f.socket.send.mock.calls[0]![0])).toEqual({ type: 'auth', access_token: 'dummy-rtc-token' });
    f.socket.emit({ type: 'auth_ok' });
    expect(JSON.parse(f.socket.send.mock.calls[1]![0])).toMatchObject({ id: 1, type: 'camera/webrtc/offer', entity_id: 'camera.ring', offer: 'v=0\r\nfixture-offer' });
    const candidate = { candidate: 'candidate:fixture', sdpMid: '0', sdpMLineIndex: 0 };
    f.session.candidate(candidate);
    expect(f.socket.send).toHaveBeenCalledTimes(2);
    f.socket.emit({ type: 'event', id: 1, event: { type: 'session', session_id: 'ha-session' } });
    expect(JSON.parse(f.socket.send.mock.calls[2]![0])).toMatchObject({ type: 'camera/webrtc/candidate', entity_id: 'camera.ring', session_id: 'ha-session', candidate });
  });
  it('forwards only answer/candidate signals and closes the HA subscription on stop', () => {
    const f = fixture();
    f.socket.emit({ type: 'event', id: 1, event: { type: 'session', session_id: 'not-exposed-to-viewer' } });
    f.socket.emit({ type: 'event', id: 1, event: { type: 'candidate', candidate: { candidate: 'candidate:remote' } } });
    f.socket.emit({ type: 'event', id: 1, event: { type: 'answer', answer: 'v=0\r\nfixture-answer' } });
    expect(f.signal.mock.calls.map(([value]) => value.type)).toEqual(['candidate', 'answer']);
    f.session.close();
    expect(JSON.parse(f.socket.send.mock.calls.at(-1)![0])).toMatchObject({ type: 'unsubscribe_events', subscription: 1 });
    expect(f.socket.close).toHaveBeenCalledOnce();
    f.socket.emit({ type: 'event', id: 1, event: { type: 'answer', answer: 'ignored' } });
    expect(f.signal).toHaveBeenCalledTimes(2);
  });
  it('turns auth and service errors into a safe failure and tears down the connection', () => {
    const auth = fixture(); auth.socket.emit({ type: 'auth_invalid', message: 'Never forward this raw message' });
    expect(auth.invalid).toHaveBeenCalledOnce();
    expect(auth.signal).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(JSON.stringify(auth.signal.mock.calls)).not.toContain('Never forward');
    expect(auth.socket.close).toHaveBeenCalledOnce();
    const failure = fixture(); failure.socket.emit({ type: 'event', id: 1, event: { type: 'error', message: 'raw backend details' } });
    expect(failure.signal).toHaveBeenCalledWith({ type: 'error', message: 'This camera is offline or its live stream is unavailable' });
  });
  it('deduplicates queued candidates and reports overflow only once without rejecting later callbacks', () => {
    const f = fixture();
    for (let i = 0; i < 400; i++) f.session.candidate({ candidate: 'candidate:duplicate', sdpMid: '0', sdpMLineIndex: 0 });
    expect(f.signal).not.toHaveBeenCalled();
    for (let i = 0; i < 127; i++) f.session.candidate({ candidate: `candidate:unique-${i}`, sdpMid: '0', sdpMLineIndex: 0 });
    expect(f.signal).not.toHaveBeenCalled();
    expect(() => f.session.candidate({ candidate: 'candidate:overflow' })).not.toThrow();
    for (let i = 0; i < 400; i++) expect(() => f.session.candidate({ candidate: `candidate:late-${i}` })).not.toThrow();
    expect(f.signal).toHaveBeenCalledExactlyOnceWith({ type: 'error', message: 'Camera connection could not start. Try again when the camera is online' });
    expect(f.socket.close).toHaveBeenCalledOnce();
    f.socket.emit({ type: 'event', id: 1, event: { type: 'session', session_id: 'late-session' } });
    expect(f.signal).toHaveBeenCalledOnce();
    expect(f.socket.send).toHaveBeenCalledOnce(); // unsubscribe only; no queued candidates survive
  });
  it('turns a lost socket during queued-candidate flush into a single controlled failure', () => {
    const f = fixture(); f.session.candidate({ candidate: 'candidate:pending' });
    f.socket.send.mockImplementation(() => { throw new Error('Socket closed'); });
    expect(() => f.socket.emit({ type: 'event', id: 1, event: { type: 'session', session_id: 'ha-session' } })).not.toThrow();
    expect(f.signal).toHaveBeenCalledExactlyOnceWith({ type: 'error', message: 'Camera connection closed' });
    expect(f.socket.close).toHaveBeenCalledOnce();
  });
  it('bounds pending candidates and times out negotiations that never produce an answer', async () => {
    vi.useFakeTimers(); const f = fixture();
    expect(() => f.session.candidate({ candidate: 'x'.repeat(8193) })).toThrow('Invalid');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.signal).toHaveBeenCalledWith({ type: 'error', message: 'Camera did not start. Try again' });
    expect(f.socket.close).toHaveBeenCalledOnce();
  });
});
