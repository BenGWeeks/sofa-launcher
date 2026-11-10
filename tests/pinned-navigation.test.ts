import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute the real main-process functions with ports stubbed, without booting Electron.
function mainFunction(name: string, ports: Record<string, unknown>) {
  const source = ts.createSourceFile('index.ts', readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
  const js = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(ports), `${js}; return ${name};`)(...Object.values(ports));
}
function fixture() {
  const target = { id: 'edge', name: 'Edge', wmClass: 'sofa-edge' };
  const pip = { pinned: true, state: { active: true, pinned: true, insetId: 'camera', baseId: 'base' }, opening: vi.fn(async () => {}), opened: vi.fn(async () => {}) };
  const apps = { get: vi.fn(() => target), open: vi.fn(async () => ({ ok: true })), pause: vi.fn(async () => {}) };
  const wm = { findByClass: vi.fn(async () => ['42']) };
  const requiresFullscreen = vi.fn(() => false);
  const coverLaunch = vi.fn(async (open: () => Promise<unknown>, lookup: () => Promise<string[]>, fullscreen: boolean) => { await lookup(); expect(fullscreen).toBe(false); return open(); });
  const open = mainFunction('openApp', { pip, apps, wm, requiresFullscreen, launchCoverTimeout: () => 8000, coverLaunch, launcherInFront: () => false, DEMO: false });
  return { open, pip, apps, wm, target, requiresFullscreen, coverLaunch };
}
describe('main pinned navigation', () => {
  it('gives feedback for the pinned camera tile without reopening or changing the base', async () => {
    const f = fixture();
    expect(await f.open('camera')).toEqual({ ok: true, message: 'Already pinned' });
    expect(f.apps.open).not.toHaveBeenCalled();
    expect(f.pip.opened).not.toHaveBeenCalled();
  });
  it('keeps a successful open successful when the post-open window lookup fails', async () => {
    const f = fixture(); f.wm.findByClass.mockRejectedValueOnce(new Error('xdotool unavailable'));
    expect(await f.open('edge')).toEqual({ ok: true });
    expect(f.pip.opened).not.toHaveBeenCalled();
  });
  it('retains the cover target lookup and fullscreen flag while rebasing the camera', async () => {
    const f = fixture();
    const open = mainFunction('openApp', { pip: f.pip, apps: f.apps, wm: f.wm, requiresFullscreen: f.requiresFullscreen, launchCoverTimeout: () => 8000, coverLaunch: f.coverLaunch, launcherInFront: () => true, DEMO: false });
    expect(await open('edge')).toEqual({ ok: true });
    expect(f.coverLaunch).toHaveBeenCalledOnce();
    expect(f.requiresFullscreen).toHaveBeenCalledWith(f.target);
    expect(f.pip.opened).toHaveBeenCalledWith({ appId: 'edge', name: 'Edge', windowId: '42' });
  });
  it('keeps the inset hidden until every overlapping visible Sofa overlay closes', () => {
    const cameraInputs = { suppressPinned: vi.fn() };
    const visibility = { home: true, panel: true, toast: true };
    const sync = () => mainFunction('syncCameraOverlays', { cameraInputs, homeOverlayOpen: true, win: { isVisible: () => visibility.home }, panelOpen: () => visibility.panel, toastWin: { isVisible: () => visibility.toast } })();
    sync(); expect(cameraInputs.suppressPinned).toHaveBeenLastCalledWith(true);
    visibility.panel = false; sync(); expect(cameraInputs.suppressPinned).toHaveBeenLastCalledWith(true);
    visibility.home = false; sync(); expect(cameraInputs.suppressPinned).toHaveBeenLastCalledWith(false);
    visibility.toast = false; sync(); expect(cameraInputs.suppressPinned).toHaveBeenLastCalledWith(false);
  });
  it.each(['Camera pinned', 'Already pinned'])('keeps the camera visible during the %s toast', text => {
    const cameraInputs = { suppressPinned: vi.fn() };
    const toastWin = { isDestroyed: () => false, webContents: { send: vi.fn() }, showInactive: vi.fn(), isVisible: () => true };
    const timer = vi.fn();
    mainFunction('showToast', { toastWin, toastReady: true, toastTimer: undefined, clearTimeout: vi.fn(), setTimeout: timer })(text);
    expect(toastWin.showInactive).toHaveBeenCalledOnce();
    mainFunction('syncCameraOverlays', { cameraInputs, homeOverlayOpen: false, win: { isVisible: () => true }, panelOpen: () => false, toastWin })();
    expect(cameraInputs.suppressPinned).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('leaves a pinned camera visible on Home when no menu is open', () => {
    const cameraInputs = { suppressPinned: vi.fn() };
    mainFunction('syncCameraOverlays', { cameraInputs, homeOverlayOpen: false, win: { isVisible: () => true }, panelOpen: () => false })();
    expect(cameraInputs.suppressPinned).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('makes transport a no-op with a notice after the pinned base closes', async () => {
    const toast = vi.fn();
    const wm = { activeWindow: vi.fn() };
    const mediaKeys = { desktopFallback: vi.fn() };
    const transport = mainFunction('onTransport', { quitting: false, lastTransport: 0, pip: { pinned: true, state: { active: true } }, toast, wm, mediaKeys });
    await transport('PlayPause');
    expect(toast).toHaveBeenCalledExactlyOnceWith('Main app closed; open an app to control it');
    expect(wm.activeWindow).not.toHaveBeenCalled();
    expect(mediaKeys.desktopFallback).not.toHaveBeenCalled();
  });
  it('rejects base audio control before looking up a closed app', async () => {
    const apps = { get: vi.fn() };
    const control = mainFunction('controlPipAudio', { pip: { state: { active: true }, revision: 1 }, apps });
    await expect(control('base', 'mute')).rejects.toThrow('Main app closed');
    expect(apps.get).not.toHaveBeenCalled();
  });
});
