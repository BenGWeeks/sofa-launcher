// Real passive-grab regression. Run on an isolated X11 display with a window manager:
// electron --no-sandbox tests/app-keys.electron.cjs
// Uses local Chromium fixtures only; never opens streaming services or user profiles.
const { app, BrowserWindow, globalShortcut } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const assert = require('node:assert/strict');
const run = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = mkdtempSync('/tmp/sofa-held-back-');
app.setPath('userData', profile);
function load(name) {
  const filename = join(__dirname, '../src/main', name + '.ts');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return mod.exports;
}
const { sendKeysToApp } = load('app-keys');
const { backToWebApp } = load('back');
const { homeRequestWatcher } = load('home-request');
let result = 1;
app.whenReady().then(async () => {
  const home = new BrowserWindow({ width: 640, height: 480 });
  const target = new BrowserWindow({ width: 640, height: 480 });
  const id = win => String(win.getNativeWindowHandle().readUInt32LE());
  const focus = async win => { win.show(); await run('xdotool', ['windowactivate', '--sync', id(win)]); await sleep(100); };
  const evaluate = source => target.webContents.executeJavaScript(source);
  const watchHome = homeRequestWatcher({ title: async windowId => (await run('xdotool', ['getwindowname', windowId])).stdout.trim() });
  let handler, action, homeCount = 0;
  const goHome = async () => { homeCount++; await focus(home); };
  const capture = async (name) => {
    if (process.env.SOFA_BACK_EVIDENCE_DIR) {
      const image = await target.webContents.capturePage();
      require('node:fs').writeFileSync(join(process.env.SOFA_BACK_EVIDENCE_DIR, name + '.png'), image.toPNG());
    }
  };
  async function hold() {
    action = undefined;
    await run('xdotool', ['keydown', 'ctrl+alt+shift+k']);
    try { await sleep(300); } finally { await run('xdotool', ['keyup', 'ctrl+alt+shift+k']); }
    assert.ok(action, 'global Back callback must fire');
    await action;
    await sleep(200);
  }
  try {
    await home.loadURL('data:text/html,<title>Sofa test home</title><h1>Sofa test home</h1>');
    // Local response supplies a real origin and same-document history, without network.
    target.webContents.session.protocol.handle('https', () => new Response('<title>Held Back fixture</title><h1>Local Back fixture</h1><p id="state">Details page</p><script>onpopstate=()=>document.querySelector("#state").textContent="Browse page"</script>', { headers: { 'content-type': 'text/html' } }));
    await target.loadURL('https://sofa-held-back.test/browse');
    const remote = readFileSync(join(__dirname, '../resources/browser-remote/remote.js'), 'utf8');
    await evaluate(`history.pushState({}, '', '/details'); new Function('location', ${JSON.stringify(remote)})({hostname:'www.primevideo.com',pathname:'/details'})`);
    assert.equal(globalShortcut.register('Control+Alt+Shift+K', () => { if (!action) action = handler(); }), true);
    await focus(target);
    handler = () => run('xdotool', ['key', '--clearmodifiers', 'ctrl+shift+F8']);
    await hold();
    assert.equal(await evaluate('location.pathname'), '/details', 'unguarded chord must reproduce lost Back');
    await capture('held-back-before');
    console.log('BEFORE: held 300 ms, unguarded Back lost; fixture stayed at /details');
    handler = () => backToWebApp('ctrl+shift+F8', id(target), { sendKeys: sendKeysToApp, watchHome, activeWindow: async () => (await run('xdotool', ['getactivewindow'])).stdout.trim(), goHome });
    await hold();
    assert.equal(await evaluate('location.pathname'), '/browse');
    assert.equal(homeCount, 0);
    await capture('held-back-after');
    console.log('AFTER: held 300 ms, guarded helper Back reached fixture and navigated to /browse');
    await hold();
    assert.equal(homeCount, 1);
    assert.equal((await run('xdotool', ['getactivewindow'])).stdout.trim(), id(home));
    console.log('AFTER: held 300 ms at first page, title request focused test Sofa home');
    // Exercise YouTube's MAIN-world window.close override with a local TV-like handler.
    await target.loadURL('data:text/html,<title>Local TV fixture</title><h1>Local TV fixture</h1><script>onkeydown=e=>{if(e.key==="Escape")window.close()}</script>');
    await evaluate(readFileSync(join(__dirname, '../resources/browser-remote/youtube-tv-back.js'), 'utf8'));
    await focus(target);
    handler = () => backToWebApp('Escape', id(target), { sendKeys: sendKeysToApp, watchHome, activeWindow: async () => (await run('xdotool', ['getactivewindow'])).stdout.trim(), goHome });
    await hold();
    assert.equal(homeCount, 2);
    assert.equal(target.isDestroyed(), false);
    console.log('AFTER: held Escape translation triggered YouTube-style close override and focused home, leaving fixture alive');
    result = 0;
  } catch (error) { console.error(error); }
  finally {
    globalShortcut.unregisterAll();
    await run('xdotool', ['keyup', 'ctrl+alt+shift+k']).catch(() => {});
    target.destroy(); home.destroy();
    app.exit(result);
  }
});
process.on('exit', () => rmSync(profile, { recursive: true, force: true }));
