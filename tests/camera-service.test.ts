import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CameraMediaSession, CameraService, type CameraWs } from '../src/main/camera-service';

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); vi.useRealTimers(); });
const token = 'test-only-camera-access-token';
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'sofa-camera-test-')); folders.push(folder);
  const credentialPath = join(folder, 'private', 'connection.json');
  const request = vi.fn<typeof fetch>(async () => Response.json({ message: 'API running.' }));
  return { credentialPath, request, options: { origin: 'https://ha.example', credentialPath, fetch: request } };
}
class Socket implements CameraWs {
  listeners = new Map<string, ((event: any) => void)[]>();
  sent: any[] = [];
  authError = false;
  streamError = false;
  url = '/api/hls/private-stream-id/playlist.m3u8';
  close = vi.fn();
  addEventListener(type: string, listener: (event: any) => void) {
    this.listeners.set(type, [...this.listeners.get(type) ?? [], listener]);
    if (type === 'message') queueMicrotask(() => this.emit({ type: 'auth_required' }));
  }
  emit(message: unknown) { for (const listener of this.listeners.get('message') ?? []) listener({ data: JSON.stringify(message) }); }
  send(text: string) {
    const message = JSON.parse(text); this.sent.push(message);
    queueMicrotask(() => this.emit(message.type === 'auth'
      ? { type: this.authError ? 'auth_invalid' : 'auth_ok' }
      : { type: 'result', id: 1, success: !this.streamError, result: { url: this.url } }));
  }
}

