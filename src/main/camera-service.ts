import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CameraStorage } from '@shared/camera-types';
import { isAllowedWebUrl } from './web-url';
import { CameraWebRtcSession, type RtcSignal } from './camera-webrtc';

export const CAMERA_ENTITY = /^camera\.[a-z0-9_]+$/;
export interface CameraVault { encrypt(value: string): Buffer; decrypt(value: Buffer): string }
export interface CameraWs {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: any) => void): void;
}
export interface CameraServiceOptions {
  origin: string;
  credentialPath: string;
  vault?: CameraVault;
  fetch?: typeof fetch;
  socket?: (url: string) => CameraWs;
}

/** A single connection credential, shared by every camera, kept out of URLs/IPC state. */
export class CameraService {
  readonly origin: string;
  private token: string | null = null;
  private protection: CameraStorage = 'none';
  private readonly request: typeof fetch;
  private readonly socket: (url: string) => CameraWs;
  constructor(private options: CameraServiceOptions) {
    const url = new URL(options.origin);
    if (!isAllowedWebUrl(options.origin) || url.username || url.password) throw new Error('Home Assistant requires HTTPS or a loopback/LAN address');
    this.origin = url.origin;
    this.request = options.fetch ?? fetch;
    this.socket = options.socket ?? ((address) => new WebSocket(address));
    this.load();
  }
  get connected(): boolean { return !!this.token; }
  get storage(): CameraStorage { return this.protection; }
  private load(): void {
    if (!existsSync(this.options.credentialPath)) return;
    try {
      if (!lstatSync(this.options.credentialPath).isFile()) return;
      chmodSync(this.options.credentialPath, 0o600);
      const saved = JSON.parse(readFileSync(this.options.credentialPath, 'utf8'));
      if (saved.origin !== this.origin || typeof saved.value !== 'string') return;
      const token = saved.encrypted
        ? this.options.vault?.decrypt(Buffer.from(saved.value, 'base64'))
        : saved.value;
      if (typeof token !== 'string' || !token.trim()) return;
      this.token = token;
      this.protection = saved.encrypted ? 'keyring' : 'file-permissions';
    } catch { /* A locked keyring or invalid credential file requires reconnection. */ }
  }
  async connect(value: string): Promise<void> {
    const token = typeof value === 'string' ? value.trim() : '';
    if (!token || token.length > 8192 || /\s/.test(token)) throw new Error('Enter a valid Home Assistant API token');
    const response = await this.authorized('/api/', token);
    if (!response.ok) throw new Error(response.status === 401 ? 'Home Assistant rejected this token' : 'Home Assistant could not validate the connection');
    try {
      const info = await response.json();
      if (info?.message !== 'API running.') throw new Error();
    } catch { throw new Error('The configured address did not return the Home Assistant API'); }
    // Store only after successful validation, without replacing a working token on failure.
    const encrypted = !!this.options.vault;
    let stored: string;
    try { stored = encrypted ? this.options.vault!.encrypt(token).toString('base64') : token; }
    catch { throw new Error('The system keyring could not save the connection'); }
    const folder = dirname(this.options.credentialPath);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const temp = `${this.options.credentialPath}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify({ origin: this.origin, encrypted, value: stored }), { mode: 0o600, flag: 'wx' });
    renameSync(temp, this.options.credentialPath);
    this.token = token;
    this.protection = encrypted ? 'keyring' : 'file-permissions';
  }
  private async authorized(path: string, token = this.token, range?: { start: number; end: number }, timeoutMs = 20_000): Promise<Response> {
    if (!token) throw new Error('Connect Home Assistant to view cameras');
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin || !url.pathname.startsWith('/api/')) throw new Error('Camera media address was rejected');
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (range) headers.Range = `bytes=${range.start}-${range.end - 1}`;
    try { return await this.request(url, { headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
    catch { throw new Error('Home Assistant is unreachable'); }
  }
  async states(): Promise<Map<string, { state: string; name: string }>> {
    const response = await this.authorized('/api/states');
    this.assertResponse(response);
    const values = await response.json();
    if (!Array.isArray(values)) throw new Error('Home Assistant returned invalid camera information');
    return new Map(values.filter(v => CAMERA_ENTITY.test(v.entity_id ?? '')).map(v => [v.entity_id, {
      state: String(v.state ?? 'unknown'), name: String(v.attributes?.friendly_name ?? v.entity_id),
    }]));
  }
  private assertResponse(response: Response): void {
    if (response.status === 401) { this.token = null; throw new Error('Home Assistant connection expired or was revoked. Reconnect to view cameras'); }
    if (!response.ok) throw new Error('Home Assistant could not provide camera media');
  }
  private async command(type: string, entity: string): Promise<any> {
    if (!CAMERA_ENTITY.test(entity)) throw new Error('Invalid camera');
    if (!this.token) throw new Error('Connect Home Assistant to view cameras');
    const token = this.token;
    return new Promise((resolve, reject) => {
      let done = false;
      const socket = this.socket(this.origin.replace(/^http/, 'ws') + '/api/websocket');
      const finish = (error?: Error, result?: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('Camera did not start. Try again')), 30_000);
      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: token }));
          else if (message.type === 'auth_invalid') {
            if (this.token === token) this.token = null;
            finish(new Error('Home Assistant rejected the saved token. Reconnect to view cameras'));
          } else if (message.type === 'auth_ok') socket.send(JSON.stringify({ id: 1, type, entity_id: entity, ...(type === 'camera/stream' ? { format: 'hls' } : {}) }));
          else if (message.type === 'result' && message.id === 1) {
            if (!message.success) return finish(new Error('This camera is offline or its live stream is unavailable'));
            finish(undefined, message.result);
          }
        } catch { finish(new Error('Home Assistant returned invalid stream information')); }
      });
      socket.addEventListener('error', () => finish(new Error('Home Assistant camera connection failed')));
      socket.addEventListener('close', () => { if (!done) finish(new Error('Home Assistant camera connection closed')); });
    });
  }
  /**
   * The camera's latest still image, as served by Home Assistant's camera proxy. `width` asks
   * Home Assistant for a smaller image (it scales where it can; callers still resize).
   */
  async snapshot(entity: string, options: { width?: number; timeoutMs?: number } = {}): Promise<Uint8Array> {
    if (!CAMERA_ENTITY.test(entity)) throw new Error('Invalid camera');
    const width = options.width;
    if (width !== undefined && (!Number.isSafeInteger(width) || width < 16 || width > 4096)) throw new Error('Invalid image width');
    const response = await this.authorized(`/api/camera_proxy/${entity}${width ? `?width=${width}` : ''}`, undefined, undefined, options.timeoutMs);
    this.assertResponse(response);
    if (!/^image\/(jpeg|png)\b/i.test(response.headers.get('content-type') ?? '')) throw new Error('Camera returned an invalid image');
    const limit = 16 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel();
      throw new Error('Camera returned an invalid image');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Camera returned an invalid image');
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) { await reader.cancel(); throw new Error('Camera returned an invalid image'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (!total) throw new Error('Camera returned an invalid image');
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }
  async stream(entity: string): Promise<string> {
    const result = await this.command('camera/stream', entity);
    if (typeof result?.url !== 'string') throw new Error('Home Assistant returned invalid stream information');
    const url = new URL(result.url, this.origin);
    if (url.origin !== this.origin || !url.pathname.startsWith('/api/hls/')) throw new Error('Camera stream address was rejected');
    return url.href;
  }
  async transport(entity: string): Promise<{ kind: 'hls' } | { kind: 'webrtc'; configuration: RTCConfiguration; dataChannel?: string }> {
    const capabilities = await this.command('camera/capabilities', entity);
    const types = capabilities?.frontend_stream_types;
    if (Array.isArray(types) && types.includes('web_rtc') && !types.includes('hls')) {
      const result = await this.command('camera/webrtc/get_client_config', entity);
      if (!result?.configuration || typeof result.configuration !== 'object') throw new Error('Camera WebRTC configuration is unavailable');
      return { kind: 'webrtc', configuration: result.configuration, ...(typeof result.dataChannel === 'string' ? { dataChannel: result.dataChannel } : {}) };
    }
    return { kind: 'hls' };
  }
  webRtc(entity: string, offer: string, signal: (value: RtcSignal) => void): CameraWebRtcSession {
    if (!CAMERA_ENTITY.test(entity) || typeof offer !== 'string' || !offer.startsWith('v=0') || offer.length > 1_000_000) throw new Error('Invalid camera offer');
    if (!this.token) throw new Error('Connect Home Assistant to view cameras');
    const token = this.token;
    return new CameraWebRtcSession(this.socket(this.origin.replace(/^http/, 'ws') + '/api/websocket'), token, entity, offer, signal, () => { if (this.token === token) this.token = null; });
  }
  async media(url: string, range?: { start: number; end: number }): Promise<{ bytes: Uint8Array; playlist: boolean }> {
    const target = new URL(url, this.origin);
    if (target.origin !== this.origin || !target.pathname.startsWith('/api/hls/')) throw new Error('Camera media address was rejected');
    const response = await this.authorized(target.href, undefined, range);
    this.assertResponse(response);
    const length = Number(response.headers.get('content-length'));
    if (length > 32 * 1024 * 1024) throw new Error('Camera media response is too large');
    const chunks: Uint8Array[] = [];
    const reader = response.body?.getReader();
    let total = 0;
    if (!reader) throw new Error('Camera media response is empty');
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 32 * 1024 * 1024) { await reader.cancel(); throw new Error('Camera media response is too large'); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { bytes, playlist: /\.m3u8$/i.test(target.pathname) || /mpegurl/i.test(response.headers.get('content-type') ?? '') };
  }
}

/** Maps playlist/segment addresses to opaque per-window handles, never exposing HA URLs. */
export class CameraMediaSession {
  private resources = new Map<string, string>();
  private reverse = new Map<string, string>();
  constructor(private service: CameraService) {}
  private register(url: string): string {
    const target = new URL(url);
    if (target.origin !== this.service.origin || !target.pathname.startsWith('/api/hls/')) throw new Error('Camera media address was rejected');
    let handle = this.reverse.get(target.href);
    if (!handle) {
      handle = randomUUID();
      this.resources.set(handle, target.href);
      this.reverse.set(target.href, handle);
      // Live cameras can run for days. Bound segment mappings while retaining
      // the small set of playlists HLS reloads repeatedly.
      if (this.resources.size > 512) {
        for (const [oldHandle, oldUrl] of this.resources) {
          if (!/\.m3u8$/i.test(new URL(oldUrl).pathname)) {
            this.resources.delete(oldHandle); this.reverse.delete(oldUrl);
            if (this.resources.size <= 512) break;
          }
        }
      }
    }
    return `https://sofa-camera.invalid/${handle}`;
  }
  async start(entity: string): Promise<string> { return this.register(await this.service.stream(entity)); }
  async load(handle: string, range?: { start: number; end: number }): Promise<Uint8Array> {
    const match = /^([0-9a-f-]{36})(?:\?([^#]{0,256}))?$/.exec(handle);
    if (!match) throw new Error('Invalid camera media handle');
    const saved = this.resources.get(match[1]!);
    if (!saved) throw new Error('Camera media is no longer available');
    const address = new URL(saved);
    const directives = new URLSearchParams(match[2] ?? '');
    const seen = new Set<string>();
    for (const [key, value] of directives) {
      if (seen.has(key) || !(['_HLS_msn', '_HLS_part'].includes(key) ? /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) : key === '_HLS_skip' && ['YES', 'v2'].includes(value))) throw new Error('Invalid camera media directive');
      seen.add(key); address.searchParams.set(key, value);
    }
    const url = address.href;
    if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end <= range.start || range.end - range.start > 32 * 1024 * 1024)) throw new Error('Invalid camera media range');
    const { bytes, playlist } = await this.service.media(url, range);
    if (!playlist) return bytes;
    const text = new TextDecoder().decode(bytes);
    if (!text.startsWith('#EXTM3U')) throw new Error('Camera returned an invalid playlist');
    const rewrite = (value: string) => this.register(new URL(value, url).href);
    // Rewrite both bare segment/playlist lines and URI attributes (maps, keys, audio).
    const sanitized = text.split(/\r?\n/).map(line => line.startsWith('#')
      ? line.replace(/URI="([^"]+)"/g, (_match, value: string) => `URI="${rewrite(value)}"`)
      : line.trim() ? rewrite(line.trim()) : line).join('\n');
    return new TextEncoder().encode(sanitized);
  }
  clear(): void { this.resources.clear(); this.reverse.clear(); }
}
