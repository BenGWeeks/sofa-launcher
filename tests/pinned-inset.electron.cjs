// Brief synthetic X11 desktop smoke; creates and closes only its own windows.
// npm run build && electron --no-sandbox tests/pinned-inset.electron.cjs
const { app, BrowserWindow, screen } = require('electron');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = join(__dirname, '..');
const folder = mkdtempSync(join(tmpdir(), 'sofa-pinned-x11-'));
app.setPath('userData', join(folder, 'profile'));
for (const name of ['pinned-camera', 'camera-inputs', 'camera-service', 'camera-webrtc', 'web-url', 'pip', 'x11-pip', 'windows']) {
  writeFileSync(join(folder, name + '.js'), ts.transpileModule(readFileSync(join(root, 'src/main', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const id = w => String(w.getNativeWindowHandle().readUInt32LE(0));
const delay = () => new Promise(resolve => setTimeout(resolve, 250));
let cameras;
app.whenReady().then(async () => {
  try {
    const { XdotoolWindowManager } = require(join(folder, 'windows.js'));
    const { X11PipWindows } = require(join(folder, 'x11-pip.js'));
    const { PipManager, insetBounds } = require(join(folder, 'pip.js'));
    const { pinCamera } = require(join(folder, 'pinned-camera.js'));
    const { CameraInputs } = require(join(folder, 'camera-inputs.js'));
    const wm = new XdotoolWindowManager();
    const x11 = new X11PipWindows(wm);
    cameras = new CameraInputs({ origin: 'http://127.0.0.1:1', credentialPath: join(folder, 'no-token.json'), rendererHtml: join(root, 'out/renderer/index.html'), preloadPath: join(root, 'out/preload/camera.js'), setClass: (id, value) => wm.setClass(id, value) });
    cameras.setInputs([{ id: 'camera-fixture', name: 'Synthetic camera viewer (no connection)', entity: 'camera.fixture', wmClass: 'sofa-camera-fixture' }]);
    async function fullscreen(title, color) {
      const w = new BrowserWindow({ title, fullscreen: true, backgroundColor: color, webPreferences: { sandbox: true } });
      await w.loadURL('data:text/html,' + encodeURIComponent(`<body style="background:${color};color:white;font:40px sans-serif">${title}<script>window.keys=[];addEventListener('keydown',e=>window.keys.push(e.key))</script>`));
      return w;
    }
    const base = await fullscreen('Throwaway fullscreen app', '#234');
    const cameraId = await cameras.open('camera-fixture');
    const camera = BrowserWindow.getAllWindows().find(w => id(w) === cameraId);
    const bounds = screen.getPrimaryDisplay().bounds;
    const pip = new PipManager(Object.assign(x11, {
      pin: async (w, b) => { await pinCamera(cameras, x11, screen, w, b); },
      raise: async w => { cameras.raise(w.appId); await x11.keepAbove(w.windowId); },
      closePinned: async w => { cameras.close(w.appId); },
    }));
    const target = (w, appId) => ({ appId, name: appId, windowId: id(w) });
    cameras.suppressPinned(true); // Pin while a Sofa menu is already open.
    await pip.start(target(base, 'base'), { appId: 'camera-fixture', name: 'camera', windowId: cameraId, camera: true }, bounds);
    await delay();
    assert.equal(camera.isVisible(), false, 'Pinning under a menu stays hidden');
    cameras.suppressPinned(false);
    await delay();
    async function assertAbove(w) {
      const stacking = execFileSync('xprop', ['-root', '_NET_CLIENT_LIST_STACKING'], { encoding: 'utf8' }).match(/0x[0-9a-f]+/gi).map(v => String(parseInt(v, 16)));
      assert(stacking.indexOf(cameraId) > stacking.indexOf(id(w)), 'Camera must stack above active fullscreen window');
      assert.equal(await wm.activeWindow(), id(w), 'Camera must not take keyboard focus');
      assert.equal(camera.isFocusable(), false);
      assert.equal(camera.isAlwaysOnTop(), true);
      assert.equal((await x11.snapshot(cameraId)).states.includes('_NET_WM_STATE_ABOVE'), true);
    }
    await assertAbove(base);
    assert.deepEqual((await x11.snapshot(cameraId)).bounds, insetBounds(bounds, 0, 0), 'Initial corner geometry');
    const next = await fullscreen('Throwaway next fullscreen app', '#324');
    await wm.activate(id(next)); await pip.opened(target(next, 'next')); await delay();
    await assertAbove(next);
    next.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    next.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
    assert.deepEqual(await next.webContents.executeJavaScript('window.keys'), ['ArrowRight']);
    const home = await fullscreen('Throwaway Sofa fullscreen home', '#243');
    await wm.activate(id(home)); await pip.home(); await delay(); await assertAbove(home);
    await pip.move(); await pip.resize(); await delay();
    const actual = (await x11.snapshot(cameraId)).bounds;
    assert.deepEqual(actual, insetBounds(bounds, 1, 1));
    cameras.suppressPinned(true); await delay(); assert.equal(camera.isVisible(), false);
    await pip.home(); assert.equal(camera.isVisible(), false);
    cameras.suppressPinned(false); await delay(); await assertAbove(home);
    await pip.closing('next'); next.destroy(); await pip.check(); assert.equal(pip.pinned, true);
    assert.equal(pip.state.baseId, undefined, 'Closed base is no longer a control target');
    await pip.stop(); await delay(); assert(camera.isDestroyed());
    console.log('X11: pinned viewer above two active fullscreen apps and fullscreen Home; focus/input, corner/size, close and cleanup passed');
    cleanup(); app.exit(0);
  } catch (error) { console.error(error); cleanup(); app.exit(1); }
});
function cleanup() { cameras?.dispose(); for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy(); rmSync(folder, { recursive: true, force: true }); }
