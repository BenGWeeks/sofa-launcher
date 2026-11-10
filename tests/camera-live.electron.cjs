// Explicitly gated real-instance check. No actual camera images are captured.
// SOFA_CAMERA_LIVE=1 SOFA_CAMERA_TOKEN_FILE=/private/token SOFA_CAMERA_CONFIG=/path/cameras.toml
// SOFA_CAMERA_ORIGIN=https://your-ha.example electron --no-sandbox --ozone-platform=headless tests/camera-live.electron.cjs
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const ts = require('typescript');
const { parse } = require('smol-toml');
if (process.env.SOFA_CAMERA_LIVE !== '1' || !process.env.SOFA_CAMERA_TOKEN_FILE || !process.env.SOFA_CAMERA_CONFIG || !process.env.SOFA_CAMERA_ORIGIN) { console.log(JSON.stringify({ skipped: true, reason: 'Explicit live-test configuration required' })); app.exit(0); }
const root = join(__dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'sofa-camera-live-'));
app.setPath('userData', join(temporary, 'electron-profile'));
app.commandLine.appendSwitch('mute-audio');
for (const name of ['camera-inputs', 'camera-service', 'camera-webrtc', 'web-url']) writeFileSync(join(temporary, name + '.js'), ts.transpileModule(readFileSync(join(root, 'src/main', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
let cameras;
function finish(code) { try { cameras?.dispose(); } catch {} rmSync(temporary, { recursive: true, force: true }); app.exit(code); }
const deadline = setTimeout(() => { console.log(JSON.stringify({ result: 'bounded-timeout', livePlayback: 'pending-camera-wifi' })); finish(1); }, 90_000);
app.whenReady().then(async () => {
  try {
    const { CameraInputs } = require(join(temporary, 'camera-inputs.js'));
    const configured = parse(readFileSync(process.env.SOFA_CAMERA_CONFIG, 'utf8')).cameras;
    const definitions = configured.map(camera => ({ id: `camera-${camera.id}`, name: camera.name, entity: camera.entity, wmClass: `sofa-camera-${camera.id}` }));
    cameras = new CameraInputs({ origin: process.env.SOFA_CAMERA_ORIGIN, credentialPath: join(temporary, 'private', 'ha-connection.json'), rendererHtml: join(root, 'out/renderer/index.html'), preloadPath: join(root, 'out/preload/camera.js'), setClass: async () => {} });
    cameras.setInputs(definitions);
    // The actual token is held only in this main process and never logged.
    await cameras.service.connect(readFileSync(process.env.SOFA_CAMERA_TOKEN_FILE, 'utf8').trim());
    console.log(JSON.stringify({ authentication: 'validated', protection: cameras.service.storage }));
    const states = await cameras.service.states();
    console.log(JSON.stringify({ cameras: definitions.map(camera => ({ name: camera.name, entity: camera.entity, state: states.get(camera.entity)?.state ?? 'unavailable' })) }));
    const transport = await Promise.allSettled(definitions.map(async camera => ({ name: camera.name, transport: (await cameras.service.transport(camera.entity)).kind })));
    console.log(JSON.stringify({ capabilities: transport.map((result, index) => result.status === 'fulfilled' ? result.value : { name: definitions[index].name, transport: 'unavailable' }) }));
    const candidate = definitions.find(camera => camera.entity === 'camera.barn_outdoors_live_view');
    if (!candidate) throw new Error('configured-ring-camera-missing');
    const id = await cameras.open(candidate.id);
    const window = BrowserWindow.getAllWindows().find(value => String(value.getNativeWindowHandle().readUInt32LE(0)) === id);
    let result = { frames: 0, time: 0, hasStream: false, statuses: [] };
    const end = Date.now() + 35_000;
    while (Date.now() < end) {
      result = await window.webContents.executeJavaScript(`(() => { const video=document.querySelector('video'); return {frames:video?.getVideoPlaybackQuality?.().totalVideoFrames??0,time:video?.currentTime??0,hasStream:!!video?.srcObject,statuses:[...document.querySelectorAll('.status p')].map(e=>e.textContent)} })()`);
      if (result.frames > 2 || result.statuses.some(status => /offline|unavailable|could not|failed/i.test(status))) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    console.log(JSON.stringify({ singleRingAttempt: candidate.name, ...result, livePlayback: result.frames > 2 ? 'frames-received' : 'pending-camera-wifi' }));
    if (result.frames > 2) {
      const before = result.frames;
      await new Promise(resolve => setTimeout(resolve, 800));
      const after = await window.webContents.executeJavaScript(`document.querySelector('video')?.getVideoPlaybackQuality?.().totalVideoFrames??0`);
      console.log(JSON.stringify({ decodedFramesAdvance: after > before, before, after }));
    }
    cameras.close(candidate.id);
    clearTimeout(deadline); finish(0);
  } catch { console.log(JSON.stringify({ result: 'live-check-failed', details: 'Sanitized; no credential or media diagnostics emitted' })); clearTimeout(deadline); finish(1); }
});
