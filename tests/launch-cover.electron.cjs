// Built Home + real preload regression: npm run build && electron --no-sandbox tests/launch-cover.electron.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
const { join } = require('node:path');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const run = promisify(execFile);
function load(name) {
  const filename = join(__dirname, '../src/main', name + '.ts');
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = module.paths;
  mod._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return mod.exports;
}
const profile = mkdtempSync('/tmp/sofa-cover-renderer-');
app.setPath('userData', profile);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let status = 1;
app.whenReady().then(async () => {
  let opens = 0, finish;
  const apps = ['jellyfin', 'netflix', 'youtube'].map(id => ({ id, name: id, brand: id, type: 'web', installed: true, running: false }));
  ipcMain.handle('launcher:appearance', () => ({ version: 'test', theme: 'knowall', background: 'stage-lean' }));
  ipcMain.handle('apps:list', () => apps);
  ipcMain.handle('launcher:action', () => {});
  ipcMain.handle('apps:open', () => { opens++; return new Promise(resolve => { finish = resolve; }); });
  const win = new BrowserWindow({ width: 1280, height: 720, webPreferences: { preload: join(__dirname, '../out/preload/index.js'), sandbox: true } });
  const js = source => win.webContents.executeJavaScript(source);
  const key = async key => { await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, cancelable: true }))`); await sleep(30); };
  const focused = () => js("document.querySelector('.slot.focused')?.textContent");
  const capture = async name => {
    if (!process.env.SOFA_COVER_EVIDENCE_DIR) return;
    mkdirSync(process.env.SOFA_COVER_EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(process.env.SOFA_COVER_EVIDENCE_DIR, name + '.png'), (await win.webContents.capturePage()).toPNG());
  };
  try {
    await win.loadFile(join(__dirname, '../out/renderer/index.html'));
    await sleep(500);
    const first = await focused();
    assert.ok(first?.includes('jellyfin'));
    // The same unseen inputs move Home and launch twice on the old implementation.
    win.webContents.send('launch-cover', true);
    await sleep(30);
    for (const k of ['ArrowRight', 'ArrowDown', 'Enter', '2', '0']) await key(k);
    const baseline = process.env.SOFA_COVER_BASELINE === '1';
    assert.equal(opens, baseline ? 1 : 0);
    assert.equal(await focused() === first, !baseline);
    await capture(baseline ? 'launch-cover-before' : 'launch-cover-after');
    if (!baseline) {
      win.webContents.send('launch-cover', false);
      await key('ArrowRight');
      assert.notEqual(await focused(), first);
      // Immediate pending guard also blocks a second launch before cover IPC arrives.
      await key('Enter'); await key('2');
      assert.equal(opens, 1);
      win.webContents.send('launch-cover', true);
      finish({ ok: true }); await sleep(50);
      await key('Enter'); assert.equal(opens, 1, 'open completion must not unlock an active cover');
      win.webContents.send('launch-cover', false);
      win.webContents.send('action', { action: 'home', context: 'home' });
      await sleep(30); await key('Enter');
      assert.equal(opens, 2, 'Home/cancel restores navigation');
      finish({ ok: true }); await sleep(30);
      await key('Enter'); assert.equal(opens, 3);
      win.webContents.send('launch-cover', true); await sleep(30);
      win.webContents.send('launch-cover', false); await sleep(30);
      const beforeTimeoutNavigation = await focused();
      await key('ArrowRight');
      assert.notEqual(await focused(), beforeTimeoutNavigation, 'cover timeout unlocks navigation even while opening is pending');
      finish({ ok: false });
      // Real KWin layering check, opt-in on an isolated display with KWin running.
      if (process.env.SOFA_COVER_KWIN === '1') {
        const { prepareLaunchCover } = load('launch-cover-window');
        const { coverToastGate } = load('launch-cover');
        const id = w => String(w.getNativeWindowHandle().readUInt32LE());
        const toast = new BrowserWindow({ width: 300, height: 80, frame: false, show: false, alwaysOnTop: true });
        toast.setAlwaysOnTop(true, 'screen-saver');
        const cover = await prepareLaunchCover({ setType: async (wid, type) => {
          await run('xprop', ['-id', wid, '-f', '_NET_WM_WINDOW_TYPE', '32a', '-set', '_NET_WM_WINDOW_TYPE', '_NET_WM_WINDOW_TYPE_' + type.toUpperCase()]);
        } }, () => {});
        assert.ok(cover);
        try {
          toast.showInactive(); cover.showInactive(); await sleep(300);
          const { stdout } = await run('xprop', ['-root', '_NET_CLIENT_LIST_STACKING']);
          const stack = [...stdout.matchAll(/0x[0-9a-f]+/gi)].map(m => String(parseInt(m[0], 16)));
          assert.ok(stack.includes(id(cover)) && stack.includes(id(toast)));
          assert.ok(stack.indexOf(id(cover)) > stack.indexOf(id(toast)), 'notification cover obscures keep-above toast on KWin');
          let shown = false;
          const gate = coverToastGate(above => above ? cover.showInactive() : cover.hide(), () => {
            assert.equal(cover.isVisible(), false, 'hide cover before displaying toast');
            shown = true; toast.showInactive();
          });
          gate.setAbove(true); gate.toast('Launch failed'); assert.equal(shown, false);
          gate.setAbove(false); assert.equal(shown, true);
          console.log('PASS: KWin notification cover obscures keep-above toast; cancellation precedes toast display');
        } finally { cover.destroy(); toast.destroy(); }
      }
    }
    console.log(baseline ? 'PASS: reproduced hidden Home movement and launch on baseline' : 'PASS: covered navigation, launch suppression, pending IPC guard, open completion, Home cancellation');
    status = 0;
  } finally { win.destroy(); }
}).catch(console.error).finally(() => { app.quit(); rmSync(profile, { recursive: true, force: true }); process.exitCode = status; });
