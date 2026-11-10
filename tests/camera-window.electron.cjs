// Actual Chromium HLS/IPC smoke. Requires npm run build and system ffmpeg.
// electron --no-sandbox --ozone-platform=headless --ozone-override-screen-size=1920,1080 tests/camera-window.electron.cjs
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join, basename } = require('node:path');
const { tmpdir } = require('node:os');
const { createServer } = require('node:http');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = join(__dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'sofa-camera-chromium-'));
app.setPath('userData', join(temporary, 'electron-profile'));
app.commandLine.appendSwitch('mute-audio');
const dummyToken = 'fixture-camera-token-not-a-real-credential';
for (const name of ['camera-inputs', 'camera-service', 'camera-webrtc', 'web-url']) {
  writeFileSync(join(temporary, name + '.js'), ts.transpileModule(readFileSync(join(root, 'src/main', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
let rtcProducer;
class FixtureSocket {
  listeners = new Map();
  rtc = false;
  close() { if (this.rtc && rtcProducer && !rtcProducer.isDestroyed()) void rtcProducer.webContents.executeJavaScript('window.fixtureClose()').catch(() => {}); }
  addEventListener(type, callback) { this.listeners.set(type, [...this.listeners.get(type) || [], callback]); if (type === 'message') queueMicrotask(() => this.emit({ type: 'auth_required' })); }
  emit(value) { for (const callback of this.listeners.get('message') || []) callback({ data: JSON.stringify(value) }); }
  send(text) {
    const value = JSON.parse(text);
    if (value.type === 'auth') { assert.equal(value.access_token, dummyToken); queueMicrotask(() => this.emit({ type: 'auth_ok' })); return; }
    const result = data => queueMicrotask(() => this.emit({ type: 'result', id: value.id, success: true, result: data }));
    if (value.type === 'camera/capabilities') setTimeout(() => result({ frontend_stream_types: value.entity_id === 'camera.rtc' ? ['web_rtc'] : ['hls'] }), 1800);
    else if (value.type === 'camera/stream') result({ url: '/api/hls/fixture/playlist.m3u8' });
    else if (value.type === 'camera/webrtc/get_client_config') result({ configuration: { iceServers: [] } });
    else if (value.type === 'camera/webrtc/offer') {
      this.rtc = true; result(null);
      queueMicrotask(() => this.emit({ type: 'event', id: 1, event: { type: 'session', session_id: 'fixture-rtc-session' } }));
      void rtcProducer.webContents.executeJavaScript(`window.fixtureOffer(${JSON.stringify(value.offer)})`).then(answer => {
        // Exercise candidate buffering: HA candidates can precede its answer.
        for (const candidate of answer.candidates) this.emit({ type: 'event', id: 1, event: { type: 'candidate', candidate } });
        this.emit({ type: 'event', id: 1, event: { type: 'answer', answer: answer.sdp } });
      }).catch(error => { console.error('Fixture RTC producer:', error); this.emit({ type: 'event', id: 1, event: { type: 'error' } }); });
    } else if (value.type === 'camera/webrtc/candidate') {
      void rtcProducer.webContents.executeJavaScript(`window.fixtureCandidate(${JSON.stringify(value.candidate)})`).catch(error => console.error('Fixture ICE:',error)); result(null);
    } else if (value.type === 'unsubscribe_events') result(null);
    else throw new Error('Unexpected fixture command: ' + value.type);
  }
}
let cameras, server;
async function until(operation, message, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await operation()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(message);
}
const evaluate = (window, source) => window.webContents.executeJavaScript(source);
function windowById(id) { return BrowserWindow.getAllWindows().find(window => String(window.getNativeWindowHandle().readUInt32LE(0)) === id); }
async function key(window, name) { window.webContents.sendInputEvent({ type: 'keyDown', keyCode: name }); if (name === 'Return') window.webContents.sendInputEvent({type:'char',keyCode:'\r'}); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: name }); await new Promise(resolve => setTimeout(resolve, 60)); }
app.whenReady().then(async () => {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '18', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '12', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '48k', '-f', 'hls', '-hls_time', '1', '-hls_playlist_type', 'vod', '-hls_segment_filename', join(temporary, 'segment%03d.ts'), join(temporary, 'playlist.m3u8')], { timeout: 30_000 });
    const jpeg = require('electron').nativeImage.createFromBuffer(execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-threads', '1', '-'])).toJPEG(85);
    let mediaRequests = 0;
    let offlineAvailable = false;
    server = createServer((request, response) => {
      if (request.headers.authorization !== `Bearer ${dummyToken}`) { response.writeHead(401); response.end(); return; }
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (pathname === '/api/') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ message: 'API running.' })); }
      else if (pathname === '/api/states') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(['front', 'barn', 'offline', 'rtc'].map(name => ({ entity_id: `camera.${name}`, state: name === 'offline' && !offlineAvailable ? 'unavailable' : 'idle', attributes: { friendly_name: name } })))); }
      else if (pathname.startsWith('/api/camera_proxy/')) { assert(!request.url.includes(dummyToken)); response.setHeader('Content-Type', 'image/jpeg'); response.end(jpeg); }
      else if (/^\/api\/hls\/fixture\/(playlist\.m3u8|segment\d{3}\.ts)$/.test(pathname)) {
        mediaRequests++;
        response.setHeader('Content-Type', pathname.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
        response.end(readFileSync(join(temporary, basename(pathname))));
      } else { response.writeHead(404); response.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { CameraInputs } = require(join(temporary, 'camera-inputs.js'));
    cameras = new CameraInputs({ origin: `http://127.0.0.1:${server.address().port}`, credentialPath: join(temporary, 'private', 'ha-connection.json'), rendererHtml: join(root, 'out/renderer/index.html'), preloadPath: join(root, 'out/preload/camera.js'), setClass: async () => {} });
    cameras.service.socket = () => new FixtureSocket();
    cameras.setInputs(['front', 'barn', 'offline', 'all'].map(name => ({ id: `camera-${name}`, name: name === 'all' ? 'All cameras' : name, entity: name === 'all' ? 'all' : `camera.${name}`, wmClass: `sofa-camera-${name}` })));
    const front = windowById(await cameras.open('camera-front'));
    assert.equal(front.getTitle(), 'front', 'Camera title was replaced by the bundled page title');
    await evaluate(front, `document.title='Sofa Launcher title mutation'; true`);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(front.getTitle(), 'front', 'Camera title changed after a page-title update');
    assert.equal(front.webContents.getWebRTCIPHandlingPolicy(), 'default_public_and_private_interfaces');
    const errors = [];
    front.webContents.on('console-message', event => { if (event.level === 'error') { errors.push(event.message); console.error('Camera renderer:',event.message); } });
    front.webContents.on('render-process-gone', (_event, details) => console.error('Camera renderer exited:', details.reason));
    await until(() => evaluate(front, "document.body.textContent.includes('Connect your cameras')"), 'Missing-auth setup did not render');
    await until(() => evaluate(front, 'document.activeElement?.id === \"ha-token\"'), 'Token field was not focused for remote text input');
    await evaluate(front, `(() => {const input=document.querySelector('input'); input.value=${JSON.stringify(dummyToken)}; input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await key(front, 'Down');
    assert(await evaluate(front, 'document.activeElement?.tagName === \"BUTTON\"'), 'Down did not reach Connect');
    await key(front, 'Up');
    assert(await evaluate(front, 'document.activeElement?.id === \"ha-token\"'), 'Up did not return to token');
    // Force the one-shot frame callback to arrive before source attachment.
    // Playback must still clear Connecting via the guarded playing fallback.
    await evaluate(front, `HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) { queueMicrotask(() => callback(0, {})); return 0; }; true`);
    await key(front, 'Down'); await key(front, 'Return');
    await until(() => evaluate(front, "document.body.textContent.includes('Connecting…')"), 'Missing connecting state');
    if (process.env.SOFA_CAPTURE_BEFORE) {
      writeFileSync(join(root, 'docs/screenshots/camera-connect-before.png'), (await front.webContents.capturePage()).toPNG());
      cameras.dispose(); server.close(); rmSync(temporary, { recursive: true, force: true }); app.exit(0); return;
    }
    await until(() => evaluate(front, "!!document.querySelector('.snapshot:not(.live)')?.complete"), 'Snapshot was not shown before live video');
    const previewUrl = await evaluate(front, "document.querySelector('.snapshot').src");
    assert(previewUrl.startsWith('data:image/jpeg;base64,') && !previewUrl.includes(dummyToken));
    assert.equal(require('electron').nativeImage.createFromDataURL(previewUrl).getSize().width, 640);
    writeFileSync(join(root, 'docs/screenshots/camera-connect-after.png'), (await front.webContents.capturePage()).toPNG());
    console.log('Camera Chromium: authenticated still appears before live video; token absent from URL/IPC');
    console.log('Camera Chromium: unauthenticated setup and remote arrows/OK rendered');
    await until(() => evaluate(front, '!!document.querySelector("video") && document.querySelector("video").currentTime > 1'), 'HLS video did not advance: ' + errors.join('; '));
    await until(() => evaluate(front, "!document.querySelector('.snapshot') && !document.querySelector('.camera-player .status')"), 'Snapshot was not removed or Connecting remained after playback');
    assert(mediaRequests > 2, 'Expected actual HLS playlist and segments through IPC');
    const barn = windowById(await cameras.open('camera-barn'));
    await until(() => evaluate(barn, '!!document.querySelector("video") && document.querySelector("video").currentTime > .5'), 'Second camera did not play');
    await cameras.audio('camera-front', 'down'); await cameras.audio('camera-front', 'mute');
    await until(() => evaluate(front, 'document.querySelector("video").volume === .95 && !document.querySelector("video").muted'), 'Front audio update did not reach only its video');
    assert(await evaluate(barn, 'document.querySelector("video").volume === 1 && document.querySelector("video").muted'), 'Other viewer audio changed');
    cameras.pause('camera-front');
    await until(() => evaluate(front, 'document.querySelector("video").paused && document.body.textContent.includes("Camera paused")'), 'Camera pause did not stop playback');
    const before = await evaluate(barn, 'document.querySelector("video").currentTime');
    await new Promise(resolve => setTimeout(resolve, 500));
    assert(await evaluate(barn, 'document.querySelector("video").currentTime') > before, 'Pausing front interrupted barn');
    await cameras.open('camera-front');
    await until(() => evaluate(front, 'document.querySelector("video")?.currentTime > .5 && !document.querySelector("video").paused'), 'Camera did not resume');
    const offline = windowById(await cameras.open('camera-offline'));
    await until(() => evaluate(offline, 'document.body.textContent.includes("Camera offline")'), 'Offline camera was not labelled');
    offlineAvailable = true;
    await key(offline, 'Down'); await key(offline, 'Down');
    assert(await evaluate(offline, 'document.activeElement?.textContent === \"Try again\"'), 'Remote could not reach camera Retry');
    await key(offline, 'Return');
    await until(() => evaluate(offline, 'document.querySelector(\"video\")?.currentTime > .5'), 'Retry did not refresh the recovered camera state');
    offlineAvailable = false;
    const grid = windowById(await cameras.open('camera-all'));
    await until(() => evaluate(grid, 'document.querySelectorAll("video").length === 3 && [...document.querySelectorAll("video")].filter(v => v.currentTime > .5).length === 2 && document.body.textContent.includes("Camera offline")'), 'All-cameras grid did not play both online feeds');
    const screenshot = await grid.webContents.capturePage();
    writeFileSync('/tmp/sofa-camera-grid-fixture.png', screenshot.toPNG());
    cameras.close('camera-front');
    await until(() => cameras.windowsFor('camera-front').length === 0, 'Closed camera window did not finish native teardown', 2_000);
    assert.equal(cameras.windowsFor('camera-barn').length, 1);
    console.log('Camera Chromium: actual HLS video advances, offline/grid states, recovered-camera retry, pause/resume, per-window audio and close isolation passed');
    rtcProducer = new BrowserWindow({ show: false, width: 320, height: 180, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    rtcProducer.webContents.setWebRTCIPHandlingPolicy('default_public_and_private_interfaces');
    await rtcProducer.loadURL('data:text/html,<canvas width="320" height="180"></canvas>');
    await rtcProducer.webContents.executeJavaScript(`
      window.fixturePeer = null; window.fixturePending = [];
      const canvas = document.querySelector('canvas'); const context = canvas.getContext('2d');
      let frame = 0;
      setInterval(() => { context.fillStyle = frame % 2 ? '#f7931a' : '#9dff0a'; context.fillRect(0,0,320,180); context.fillStyle='#000'; context.font='24px sans-serif';context.fillText('WebRTC '+frame++,20,90); },80);
      window.fixtureStream = canvas.captureStream(12);
      window.fixtureCandidate = async candidate => { if (window.fixturePeer?.remoteDescription) await window.fixturePeer.addIceCandidate(candidate); else window.fixturePending.push(candidate); };
      window.fixtureClose = () => window.fixturePeer?.close();
      window.fixtureOffer = async offer => {
        const peer = new RTCPeerConnection({iceServers:[]}); window.fixturePeer = peer;
        for (const track of window.fixtureStream.getTracks()) peer.addTrack(track,window.fixtureStream);
        await peer.setRemoteDescription({type:'offer',sdp:offer});
        for (const candidate of window.fixturePending.splice(0)) await peer.addIceCandidate(candidate);
        const answer = await peer.createAnswer(); await peer.setLocalDescription(answer);
        await new Promise(resolve => { if (peer.iceGatheringState==='complete') return resolve(); const timer=setTimeout(resolve,2000); peer.addEventListener('icegatheringstatechange',()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timer);resolve()}}); });
        const candidates=[]; const lines=[]; let index=-1, mid=null;
        for (const line of peer.localDescription.sdp.split('\\r\\n')) {
          if(line.startsWith('m=')){index++;mid=null;}
          if(line.startsWith('a=mid:'))mid=line.slice(6);
          if(line.startsWith('a=candidate:'))candidates.push({candidate:line.slice(2),sdpMid:mid,sdpMLineIndex:index}); else lines.push(line);
        }
        return {sdp:lines.join('\\r\\n'),candidates};
      };
      true;
    `);
    cameras.setInputs([{ id: 'camera-rtc', name: 'WebRTC fixture', entity: 'camera.rtc', wmClass: 'sofa-camera-rtc' }]);
    const rtc = windowById(await cameras.open('camera-rtc'));
    await until(() => evaluate(rtc, '!!document.querySelector("video")?.srcObject && document.querySelector("video").currentTime > .5'), 'Native WebRTC video did not advance', 30_000);
    writeFileSync('/tmp/sofa-camera-webrtc-fixture.png', (await rtc.webContents.capturePage()).toPNG());
    cameras.pause('camera-rtc');
    await until(() => evaluate(rtc, 'document.body.textContent.includes("Camera paused") && !document.querySelector("video").srcObject'), 'WebRTC pause did not detach camera media');
    await cameras.open('camera-rtc');
    await until(() => evaluate(rtc, '!!document.querySelector("video")?.srcObject && document.querySelector("video").currentTime > .5'), 'Native WebRTC did not resume', 30_000);
    console.log('Camera Chromium: native WebRTC video, HA-style trickle ICE, receiver-only tracks and pause/resume passed');
    rtcProducer.destroy();
    cameras.dispose(); server.close(); rmSync(temporary, { recursive: true, force: true }); app.exit(0);
  } catch (error) {
    console.error(error);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) console.error('Camera failure state:',await evaluate(window, `JSON.stringify({text:document.body.textContent,video:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,ready:v.readyState,network:v.networkState,error:v.error?.message,src:v.currentSrc}))})`).catch(()=>''));
    }
    try { cameras?.dispose(); server?.close(); } catch {}
    rmSync(temporary, { recursive: true, force: true }); app.exit(1);
  }
});
