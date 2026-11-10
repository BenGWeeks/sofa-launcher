/* Runs only in Sofa's separate browser profiles, with no extension API permissions. */
(() => {
  if (window !== window.top || document.getElementById('sofa-remote-focus')) return;
  const style = document.createElement('style');
  style.textContent = 'html[data-sofa-remote-keys],html[data-sofa-remote-keys] *{cursor:none!important}[data-sofa-menu-closed]{visibility:hidden!important;opacity:0!important;pointer-events:none!important}[data-sofa-menu-open]{visibility:visible!important;opacity:1!important;pointer-events:auto!important}';
  // TV users scroll with arrows/CH or the mouse; desktop scrollbars cover video.
  if (location.hostname.endsWith('netflix.com') || location.hostname.endsWith('primevideo.com')) {
    style.textContent += 'html,body{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}';
  }
  const ring = document.createElement('div');
  ring.id = 'sofa-remote-focus';
  ring.setAttribute('aria-hidden', 'true');
  Object.assign(ring.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', border: '4px solid #9DFF0A', outline: '2px solid white', borderRadius: '8px', boxShadow: '0 0 16px #9DFF0A', boxSizing: 'border-box', display: 'none' });
  document.documentElement.append(style, ring);
  let selected = null;
  let frame = 0;
  const selector = 'a[href],button,input,textarea,select,[role="button"],[role="tab"],[role="menuitem"],[role="option"],[tabindex]';
  const prime = location.hostname.endsWith('primevideo.com');
  const fountain = location.hostname === 'fountain.fm';
  const tidal = ['tidal.com', 'listen.tidal.com'].includes(location.hostname);
  let subtitleBusy = false;
  let lastSubtitle = '';
  async function subtitles() {
    if (subtitleBusy || !location.hostname.endsWith('netflix.com') || !/\/watch\//.test(location.pathname)) return;
    const menu = document.querySelector('[data-uia="control-audio-subtitle"]');
    if (!menu) return;
    subtitleBusy = true;
    try {
      menu.click();
      for (let attempt = 0; attempt < 10; attempt++) {
        const items = [...document.querySelectorAll('[data-uia^="subtitle-item-"]')].filter(visible);
        if (items.length) {
          const off = items.find(item => item.textContent.trim().toLowerCase() === 'off' || /-off$/i.test(item.dataset.uia));
          const selected = items.find(item => item.getAttribute('aria-checked') === 'true' || item.getAttribute('aria-selected') === 'true' || item.querySelector('[data-uia="track-selected"],svg') || /(?:^|\s)selected(?:\s|$)/.test(item.className));
          const showing = selected ? selected !== off : Boolean(document.querySelector('.player-timedtext')?.textContent.trim());
          if (showing && selected) lastSubtitle = selected.dataset.uia;
          const target = showing ? off : items.find(item => item !== off && item.dataset.uia === lastSubtitle) || items.find(item => item !== off && /english/i.test(item.textContent)) || items.find(item => item !== off);
          if (target) target.click();
          if (items.some(visible)) menu.click();
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } finally { subtitleBusy = false; }
  }
  function editable(el) { return el?.closest('input,textarea,select,[contenteditable="true"],video,audio'); }
  function player() { return /\/(watch|video\/watch)\//.test(location.pathname) || document.fullscreenElement?.querySelector('video'); }
  function visible(el) {
    if (el.closest('[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]') || el.disabled) return false;
    const rect = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return rect.width > 6 && rect.height > 6 && css.visibility === 'visible' && css.display !== 'none' && Number(css.opacity) > 0;
  }
  function card(el) {
    if (prime) return el.closest('article[data-testid="card"]');
    if (tidal && el.closest('main')) {
      const item = el.closest('[role="presentation"][data-test]');
      if (item && /-card-/.test(item.dataset.test)) return item;
      return el.closest('[data-test="shortcut-list"] > div');
    }
    return null;
  }
  function candidates() {
    const dialogs = Array.from(document.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"],[role="menu"],[role="listbox"]')).filter(visible);
    const scope = dialogs.at(-1) || document;
    const cards = prime ? Array.from(scope.querySelectorAll('article[data-testid="card"]')) : tidal ? Array.from(scope.querySelectorAll('main [role="presentation"][data-test],main [data-test="shortcut-list"] > div')).filter(el => /-card-/.test(el.dataset.test || '') || el.parentElement?.dataset.test === 'shortcut-list') : [];
    const targets = Array.from(scope.querySelectorAll(selector)).filter(el => {
      if (!visible(el) || (el.getAttribute('tabindex') === '-1' && !el.matches('[role="menuitem"],[role="option"]'))) return false;
      // Prime cards contain hover controls and duplicate links. Select one title
      // per card; OK opens its details instead of getting trapped inside a card.
      if (card(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width > innerWidth * .7 && r.height > innerHeight * .4) return false;
      const x = Math.min(innerWidth - 1, Math.max(1, r.x + r.width / 2));
      const y = r.y + r.height / 2;
      if (y > 0 && y < innerHeight && r.right > 0 && r.left < innerWidth) {
        const top = document.elementFromPoint(x, y);
        if (top && !el.contains(top) && !top.contains(el)) return false;
      }
      return true;
    });
    for (const item of cards) {
      const link = item.querySelector(prime ? 'a[href*="/detail/"]' : 'a[href]');
      if (link && visible(link)) targets.push(link);
    }
    return targets;
  }
  function paint() {
    frame = 0;
    if (!selected?.isConnected || !visible(selected)) { ring.style.display = 'none'; return; }
    const r = (card(selected) || selected).getBoundingClientRect();
    Object.assign(ring.style, { display: 'block', left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(paint); }
  function select(el) {
    selected = el;
    if (!el.hasAttribute('tabindex') && !el.matches('a,button,input,textarea,select')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    // TIDAL's fixed footer covers the bottom of its scroll viewport. Center
    // content cards so they stay visible and remain eligible on the next key.
    (card(el) || el).scrollIntoView({ block: tidal && el.closest('main') ? 'center' : 'nearest', inline: 'nearest', behavior: 'instant' });
    schedule();
  }
  function move(key) {
    const items = candidates();
    if (!items.length) return;
    const current = items.includes(selected) ? selected : editable(document.activeElement) && items.includes(document.activeElement) ? document.activeElement : null;
    if (!current) {
      const inView = items.filter(el => { const r = el.getBoundingClientRect(); return r.bottom > 60 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; });
      const firstCard = key === 'ArrowDown' && inView.find(el => card(el) || (fountain && el.matches('a[href^="/episode/"],a[href^="/podcast/"]')));
      select(firstCard || inView[0] || items[0]); return;
    }
    const r = (card(current) || current).getBoundingClientRect();
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    const forward = key === 'ArrowRight' || key === 'ArrowDown';
    let best = null, bestScore = Infinity;
    const mainItems = tidal && !horizontal && current.closest('main') ? items.filter(el => {
      if (!el.closest('main')) return false;
      const b = (card(el) || el).getBoundingClientRect();
      return forward ? b.y + b.height / 2 > r.y + r.height / 2 + 4 : b.y + b.height / 2 < r.y + r.height / 2 - 4;
    }) : [];
    for (const el of mainItems.length ? mainItems : items) {
      if (el === current) continue;
      const b = (card(el) || el).getBoundingClientRect();
      const along = horizontal ? b.x + b.width / 2 - r.x - r.width / 2 : b.y + b.height / 2 - r.y - r.height / 2;
      if (forward ? along <= 4 : along >= -4) continue;
      const cross = horizontal ? Math.abs(b.y + b.height / 2 - r.y - r.height / 2) : Math.abs(b.x + b.width / 2 - r.x - r.width / 2);
      const overlap = horizontal ? Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) : Math.min(r.right, b.right) - Math.max(r.left, b.left);
      const score = Math.abs(along) + cross * 2 + (overlap <= 0 ? 1000 : 0);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) select(best);
  }
  function collectionMenu() { return document.querySelector('[data-test="sidebar-collection-menu"]')?.parentElement.querySelector('[role="menu"]'); }
  function openCollection() {
    if (!tidal || selected?.dataset.test !== 'sidebar-collection-menu') return false;
    const menu = collectionMenu();
    if (!menu) return false;
    delete menu.dataset.sofaMenuClosed;
    menu.dataset.sofaMenuOpen = '';
    const first = [...menu.querySelectorAll(selector)].find(visible);
    if (first) select(first);
    return true;
  }
  function dismissTidalMenu() {
    if (!tidal) return false;
    const menu = [...document.querySelectorAll('[role="menu"],[role="listbox"]')].filter(visible).at(-1);
    if (!menu) return false;
    // Collection is a CSS hover menu: native Escape does not dismiss it while
    // the mouse is parked over its trigger. Own its open state for remote use.
    if (menu === collectionMenu()) {
      delete menu.dataset.sofaMenuOpen;
      menu.dataset.sofaMenuClosed = '';
      const trigger = document.querySelector('[data-test="sidebar-collection-menu"]');
      if (trigger) select(trigger);
    } else document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', code:'Escape', bubbles:true, cancelable:true }));
    return true;
  }
  // Sofa reads the window title just after sending Back: this prefix means "nothing
  // left to go back to here, show the launcher's home screen".
  function requestHome() {
    const marker = '[sofa:home]';
    if (document.title.startsWith(marker)) return;
    const title = document.title;
    document.title = `${marker} ${title}`;
    setTimeout(() => { if (document.title.startsWith(marker)) document.title = title; }, 1500);
  }
  window.addEventListener('keydown', e => {
    if (tidal && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && ['F9','F7','F10','F11'].includes(e.key)) {
      e.preventDefault(); e.stopImmediatePropagation();
      const selector = {F9:'[data-test="play"],[data-test="pause"]',F7:'[data-test="pause"]',F10:'[data-test="next"]',F11:'[data-test="previous"]'}[e.key];
      if (!e.repeat) document.querySelector('[data-test="play-controls"]')?.querySelector(selector)?.click();
      return;
    }
    if (tidal && ['ArrowRight','Enter'].includes(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey && openCollection()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (tidal && ['ArrowLeft','ArrowRight'].includes(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey && dismissTidalMenu()) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === 'ArrowRight') requestAnimationFrame(() => move('ArrowRight'));
      return;
    }
    if (e.key === 'F9' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) void subtitles(); return;
    }
    if (e.key === 'F8' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      if (dismissTidalMenu()) return;
      // Prefer the app's own navigation (Netflix's player uses an SPA route).
      const back = Array.from(document.querySelectorAll('[data-uia="player-back-to-browse"],[data-uia="back-to-browse"],.button-nfplayerBack,button[aria-label="Back"],a[aria-label="Back"]')).find(visible);
      if (back) back.click();
      else if (window.navigation ? navigation.canGoBack : history.length > 1) history.back();
      else requestHome();
      return;
    }
    if (tidal && ['MediaFastForward','MediaRewind'].includes(e.key)) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) document.querySelector(e.key === 'MediaFastForward' ? '[data-test="next"]' : '[data-test="previous"]')?.click();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey || player()) return;
    const field = editable(e.target);
    // Keep text editing native. Up/Down can leave a single-line field for the
    // next form control; ranges, select boxes and multiline editors own arrows.
    if (field && !(field.tagName === 'INPUT' && !['range', 'number', 'date', 'time'].includes(field.type) && ['ArrowUp', 'ArrowDown'].includes(e.key))) return;
    if (e.key.startsWith('Arrow')) {
      e.preventDefault(); e.stopImmediatePropagation();
      document.documentElement.setAttribute('data-sofa-remote-keys', '');
      if (tidal) { const menu = collectionMenu(); if (menu && !menu.hasAttribute('data-sofa-menu-open')) menu.dataset.sofaMenuClosed = ''; }
      move(e.key);
    } else if (e.key === 'Enter' && selected?.isConnected && document.activeElement === selected) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) selected.click();
    }
  }, true);
  window.addEventListener('mousemove', () => { document.documentElement.removeAttribute('data-sofa-remote-keys'); document.querySelectorAll('[data-sofa-menu-closed],[data-sofa-menu-open]').forEach(menu => { delete menu.dataset.sofaMenuClosed; delete menu.dataset.sofaMenuOpen; }); ring.style.display = 'none'; selected = null; }, { passive: true });
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  new MutationObserver(() => {
    if (selected && !selected.isConnected) { selected = null; ring.style.display = 'none'; }
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('focusin', e => {
    if (editable(e.target)) { selected = null; ring.style.display = 'none'; }
  });
})();