describe('shared Home Assistant camera connection', () => {
  it.each([['http://homeassistant.local:8123', 'ws://homeassistant.local:8123'], ['http://192.168.1.50:8123', 'ws://192.168.1.50:8123'], ['https://ha.example', 'wss://ha.example']])('uses the correct WebSocket scheme for %s', async (origin, websocket) => {
    const f = fixture();
    const addresses: string[] = [];
    const service = new CameraService({ ...f.options, origin, socket: (url) => { addresses.push(url); return new Socket(); } });
    await service.connect(token);
    await expect(service.stream('camera.front')).resolves.toBe(origin + '/api/hls/private-stream-id/playlist.m3u8');
    const rtc = service.webRtc('camera.front', 'v=0\r\n', () => {});
    rtc.close();
    expect(addresses).toEqual([websocket + '/api/websocket', websocket + '/api/websocket']);
  });
  it.each(['http://3232235777', 'http://0xC0A80101', 'http://0300.0250.1.1', 'http://user@192.168.1.50', 'http://HOMEASSISTANT.local'])('rejects original URL normalization tricks: %s', (origin) => {
    expect(() => new CameraService({ ...fixture().options, origin })).toThrow();
  });
  it('stores a validated connection in a private file and reloads it for all cameras', async () => {
    const f = fixture(); const service = new CameraService(f.options);
    expect(service.connected).toBe(false);
    await service.connect(token);
    expect(statSync(f.credentialPath).mode & 0o777).toBe(0o600);
    expect(service.storage).toBe('file-permissions');
    expect(new CameraService(f.options).connected).toBe(true);
    expect(f.request.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: `Bearer ${token}` });
    expect(f.request.mock.calls[0]?.[1]?.redirect).toBe('error');
  });
  it('uses encryption when supplied and does not silently read encrypted data without a keyring', async () => {
    const f = fixture();
    const vault = { encrypt: (text: string) => Buffer.from(text.split('').reverse().join('')), decrypt: (bytes: Buffer) => bytes.toString().split('').reverse().join('') };
    const service = new CameraService({ ...f.options, vault }); await service.connect(token);
    expect(readFileSync(f.credentialPath, 'utf8')).not.toContain(token);
    expect(new CameraService({ ...f.options, vault }).storage).toBe('keyring');
    expect(new CameraService(f.options).connected).toBe(false);
  });
  it('keeps an existing validated connection after a rejected replacement token', async () => {
    const f = fixture(); const service = new CameraService(f.options); await service.connect(token);
    const before = readFileSync(f.credentialPath, 'utf8');
    f.request.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(service.connect('wrong-test-token')).rejects.toThrow('rejected');
    expect(service.connected).toBe(true);
    expect(readFileSync(f.credentialPath, 'utf8')).toBe(before);
  });
  it('reports revoked connections without returning the token or unsanitized attributes', async () => {
    const f = fixture(); const service = new CameraService(f.options); await service.connect(token);
    f.request.mockResolvedValueOnce(Response.json([{ entity_id: 'camera.front', state: 'idle', attributes: { friendly_name: 'Front', access_token: 'never-forward-this' } }, { entity_id: 'light.kitchen', state: 'on' }]));
    expect([...await service.states()]).toEqual([['camera.front', { state: 'idle', name: 'Front' }]]);
    f.request.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(service.states()).rejects.toThrow('revoked');
    expect(service.connected).toBe(false);
  });
  it('fetches a still only for a valid camera, with the token in a header and an image content type', async () => {
    const f = fixture(); const service = new CameraService(f.options); await service.connect(token);
    f.request.mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } }));
    expect([...await service.snapshot('camera.front')]).toEqual([0xff, 0xd8, 0xff]);
    const [url, init] = f.request.mock.calls.at(-1)!;
    expect(String(url)).toBe('https://ha.example/api/camera_proxy/camera.front');
    expect(String(url)).not.toContain(token);
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect((init as RequestInit).headers).toEqual({ Authorization: `Bearer ${token}` });
    f.request.mockResolvedValueOnce(new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    await expect(service.snapshot('camera.front')).rejects.toThrow('invalid image');
    await expect(service.snapshot('camera.front/../../states')).rejects.toThrow('Invalid camera');
  });
  it('caps snapshot downloads while streaming, even with a missing or false length', async () => {
    for (const length of [undefined, '1', String(17 * 1024 * 1024)]) {
      const f = fixture(); const service = new CameraService(f.options); await service.connect(token);
      const cancel = vi.fn(); let reads = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel,
      }, { highWaterMark: 0 });
      f.request.mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'image/jpeg', ...(length ? { 'content-length': length } : {}) } }));
      await expect(service.snapshot('camera.front')).rejects.toThrow('invalid image');
      expect(cancel).toHaveBeenCalledOnce();
      expect(reads).toBe(Number(length) > 16 * 1024 * 1024 ? 0 : 17);
    }
  });
  it('negotiates camera/stream through authenticated websocket and closes after the result', async () => {
    const f = fixture(); const socket = new Socket();
    const service = new CameraService({ ...f.options, socket: () => socket }); await service.connect(token);
    await expect(service.stream('camera.front')).resolves.toBe('https://ha.example/api/hls/private-stream-id/playlist.m3u8');
    expect(socket.sent).toEqual([{ type: 'auth', access_token: token }, { id: 1, type: 'camera/stream', entity_id: 'camera.front', format: 'hls' }]);
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it('selects native WebRTC for Ring-style feeds and HLS for RTSP feeds', async () => {
    const f = fixture(); let native = true;
    class CapabilitySocket extends Socket {
      override send(text: string) {
        const message = JSON.parse(text); this.sent.push(message);
        queueMicrotask(() => this.emit(message.type === 'auth' ? { type: 'auth_ok' } : {
          type: 'result', id: 1, success: true,
          result: message.type === 'camera/capabilities' ? { frontend_stream_types: native ? ['web_rtc'] : ['hls', 'web_rtc'] } : { configuration: { iceServers: [] }, dataChannel: 'fixture-channel' },
        }));
      }
    }
    const service = new CameraService({ ...f.options, socket: () => new CapabilitySocket() }); await service.connect(token);
    await expect(service.transport('camera.ring')).resolves.toEqual({ kind: 'webrtc', configuration: { iceServers: [] }, dataChannel: 'fixture-channel' });
    native = false;
    await expect(service.transport('camera.rtsp')).resolves.toEqual({ kind: 'hls' });
  });
  it('rejects revoked websocket auth, service errors and foreign stream origins', async () => {
    for (const failure of ['auth', 'stream', 'origin']) {
      const f = fixture(); const socket = new Socket();
      socket.authError = failure === 'auth'; socket.streamError = failure === 'stream';
      if (failure === 'origin') socket.url = 'https://elsewhere.example/api/hls/x/playlist.m3u8';
      const service = new CameraService({ ...f.options, socket: () => socket }); await service.connect(token);
      await expect(service.stream('camera.front')).rejects.toThrow();
      expect(socket.close).toHaveBeenCalledOnce();
      if (failure === 'auth') expect(service.connected).toBe(false);
    }
  });
  it('does not hang indefinitely if a camera never responds', async () => {
    vi.useFakeTimers();
    const f = fixture(); const socket = new Socket(); socket.send = () => undefined;
    const service = new CameraService({ ...f.options, socket: () => socket }); await service.connect(token);
    const pending = expect(service.stream('camera.front')).rejects.toThrow('did not start');
    await vi.advanceTimersByTimeAsync(30_000); await pending;
    expect(socket.close).toHaveBeenCalledOnce();
  });
  it('rejects remote plaintext, invalid entity IDs and media outside the camera API', async () => {
    const f = fixture();
    expect(() => new CameraService({ ...f.options, origin: 'http://remote.example' })).toThrow();
    const service = new CameraService(f.options); await service.connect(token);
    await expect(service.stream('light.kitchen')).rejects.toThrow('Invalid camera');
    await expect(service.media('https://elsewhere.example/api/hls/x')).rejects.toThrow('rejected');
    await expect(service.media('https://ha.example/api/states')).rejects.toThrow('rejected');
  });
});

