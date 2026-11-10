import { BrowserWindow, ipcMain, nativeImage, safeStorage, type IpcMainInvokeEvent } from 'electron';
import { pathToFileURL } from 'node:url';
import type { CameraDefinition, CameraViewState } from '@shared/camera-types';
import { CAMERA_ENTITY, CameraMediaSession, CameraService } from './camera-service';
import type { CameraWebRtcSession } from './camera-webrtc';

export interface CameraInputsOptions {
  origin: string;
  credentialPath: string;
  rendererHtml: string;
  preloadPath: string;
  rendererUrl?: string;
  setClass(id: string, wmClass: string): Promise<void>;
}
interface CameraWindow { definition: CameraDefinition; window: BrowserWindow; media: CameraMediaSession; audio: { volume: number; muted: boolean }; rtc: Map<string, CameraWebRtcSession> }
/** Home-screen camera tiles show stills about this wide. */
export const TILE_STILL_WIDTH = 480;
const CHANNELS = ['camera:snapshot', 'camera:state', 'camera:connect', 'camera:start', 'camera:media', 'camera:rtc-offer', 'camera:rtc-candidate', 'camera:rtc-stop'] as const;

/** Camera windows are managed individually; never terminate the shared Electron process. */
export class CameraInputs {
  private pinned = new Set<string>();
  private suppressed = false;
  private definitions: CameraDefinition[] = [];
  private windows = new Map<string, CameraWindow>();
  readonly service: CameraService;
  constructor(private options: CameraInputsOptions) {
    const encrypted = safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== 'basic_text';
    this.service = new CameraService({
      origin: options.origin, credentialPath: options.credentialPath,
      vault: encrypted ? { encrypt: value => safeStorage.encryptString(value), decrypt: value => safeStorage.decryptString(value) } : undefined,
    });
    this.installIpc();
  }
  setInputs(definitions: CameraDefinition[]): void {
    for (const definition of definitions) {
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(definition.id) || !/^[A-Za-z0-9._-]+$/.test(definition.wmClass) || (definition.entity !== 'all' && !CAMERA_ENTITY.test(definition.entity))) throw new Error('Invalid camera input configuration');
    }
    this.definitions = definitions.map(value => ({ ...value }));
  }
  windowsFor(appId: string): string[] {
    const entry = this.windows.get(appId);
    return entry && !entry.window.isDestroyed() ? [this.id(entry.window)] : [];
  }
  private id(window: BrowserWindow): string { return String(window.getNativeWindowHandle().readUInt32LE(0)); }
  async open(appId: string): Promise<string> {
    const existing = this.windows.get(appId);
    if (existing && !existing.window.isDestroyed()) { existing.window.setTitle(existing.definition.name); existing.window.show(); existing.window.webContents.send('camera:resume'); return this.id(existing.window); }
    const definition = this.definitions.find(value => value.id === appId);
    if (!definition) throw new Error('Unknown camera input');
    const window = new BrowserWindow({
      width: 1280, height: 720, show: false, frame: false, fullscreen: true,
      title: definition.name, backgroundColor: '#07090d', autoHideMenuBar: true,
      webPreferences: { preload: this.options.preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    const entry = { definition, window, media: new CameraMediaSession(this.service), audio: { volume: 100, muted: true }, rtc: new Map<string, CameraWebRtcSession>() };
    this.windows.set(appId, entry);
    // Keep Docker/veth interfaces out of camera ICE gathering while preserving
    // the default LAN route. This policy is local to this camera webContents.
    window.webContents.setWebRTCIPHandlingPolicy('default_public_and_private_interfaces');
    window.on('page-title-updated', event => event.preventDefault());
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.on('closed', () => { entry.media.clear(); for (const connection of entry.rtc.values()) connection.close(); entry.rtc.clear(); if (this.windows.get(appId) === entry) this.windows.delete(appId); });
    try {
      if (this.options.rendererUrl) await window.loadURL(`${this.options.rendererUrl}#camera`);
      else await window.loadFile(this.options.rendererHtml, { hash: 'camera' });
      window.setTitle(definition.name);
      await this.options.setClass(this.id(window), definition.wmClass);
      window.show();
      return this.id(window);
    } catch {
      if (!window.isDestroyed()) window.destroy();
      throw new Error('Camera window could not open');
    }
  }
  close(appId: string): boolean {
    const entry = this.windows.get(appId);
    if (!entry || entry.window.isDestroyed()) return false;
    this.pinned.delete(appId);
    entry.window.close();
    return true;
  }
  pin(appId: string, bounds: import('./pip').Bounds, deferVisibility = false): void {
    const entry = this.windows.get(appId);
    if (!entry || entry.window.isDestroyed()) throw new Error('Camera viewer closed');
    this.pinned.add(appId);
    entry.window.setFocusable(false);
    entry.window.setFullScreen(false);
    entry.window.setBounds(bounds);
    // Leave the mapped viewer in place until X11 has finished preparing it.
    if (!deferVisibility) this.raise(appId);
  }
  raise(appId: string): void {
    const entry = this.windows.get(appId);
    if (!entry || entry.window.isDestroyed()) return;
    if (this.pinned.has(appId) && this.suppressed) { entry.window.hide(); return; }
    entry.window.setAlwaysOnTop(true, 'screen-saver');
    entry.window.showInactive();
    entry.window.moveTop();
  }
  /** Suppression never pauses playback, changes geometry, or takes focus on restore. */
  suppressPinned(suppressed: boolean): void {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    for (const id of this.pinned) this.raise(id);
  }
  pause(appId: string): void {
    const entry = this.windows.get(appId);
    if (entry && !entry.window.isDestroyed()) entry.window.webContents.send('camera:pause');
  }
  async audio(appId: string, action: 'get' | 'up' | 'down' | 'mute'): Promise<{ available: boolean; volume: number; muted: boolean }> {
    const entry = this.windows.get(appId);
    if (!entry || entry.window.isDestroyed()) return { available: false, volume: 0, muted: true };
    if (action === 'up' || action === 'down') entry.audio.volume = Math.max(0, Math.min(100, entry.audio.volume + (action === 'up' ? 5 : -5)));
    else if (action === 'mute') entry.audio.muted = !entry.audio.muted;
    else if (action !== 'get') throw new Error('Unknown camera audio control');
    entry.window.webContents.send('camera:audio', { ...entry.audio });
    return { available: true, ...entry.audio };
  }
  private thumbnails = new Map<string, { at: number; value: Promise<string | null> }>();
  /** A small recent still for one camera input as a data URL; null when there is none to show. */
  thumbnail(appId: string): Promise<string | null> {
    const definition = this.definitions.find(value => value.id === appId);
    if (!definition || definition.entity === 'all' || !this.service.connected) return Promise.resolve(null);
    const cached = this.thumbnails.get(appId);
    if (cached && Date.now() - cached.at < 30_000) return cached.value;
    const value = this.service.snapshot(definition.entity).then(bytes => {
      const image = nativeImage.createFromBuffer(Buffer.from(bytes));
      if (image.isEmpty()) return null;
      return `data:image/jpeg;base64,${image.resize({ width: 320, quality: 'good' }).toJPEG(72).toString('base64')}`;
    }).catch(() => null);
    this.thumbnails.set(appId, { at: Date.now(), value });
    return value;
  }
  /** Camera tiles that can have a still now: none until Home Assistant is connected. */
  stillIds(): string[] {
    return this.service.connected ? this.definitions.filter(value => value.entity !== 'all').map(value => value.id) : [];
  }
  /**
   * A home-screen tile's still: a ~480 px wide JPEG data URL. Asks Home Assistant for that width
   * and resizes here too (not every camera can scale). Rejects when there is no image.
   */
  async tileStill(appId: string, timeoutMs = 8_000): Promise<string> {
    const definition = this.definitions.find(value => value.id === appId);
    if (!definition || definition.entity === 'all') throw new Error('Unknown camera');
    const bytes = await this.service.snapshot(definition.entity, { width: TILE_STILL_WIDTH, timeoutMs });
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (image.isEmpty()) throw new Error('Camera returned an invalid image');
    const small = image.getSize().width > TILE_STILL_WIDTH ? image.resize({ width: TILE_STILL_WIDTH, quality: 'good' }) : image;
    return `data:image/jpeg;base64,${small.toJPEG(75).toString('base64')}`;
  }
  dispose(): void {
    for (const channel of CHANNELS) ipcMain.removeHandler(channel);
    for (const entry of this.windows.values()) if (!entry.window.isDestroyed()) entry.window.destroy();
    this.windows.clear();
  }
  private owner(event: IpcMainInvokeEvent): CameraWindow {
    const entry = [...this.windows.values()].find(value => !value.window.isDestroyed() && value.window.webContents === event.sender);
    const expected = this.options.rendererUrl ?? pathToFileURL(this.options.rendererHtml).href;
    const actual = event.senderFrame?.url.split('#')[0];
    if (!entry || event.senderFrame !== event.sender.mainFrame || actual !== expected) throw new Error('Untrusted camera request');
    return entry;
  }
  private entities(entry: CameraWindow): CameraDefinition[] {
    return entry.definition.entity === 'all'
      ? this.definitions.filter(value => value.entity !== 'all')
      : [entry.definition];
  }
  private async state(entry: CameraWindow): Promise<CameraViewState> {
    const result: CameraViewState = { name: entry.definition.name, connected: this.service.connected, storage: this.service.storage, audio: { ...entry.audio }, cameras: [] };
    const definitions = this.entities(entry);
    if (!this.service.connected) return result;
    try {
      const states = await this.service.states();
      result.cameras = definitions.map(value => ({ name: value.name, entity: value.entity, state: states.get(value.entity)?.state ?? 'unavailable' }));
    } catch (error) {
      result.connected = this.service.connected;
      result.error = error instanceof Error ? error.message : 'Home Assistant could not load cameras';
      result.cameras = definitions.map(value => ({ name: value.name, entity: value.entity, state: 'unavailable' }));
    }
    return result;
  }
  private installIpc(): void {
    ipcMain.handle('camera:snapshot', async (event, index: unknown) => {
      const owner = this.owner(event);
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) throw new Error('Invalid camera selection');
      const definition = this.entities(owner)[index];
      if (!definition) throw new Error('Unknown camera selection');
      try {
        const bytes = await this.service.snapshot(definition.entity);
        const image = nativeImage.createFromBuffer(Buffer.from(bytes));
        return image.isEmpty() ? null : `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`;
      } catch { return null; }
    });
    ipcMain.handle('camera:state', event => this.state(this.owner(event)));
    ipcMain.handle('camera:connect', async (event, token: unknown) => {
      const owner = this.owner(event);
      if (typeof token !== 'string') throw new Error('Invalid connection token');
      await this.service.connect(token);
      for (const entry of this.windows.values()) {
        entry.media.clear();
        for (const connection of entry.rtc.values()) connection.close(); entry.rtc.clear();
        if (entry !== owner && !entry.window.isDestroyed()) entry.window.webContents.send('camera:resume');
      }
      return this.state(owner);
    });
    ipcMain.handle('camera:start', async (event, index: unknown) => {
      const owner = this.owner(event);
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) throw new Error('Invalid camera selection');
      const definition = this.entities(owner)[index];
      if (!definition) throw new Error('Unknown camera selection');
      const transport = await this.service.transport(definition.entity);
      return transport.kind === 'hls' ? { kind: 'hls', source: await owner.media.start(definition.entity) } : transport;
    });
    ipcMain.handle('camera:rtc-offer', (event, index: unknown, id: unknown, offer: unknown) => {
      const owner = this.owner(event);
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id) || typeof offer !== 'string') throw new Error('Invalid camera negotiation');
      const definition = this.entities(owner)[index];
      if (!definition || owner.rtc.has(id) || owner.rtc.size >= 64) throw new Error('Invalid camera negotiation');
      const connection = this.service.webRtc(definition.entity, offer, signal => {
        if (!owner.window.isDestroyed()) owner.window.webContents.send('camera:rtc', { id, ...signal });
      });
      owner.rtc.set(id, connection);
    });
    ipcMain.handle('camera:rtc-candidate', (event, id: unknown, candidate: unknown) => {
      const owner = this.owner(event);
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid camera negotiation');
      // ICE callbacks can already be in flight when a peer stops or fails.
      // A valid late session handle is a harmless no-op, not an IPC error.
      owner.rtc.get(id)?.candidate(candidate as RTCIceCandidateInit);
    });
    ipcMain.handle('camera:rtc-stop', (event, id: unknown) => {
      const owner = this.owner(event);
      if (typeof id !== 'string') throw new Error('Invalid camera negotiation');
      owner.rtc.get(id)?.close(); owner.rtc.delete(id);
    });
    ipcMain.handle('camera:media', (event, handle: unknown, range: unknown) => {
      const owner = this.owner(event);
      if (typeof handle !== 'string') throw new Error('Invalid camera media handle');
      if (range !== undefined && (!range || typeof range !== 'object' || !('start' in range) || !('end' in range) || typeof range.start !== 'number' || typeof range.end !== 'number')) throw new Error('Invalid camera media range');
      return owner.media.load(handle, range as { start: number; end: number } | undefined);
    });
  }
}
