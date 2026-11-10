// Real Chromium DOM/geometry regression checks; no service accounts or network.
// electron --no-sandbox --ozone-platform=headless --ozone-override-screen-size=1280,720 tests/browser-remote.electron.cjs
const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const profile = mkdtempSync(join(tmpdir(), 'sofa-remote-test-'));
app.setPath('userData', profile);
process.on('exit', () => rmSync(profile, { recursive: true, force: true }));
const script = readFileSync(join(__dirname, '../resources/browser-remote/remote.js'), 'utf8');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1280, height: 720, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true } });
  const wc = win.webContents;
  const evaluate = source => wc.executeJavaScript(source);
  const key = async (name, modifiers = []) => { wc.sendInputEvent({ type: 'keyDown', keyCode: name, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode: name, modifiers }); await new Promise(r => setTimeout(r, 35)); };
  async function fixture(hostname, body, pathname = '/') {
    await win.loadURL('data:text/html,' + encodeURIComponent(`<style>body{margin:40px}button,a,input{display:inline-block;width:160px;height:40px;margin:10px}article{display:inline-block;width:220px;height:130px;margin:10px}article a{width:200px;height:110px}article button{position:absolute;width:20px;height:20px}#cards{width:750px}#field,#submit{display:block}dialog{display:block;position:fixed;inset:0;background:white;z-index:5}</style>${body}`));
    await evaluate(`new Function('location', ${JSON.stringify(script)})(${JSON.stringify({ hostname, pathname })})`);
  }
  try {
    await fixture('www.primevideo.com', `<button id="hero">Hero</button><div id="cards">${Array.from({ length: 6 }, (_, i) => `<article data-testid="card"><a id="card${i}" href="/detail/${i}" tabindex="-1" onclick="event.preventDefault();document.body.dataset.opened='${i}'">Title ${i}</a><button>Hover</button></article>`).join('')}</div><input id="field"><button id="submit">Continue</button>`);
    for (const [name, expected] of [['Down','card0'],['Right','card1'],['Right','card2'],['Down','card5']]) {
      await key(name); assert.equal(await evaluate('document.activeElement.id'), expected);
    }
    await key('Return'); assert.equal(await evaluate('document.body.dataset.opened'), '5');
    await evaluate("document.activeElement.remove()");
    await new Promise(r => setTimeout(r, 30));
    assert.equal(await evaluate("document.getElementById('sofa-remote-focus').style.display"), 'none');
    await evaluate("document.getElementById('field').focus(); document.getElementById('field').value='abc'; document.getElementById('field').setSelectionRange(1,1)");
    await key('Left'); assert.equal(await evaluate("document.getElementById('field').selectionStart"), 0);
    await key('Down'); assert.equal(await evaluate('document.activeElement.id'), 'submit');
    await evaluate("document.body.insertAdjacentHTML('beforeend','<dialog role=dialog><button id=modal1>One</button><button id=modal2>Two</button></dialog>')");
    await key('Down'); assert.equal(await evaluate('document.activeElement.id'), 'modal1');
    await key('Right'); assert.equal(await evaluate('document.activeElement.id'), 'modal2');
    const manifest = JSON.parse(readFileSync(join(__dirname, '../resources/browser-remote/manifest.json'), 'utf8'));
    assert.ok(manifest.content_scripts.some(entry => entry.js?.includes('remote.js') && entry.matches.includes('https://tidal.com/*')), 'TIDAL redirects its listener host to tidal.com; navigation must follow it');
    await fixture('tidal.com', '<nav><a href="/">Music</a></nav><main><a id="album1" href="/album/1" onclick="event.preventDefault();document.body.dataset.opened=1">Album one</a><a id="album2" href="/album/2" onclick="event.preventDefault();document.body.dataset.opened=2">Album two</a></main><footer><button id="play" onclick="document.body.dataset.played=1">Play</button></footer>');
    await key('Down');
    await key('Down'); assert.equal(await evaluate('document.activeElement.id'), 'album1');
    await key('Right'); assert.equal(await evaluate('document.activeElement.id'), 'album2');
    await key('Return'); assert.equal(await evaluate('document.body.dataset.opened'), '2');
    await key('Down'); assert.equal(await evaluate('document.activeElement.id'), 'play');
    await key('Return'); assert.equal(await evaluate('document.body.dataset.played'), '1');
    await fixture('tidal.com', `<style>nav{position:fixed;left:0;top:40px}main{position:fixed;left:240px;top:0;width:600px;height:700px;overflow:auto}section[role=presentation]{height:240px;width:220px;margin:20px}section a{height:180px;width:200px}footer{position:fixed;left:0;right:0;top:600px;height:120px;background:black;z-index:10}</style><nav><a href="/">Music</a></nav><main>${Array.from({length:6},(_,i)=>`<section role="presentation" data-test="mix-card-${i}"><a id="mix${i}" href="/mix/${i}" onclick="event.preventDefault()">Mix ${i}</a><button tabindex="-1">Hover Play</button></section>`).join('')}</main><footer data-test="play-controls"><button data-test="play" onclick="document.body.dataset.player='play'">Play</button><button data-test="pause" onclick="document.body.dataset.player='pause'">Pause</button><button data-test="next" onclick="document.body.dataset.player='next'">Next</button><button data-test="previous" onclick="document.body.dataset.player='previous'">Previous</button></footer>`);
    await key('Down'); assert.equal(await evaluate('document.activeElement.id'),'mix0');
    for (let i=1;i<=4;i++) { await key('Down'); assert.equal(await evaluate('document.activeElement.id'),'mix'+i); }
    assert.ok(await evaluate("document.querySelector('main').scrollTop > 0 && document.activeElement.getBoundingClientRect().bottom < 600"),'TIDAL must scroll beyond Custom mixes without selecting behind its fixed player');
    for (const [shortcut,expected] of [['F9','play'],['F7','pause'],['F10','next'],['F11','previous']]) { await key(shortcut,['control','shift']); assert.equal(await evaluate('document.body.dataset.player'),expected); }
    await fixture('tidal.com', `<button data-test="sidebar-collection-menu" id="collection">Collection</button><div role="menu" style="position:fixed;top:150px;left:40px"><button id="popup">Playlists</button></div><script>document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('[role=menu]').style.display='none'})</script>`);
    await key('Down'); await key('Down'); await key('Return'); assert.equal(await evaluate('document.activeElement.id'),'popup');
    await key('F8',['control','shift']); assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=menu]')).visibility"),'hidden');
    assert.equal(await evaluate('document.activeElement.id'),'collection');
    await key('Return'); await key('Left');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[role=menu]')).visibility"),'hidden');
    await fixture('fountain.fm', '<button>Trending</button><a id="episode" href="/episode/abc">Episode</a>');
    await key('Down'); assert.equal(await evaluate('document.activeElement.id'), 'episode');
    await fixture('www.netflix.com', '<button id="native">Player</button><button data-uia="player-back-to-browse" onclick="document.body.dataset.back=\'yes\'">Back</button>', '/watch/123');
    await key('Down'); assert.notEqual(await evaluate('document.activeElement.id'), 'native');
    await key('F8', ['control','shift']); assert.equal(await evaluate('document.body.dataset.back'), 'yes');
    assert.equal(await evaluate('getComputedStyle(document.documentElement).scrollbarWidth'), 'none');
    await fixture('www.netflix.com', `<button data-uia="control-audio-subtitle">Subtitles</button><button data-uia="subtitle-item-Off" aria-checked="false" onclick="this.setAttribute('aria-checked','true');document.querySelector('[data-uia=subtitle-item-English]').setAttribute('aria-checked','false')">Off</button><button data-uia="subtitle-item-English" aria-checked="true" onclick="this.setAttribute('aria-checked','true');document.querySelector('[data-uia=subtitle-item-Off]').setAttribute('aria-checked','false')">English</button>`, '/watch/123');
    await key('F9', ['control','shift']); assert.equal(await evaluate("document.querySelector('[data-uia=subtitle-item-Off]').getAttribute('aria-checked')"), 'true');
    await key('F9', ['control','shift']); assert.equal(await evaluate("document.querySelector('[data-uia=subtitle-item-English]').getAttribute('aria-checked')"), 'true');
    await fixture('www.netflix.com', '<button id="only">Browse</button>', '/browse');
    assert.equal(await evaluate('window.navigation.canGoBack'), false);
    await key('F8', ['control','shift']);
    assert.ok((await evaluate('document.title')).startsWith('[sofa:home]'), 'Back with no history must ask Sofa for home');
    // A real origin (answered locally, no network) so the page has genuine session history.
    wc.session.protocol.handle('https', () => new Response('<title>Browse</title><button id="only">Browse</button>', { headers: { 'content-type': 'text/html' } }));
    await new Promise(r => setTimeout(r, 1700));
    assert.equal(await evaluate('document.title'), '', 'The request must clear itself');
    await win.loadURL('https://sofa-remote.test/browse');
    await evaluate(`history.pushState({}, '', '/title/1'); new Function('location', ${JSON.stringify(script)})({ hostname: 'www.netflix.com', pathname: '/title/1' })`);
    await new Promise(r => setTimeout(r, 300)); // let the freshly loaded page take input
    await key('F8', ['control','shift']);
    await new Promise(r => setTimeout(r, 300));
    assert.equal(await evaluate('location.pathname'), '/browse', 'Back with history must go back in the app');
    assert.equal((await evaluate('document.title')).includes('[sofa:home]'), false);
    console.log('Browser remote: cards, row movement, OK, removed focus, native text editing, form navigation, modal scope, Fountain, player pass-through and Back-to-home passed');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
}).finally(() => rmSync(profile, { recursive: true, force: true }));