describe('per-window camera media handles', () => {
  function mediaFixture() {
    const media = vi.fn(async () => ({ bytes: new TextEncoder().encode('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\nsegment.m4s\n'), playlist: true }));
    const service = { origin: 'https://ha.example', stream: vi.fn(async () => 'https://ha.example/api/hls/secret-session/playlist.m3u8'), media } as unknown as CameraService;
    return { service, media, session: new CameraMediaSession(service) };
  }
  it('rewrites playlists and fragments without exposing Home Assistant stream paths', async () => {
    const f = mediaFixture(); const url = await f.session.start('camera.front');
    const handle = new URL(url).pathname.slice(1);
    const manifest = new TextDecoder().decode(await f.session.load(handle));
    expect(manifest).not.toContain('secret-session');
    expect(manifest).not.toContain('ha.example');
    expect(manifest.match(/https:\/\/sofa-camera.invalid\/[0-9a-f-]{36}/g)).toHaveLength(2);
    const second = new CameraMediaSession(f.service);
    await expect(second.load(handle)).rejects.toThrow('no longer available');
    f.session.clear();
    await expect(f.session.load(handle)).rejects.toThrow('no longer available');
  });
  it('permits only validated LL-HLS delivery directives on a known handle', async () => {
    const f = mediaFixture(); const handle = new URL(await f.session.start('camera.front')).pathname.slice(1);
    await f.session.load(handle + '?_HLS_msn=42&_HLS_part=2&_HLS_skip=v2');
    expect(f.media).toHaveBeenCalledWith('https://ha.example/api/hls/secret-session/playlist.m3u8?_HLS_msn=42&_HLS_part=2&_HLS_skip=v2', undefined);
    for (const query of ['?token=secret', '?_HLS_msn=-1', '?_HLS_skip=arbitrary', '?_HLS_part=2&_HLS_part=3']) await expect(f.session.load(handle + query)).rejects.toThrow('directive');
  });
  it('rejects an external URI in a playlist and invalid ranges before fetching media', async () => {
    const f = mediaFixture(); const handle = new URL(await f.session.start('camera.front')).pathname.slice(1);
    await expect(f.session.load(handle, { start: -1, end: 10 })).rejects.toThrow('range');
    expect(f.media).not.toHaveBeenCalled();
    f.media.mockResolvedValueOnce({ bytes: new TextEncoder().encode('#EXTM3U\nhttps://evil.example/exfiltrate\n'), playlist: true });
    await expect(f.session.load(handle)).rejects.toThrow('rejected');
  });
});
