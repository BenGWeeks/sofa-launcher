import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  let nextId = 100;
  class Window extends EventEmitter {
    static created: Window[] = [];
    destroyed = false;
    id = nextId++;
    webContents = Object.assign(new EventEmitter(), { mainFrame: { url: '' }, send: vi.fn(), setWindowOpenHandler: vi.fn(), setWebRTCIPHandlingPolicy: vi.fn() });
    constructor(readonly options: unknown) { super(); Window.created.push(this); }
    isDestroyed() { return this.destroyed; }
    getNativeWindowHandle() { const value = Buffer.alloc(4); value.writeUInt32LE(this.id); return value; }
    async loadFile(file: string, options: { hash: string }) { this.webContents.mainFrame.url = pathToFileURL(file).href + '#' + options.hash; }
    async loadURL(url: string) { this.webContents.mainFrame.url = url; }
    show = vi.fn();
    hide = vi.fn();
    setTitle = vi.fn();
    setFocusable = vi.fn();
    setFullScreen = vi.fn();
    setBounds = vi.fn();
    setAlwaysOnTop = vi.fn();
    showInactive = vi.fn();
    moveTop = vi.fn();
    close() { this.destroyed = true; this.emit('closed'); }
    destroy() { this.close(); }
  }
  const handlers = new Map();
  return {
    BrowserWindow: Window,
    nativeImage: { createFromBuffer: (bytes: Buffer) => ({ isEmpty: () => !bytes.length, toJPEG: () => bytes }) },
    safeStorage: { isEncryptionAvailable: () => false },
    ipcMain: { handle: (name: string, callback: unknown) => handlers.set(name, callback), removeHandler: (name: string) => handlers.delete(name), handlers },
  };
});
import { BrowserWindow, ipcMain } from 'electron';
import { pinCamera } from '../src/main/pinned-camera';
import { CameraInputs } from '../src/main/camera-inputs';
const folders: string[] = [];
const services: CameraInputs[] = [];
afterEach(() => { for (const service of services.splice(0)) service.dispose(); for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const folder = mkdtempSync(join(tmpdir(), 'sofa-camera-window-')); folders.push(folder);
  const inputs = new CameraInputs({ origin: 'https://ha.example', credentialPath: join(folder, 'token.json'), rendererHtml: '/bundle/index.html', preloadPath: '/bundle/camera.js', setClass: vi.fn(async () => undefined) });
  services.push(inputs);
  inputs.setInputs([
    { id: 'camera-front', name: 'Front', entity: 'camera.front', wmClass: 'sofa-camera-front' },
    { id: 'camera-barn', name: 'Barn', entity: 'camera.barn', wmClass: 'sofa-camera-barn' },
    { id: 'all-cameras', name: 'All cameras', entity: 'all', wmClass: 'sofa-all-cameras' },
  ]);
  return inputs;
}
const windows = () => (BrowserWindow as unknown as { created: { id: number; options: any; webContents: any; setTitle: ReturnType<typeof vi.fn>; emit(event: string, ...args: any[]): boolean; isDestroyed(): boolean }[] }).created;
const handlers = () => (ipcMain as unknown as { handlers: Map<string, (...args: any[]) => any> }).handlers;

describe('managed camera windows', () => {
  it('pins only its own viewer above fullscreen without taking focus', async () => {
    const inputs = fixture(); const id = await inputs.open('camera-front');
    const window = windows().find(value => String(value.id) === id)! as any;
    inputs.pin('camera-front', { x: 30, y: 40, width: 400, height: 225 });
    expect(window.setFocusable).toHaveBeenCalledWith(false);
    expect(window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    expect(window.setFullScreen).toHaveBeenCalledWith(false);
    expect(window.setBounds).toHaveBeenCalledWith({ x: 30, y: 40, width: 400, height: 225 });
    expect(window.showInactive).toHaveBeenCalledOnce();
  });
  it('hides pinned cameras during overlapping Sofa overlays and restores without focus or pause', async () => {
    const inputs = fixture(); const id = await inputs.open('camera-front');
    const window = windows().find(value => String(value.id) === id)! as any;
    inputs.suppressPinned(true); // An overlay can already be open when pinning starts.
    inputs.pin('camera-front', { x: 10, y: 20, width: 320, height: 180 });
    expect(window.hide).toHaveBeenCalledOnce();
    expect(window.showInactive).not.toHaveBeenCalled();
    inputs.raise('camera-front');
    expect(window.showInactive).not.toHaveBeenCalled();
    inputs.suppressPinned(false);
    expect(window.showInactive).toHaveBeenCalledOnce();
    expect(window.webContents.send).not.toHaveBeenCalledWith('camera:pause');
    expect(window.setFocusable).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('prepares X11 while mapped before pinning hides the viewer under an open overlay', async () => {
    const inputs = fixture(); const id = await inputs.open('camera-front');
    const window = windows().find(value => String(value.id) === id)! as any;
    inputs.suppressPinned(true);
    const bounds = { x: 10, y: 20, width: 320, height: 180 };
    let finish!: () => void;
    const x11 = {
      preparePinned: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })),
      keepAbove: vi.fn(async () => { expect(window.hide).not.toHaveBeenCalled(); }),
    };
    const screen = { screenToDipPoint: (point: { x: number; y: number }) => point, getDisplayNearestPoint: () => ({ scaleFactor: 1 }) };
    const pinning = pinCamera(inputs, x11, screen, { appId: 'camera-front', name: 'Front', windowId: id }, bounds);
    expect(window.show).toHaveBeenCalledOnce();
    expect(window.hide).not.toHaveBeenCalled();
    expect(window.setFullScreen).toHaveBeenCalledWith(false);
    expect(x11.keepAbove).not.toHaveBeenCalled();
    finish(); await pinning;
    expect(x11.preparePinned).toHaveBeenCalledExactlyOnceWith(id, bounds);
    expect(window.hide).toHaveBeenCalledOnce();
    expect(window.showInactive).not.toHaveBeenCalled();
    inputs.suppressPinned(false);
    expect(window.showInactive).toHaveBeenCalledOnce();
    expect(window.setBounds).toHaveBeenCalledExactlyOnceWith(bounds);
    expect(window.setFocusable).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('returns only JPEG data over owner-checked snapshot IPC and tolerates failure', async () => {
    const inputs = fixture(); const id = await inputs.open('camera-front');
    const window = windows().find(value => String(value.id) === id)!;
    const snapshot = handlers().get('camera:snapshot')!;
    const owner = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    const request = vi.spyOn(inputs.service, 'snapshot').mockResolvedValue(new Uint8Array([255, 216, 255]));
    expect(await snapshot(owner, 0)).toBe('data:image/jpeg;base64,/9j/');
    expect(request).toHaveBeenCalledExactlyOnceWith('camera.front');
    await expect(snapshot(owner, 1)).rejects.toThrow('Unknown camera');
    await expect(snapshot(owner, '../token')).rejects.toThrow('Invalid camera');
    await expect(snapshot({ ...owner, senderFrame: { url: 'https://evil.example' } }, 0)).rejects.toThrow('Untrusted');
    request.mockRejectedValueOnce(new Error('network failure'));
    expect(await snapshot(owner, 0)).toBeNull();
  });
  it('keeps camera audio separate even though both windows belong to Electron', async () => {
    const inputs = fixture();
    const front = await inputs.open('camera-front'); const barn = await inputs.open('camera-barn');
    expect(await inputs.audio('camera-front', 'mute')).toEqual({ available: true, volume: 100, muted: false });
    expect(await inputs.audio('camera-front', 'down')).toEqual({ available: true, volume: 95, muted: false });
    expect(await inputs.audio('camera-barn', 'get')).toEqual({ available: true, volume: 100, muted: true });
    const frontWindow = windows().find(value => String(value.id) === front)!;
    const barnWindow = windows().find(value => String(value.id) === barn)!;
    expect(frontWindow.webContents.send).toHaveBeenLastCalledWith('camera:audio', { volume: 95, muted: false });
    expect(barnWindow.webContents.send).toHaveBeenCalledExactlyOnceWith('camera:audio', { volume: 100, muted: true });
  });
  it('closes only the requested camera and resumes an already open viewer', async () => {
    const inputs = fixture();
    const front = await inputs.open('camera-front'); const barn = await inputs.open('camera-barn');
    inputs.pause('camera-front');
    expect(await inputs.open('camera-front')).toBe(front);
    expect(windows().find(value => String(value.id) === front)!.webContents.send).toHaveBeenLastCalledWith('camera:resume');
    expect(inputs.close('camera-front')).toBe(true);
    expect(inputs.windowsFor('camera-front')).toEqual([]);
    expect(inputs.windowsFor('camera-barn')).toEqual([barn]);
    expect(await inputs.audio('camera-front', 'mute')).toEqual({ available: false, volume: 0, muted: true });
  });
  it('locks the native camera title and restricts ICE gathering to the default LAN route', async () => {
    const inputs = fixture(); const id = await inputs.open('camera-front');
    const window = windows().find(value => String(value.id) === id)!;
    expect(window.setTitle).toHaveBeenLastCalledWith('Front');
    expect(window.webContents.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith('default_public_and_private_interfaces');
    const event = { preventDefault: vi.fn() };
    window.emit('page-title-updated', event, 'Sofa Launcher');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    const candidate = handlers().get('camera:rtc-candidate')!;
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    // A stopped peer may still have ICE callbacks queued in Chromium.
    expect(() => candidate(sender, '01020304-0506-0708-090a-0b0c0d0e0f10', { candidate: 'late' })).not.toThrow();
    expect(() => candidate(sender, 'invalid-id', { candidate: 'late' })).toThrow('Invalid camera');
  });
  it('accepts IPC only from its own bundled top frame', async () => {
    const inputs = fixture(); const id = await inputs.open('camera-front');
    const window = windows().find(value => String(value.id) === id)!;
    const state = handlers().get('camera:state')!;
    expect(await state({ sender: window.webContents, senderFrame: window.webContents.mainFrame })).toMatchObject({ name: 'Front', connected: false, cameras: [], audio: { volume: 100, muted: true } });
    expect(() => state({ sender: window.webContents, senderFrame: { url: 'https://evil.example/' } })).toThrow('Untrusted');
    expect(() => state({ sender: {}, senderFrame: window.webContents.mainFrame })).toThrow('Untrusted');
    const start = handlers().get('camera:start')!;
    await expect(start({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, 999)).rejects.toThrow('Unknown camera');
    expect(window.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
  });
});
