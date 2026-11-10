<script lang="ts">
  import RemoteIcon from './lib/RemoteIcon.svelte';
  import { onMount, tick } from 'svelte';
  import type { ActionContext, ActionEvent, TileState } from '@shared/types';
  import Tile from './lib/Tile.svelte';
  import PowerMenu from './lib/PowerMenu.svelte';
  import SettingsMenu from './lib/SettingsMenu.svelte';
  import RemoteGuide from './lib/RemoteGuide.svelte';
  import ButtonTest from './lib/ButtonTest.svelte';
  import About from './lib/About.svelte';
  import PipMenu from './lib/PipMenu.svelte';
  import ContainersView from './lib/ContainersView.svelte';
  import { createClock } from './lib/clock.svelte';
  import { BACK_KEYS, moveFocus, moveRowFocus, moveWrappedFocus } from './lib/nav';
  import { keepOrder, orderCameras } from './lib/camera-order';

  /** `demo` (from the URL hash) opens a screen with fake data for the docs screenshots. */
  let { demo = null }: { demo?: string | null } = $props();

  type Screen = 'home' | 'guide' | 'button-test' | 'about' | 'pip' | 'containers';
  interface Guide { context: ActionContext; appName?: string }

  const COLS = 6;
  const clock = createClock();
  let machineName = $state('');
  let version = $state('');
  let apps = $state<TileState[]>([]);
  type RowId = 'apps' | 'games' | 'cameras';
  let focusRow = $state<RowId>('apps');
  const isLaunchApp = (app: TileState) => app.type !== 'camera' && app.group !== 'games';
  const launchApps = $derived(apps.filter(isLaunchApp));
  const gameApps = $derived(apps.filter(app => app.group === 'games'));
  /** Latest camera stills (data URLs) by tile id, kept fresh by main while Home is in front. */
  let cameraStills = $state<Record<string, string>>({});
  const cameraTiles = $derived(apps.filter(app => app.type === 'camera'));
  /** The Cameras row as last drawn: while focus is on (or returns to) that row its order holds still. */
  let shownCameraOrder: string[] = [];
  const cameraApps = $derived(focusRow === 'cameras'
    ? keepOrder(cameraTiles, shownCameraOrder)
    : orderCameras(cameraTiles, id => !!cameraStills[id]));
  $effect(() => { shownCameraOrder = cameraApps.map(app => app.id); });
  /** Apps always; Games and Cameras only when there are some. One row: the wrapped grid. */
  const rows = $derived([
    { id: 'apps' as RowId, label: 'Apps', cls: 'app-row', items: launchApps },
    ...(gameApps.length ? [{ id: 'games' as RowId, label: 'Games', cls: 'game-row', items: gameApps }] : []),
    ...(cameraApps.length ? [{ id: 'cameras' as RowId, label: 'Cameras', cls: 'camera-row', items: cameraApps }] : []),
  ]);
  const grid = $derived(rows.length === 1);
  /** Games but no cameras: the Apps grid still wraps (up to two rows of six), with the Games row below.
      More apps than that use the one-line rows instead, so nothing ever scrolls vertically. */
  const wrapped = $derived(!cameraApps.length && gameApps.length > 0 && launchApps.length <= COLS * 2);
  const rowIndex = $derived(Math.max(0, rows.findIndex(row => row.id === focusRow)));
  let focus = $state(0);
  let launchCovered = $state(false);
  let launchPending = $state(false);
  let footerFocus = $state<number | null>(null);
  /** Game artwork (data URLs), fetched once per game. */
  let gameArt = $state<Record<string, string>>({});
  const artRequested = new Set<string>();
  $effect(() => {
    for (const game of gameApps) {
      if (artRequested.has(game.id)) continue;
      artRequested.add(game.id);
      void window.sofa.gameArt(game.id).then(value => { if (value) gameArt[game.id] = value; }).catch(() => undefined);
    }
  });
  const footerButtons = [
    { action: 'cameraToggle', icon: 'red', label: 'Screen-in-screen' },
    { action: 'nodieTalk', icon: 'record', label: 'Nodie' },
    { action: 'menu', icon: 'menu', label: 'Menu' },
    { action: 'info', icon: 'info', label: 'Help' },
    { action: 'power', icon: 'power', label: 'Power' },
  ] as const;
  let power = $state(false);
  let menu = $state(false);
  let screen = $state<Screen>('home');
  let pipBaseId = $state<string | undefined>();
  let guide = $state<Guide>({ context: 'home' });
  const running = $derived(apps.filter((a) => a.running).length);
  const overlay = $derived(power || menu || screen !== 'home');
  $effect(() => { void window.sofa.overlayChanged(overlay); });
  $effect(() => {
    const selector = `.${rows[rowIndex]?.cls ?? 'app-row'} > .app-slot`;
    const index = focus;
    if (footerFocus !== null) return;
    void tick().then(() => document.querySelectorAll(selector)[index]?.scrollIntoView({block:'nearest',inline:'nearest'}));
  });

  function open(i: number, row: RowId = 'apps') {
    const a = rows.find(r => r.id === row)?.items[i];
    if (a && !launchCovered && !launchPending) {
      // Lock immediately, before the round trip to main can report the cover.
      launchPending = true;
      void window.sofa.openApp(a.id).finally(() => { launchPending = false; });
    }
  }

  function openGuide(g: Guide) {
    power = menu = false;
    guide = g;
    screen = 'guide';
  }

  function closeGuide() {
    screen = 'home';
    void window.sofa.guideClosed(); // main returns to the app the guide was opened over, if any
  }

  function goHome() {
    launchPending = false;
    footerFocus = null;
    if (focusRow !== 'apps') { focusRow = 'apps'; focus = Math.min(focus, Math.max(0, launchApps.length - 1)); }
    power = menu = false;
    screen = 'home';
  }

  function onAction(e: ActionEvent) {
    switch (e.action) {
      case 'cameraToggle':
        power = menu = false;
        pipBaseId = e.appId;
        screen = 'pip';
        return;
      case 'back':
        if (screen === 'button-test') return;
        // Use the same window handlers as keyboard Back, including the active overlay.
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
        return;
      case 'home':
        return goHome();
      case 'power':
        menu = false;
        if (screen !== 'home') screen = 'home';
        power = !power;
        return;
      case 'menu':
        power = false;
        if (screen !== 'home') screen = 'home';
        menu = !menu;
        return;
      case 'info':
        if (screen === 'guide') closeGuide();
        else openGuide({ context: e.context, appName: e.appName });
        return;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (launchCovered || launchPending) { e.preventDefault(); return; }
    if (overlay) return; // the open screen handles its own keys
    // A held OK / digit / Back must not fire repeatedly (arrows may repeat, for scrolling).
    if (e.repeat && !e.key.startsWith('Arrow')) return e.preventDefault();
    if (e.key.startsWith('Arrow')) {
      if (wrapped) {
        const next = moveWrappedFocus({ row: rowIndex, index: focus, footer: footerFocus }, e.key, [launchApps.length, gameApps.length], COLS, footerButtons.length);
        focusRow = rows[next.row]?.id ?? 'apps';
        focus = next.index;
        footerFocus = next.footer;
      } else if (!grid) {
        // Single-line rows (Apps, Games, Cameras) above the footer.
        const next = moveRowFocus({ row: rowIndex, index: focus, footer: footerFocus }, e.key, rows.map(row => row.items.length), footerButtons.length);
        focusRow = rows[next.row]?.id ?? 'apps';
        focus = next.index;
        footerFocus = next.footer;
      } else if (footerFocus !== null) {
        if (e.key === 'ArrowLeft') footerFocus = Math.max(0, footerFocus - 1);
        else if (e.key === 'ArrowRight') footerFocus = Math.min(footerButtons.length - 1, footerFocus + 1);
        else if (e.key === 'ArrowUp') footerFocus = null;
      } else if (e.key === 'ArrowDown' && (launchApps.length === 0 || Math.floor(focus / COLS) === Math.floor((launchApps.length - 1) / COLS))) {
        footerFocus = Math.min(focus % COLS, footerButtons.length - 1);
      } else focus = moveFocus(focus, e.key, launchApps.length, COLS);
    } else if (e.key === 'Enter') {
      if (footerFocus !== null) {
        const action = footerButtons[footerFocus]!.action;
        if (action === 'cameraToggle') void window.sofa.pipShow();
        else void window.sofa.activateAction(action);
      }
      else open(focus, focusRow);
    } else if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
      const i = Number(e.key) - 1;
      if (i < launchApps.length) { footerFocus = null; focusRow = 'apps'; focus = i; open(i); }
    } else if (BACK_KEYS.has(e.key)) {
      void window.sofa.returnToLastApp();
    } else return;
    e.preventDefault();
  }

  onMount(() => {
    void window.sofa.appearance().then((state) => { version = state.version; machineName = state.hostname ?? ''; });
    void window.sofa.listApps().then((a) => (apps = a));
    const offApps = window.sofa.onApps((a) => {
      apps = a;
      // Keep focus on a tile that still exists (a row can empty, e.g. a game uninstalled).
      const inRow = (row: RowId) => a.filter(app => row === 'apps' ? isLaunchApp(app) : row === 'games' ? app.group === 'games' : app.type === 'camera').length;
      if (focusRow !== 'apps' && inRow(focusRow) === 0) focusRow = 'apps';
      const length = inRow(focusRow);
      if (focus >= length) focus = Math.max(0, length - 1);
    });
    const offCover = window.sofa.onLaunchCover(covered => {
      launchCovered = covered;
      if (!covered) launchPending = false;
    });
    const offAction = window.sofa.onAction(onAction);
    // The Docker tile (opened here, from the panel or `sofa-launcher open`): main shows Home, then this.
    const offContainers = window.sofaContainers.onShow(() => { power = menu = false; screen = 'containers'; });
    // Artwork downloaded after the tile was first drawn.
    const offArt = window.sofa.onGameArt(({ appId, value }) => { gameArt[appId] = value; });
    void window.sofa.cameraStills().then(stills => { cameraStills = { ...stills, ...cameraStills }; }).catch(() => undefined);
    const offStill = window.sofa.onCameraStill(({ appId, value }) => {
      if (value) cameraStills[appId] = value;
      else delete cameraStills[appId];
    });
    if (demo === 'button-test') screen = 'button-test';
    else if (demo === 'guide') openGuide({ context: 'app', appName: 'Netflix' });
    else if (demo === 'menu' || demo === 'edit-home') menu = true;
    else if (demo === 'pip') screen = 'pip';
    else if (demo === 'containers') screen = 'containers';
    return () => { offApps(); offCover(); offAction(); offArt(); offStill(); offContainers(); clock.stop(); };
  });
</script>

<svelte:window {onkeydown} />

<main class:rows={!grid && !wrapped} class:wrapped class:has-games={gameApps.length > 0 && !wrapped} class:compact={rows.length > 2}>
  <header>
    <div class="greet">{clock.greeting}<small>{machineName ? `${machineName} · ` : ''}{running} {running === 1 ? 'app' : 'apps'} running</small></div>
    <div class="clock">{clock.time}<small>{clock.date}</small></div>
  </header>

  {#each rows as row (row.id)}
    {#if row.id !== 'apps'}<h2>{row.label}</h2>{/if}
    <section class="row {row.cls}" aria-label={row.label}>
      {#each row.items as app, i (app.id)}
        <!-- Only apps take the 1-9 numbers. -->
        <div class="app-slot"><Tile {app} index={row.id === 'apps' ? i : 99} art={row.id === 'cameras' ? cameraStills[app.id] : gameArt[app.id]} focused={footerFocus === null && focusRow === row.id && i === focus} onclick={() => { footerFocus = null; focusRow = row.id; focus = i; open(i, row.id); }} /></div>
      {:else}
        <p class="empty">No apps yet. Add some to <code>~/.config/sofa-launcher/config.toml</code>.</p>
      {/each}
    </section>
  {/each}

  <footer class="hints">
    <span><span class="k">1–9</span>Apps</span>
    {#each footerButtons as button, index}
      <button class="footer-button" class:right={button.action === 'power'} class:focused={footerFocus === index} onclick={() => { footerFocus = index; if (button.action === 'cameraToggle') void window.sofa.pipShow(); else void window.sofa.activateAction(button.action); }}><span class="k"><RemoteIcon name={button.icon} /></span>{button.label}</button>
    {/each}
    <span class="version">v{version}</span>
  </footer>
</main>

{#if power}<PowerMenu onclose={() => (power = false)} />{/if}
{#if menu}
  <SettingsMenu
    onclose={() => (menu = false)}
    initial={demo === 'edit-home' ? 'edit-home' : undefined}
    onchoose={(id) => { if (id === 'guide') openGuide({ context: 'home' }); else screen = id; }}
  />
{/if}
{#if screen === 'guide'}<RemoteGuide context={guide.context} appName={guide.appName} onclose={closeGuide} />{/if}
{#if screen === 'button-test'}<ButtonTest demo={demo === 'button-test'} onclose={() => (screen = 'home')} />{/if}
{#if screen === 'about'}<About onclose={() => (screen = 'home')} />{/if}
{#if screen === 'containers'}<ContainersView onclose={() => (screen = 'home')} />{/if}
{#if screen === 'pip'}<PipMenu {apps} initialBaseId={pipBaseId} onclose={() => (screen = 'home')} />{/if}

<style>
  main { position: relative; height: 100%; padding: 3.2rem 4rem; }
  header { display: flex; justify-content: space-between; align-items: baseline; }
  .greet { font-size: 2.6rem; font-weight: 600; letter-spacing: -0.02em; }
  .greet small { display: block; font-size: 1.25rem; font-weight: 400; color: var(--muted); margin-top: 0.3rem; }
  .clock { font-size: 3.2rem; font-weight: 300; letter-spacing: -0.03em; }
  .clock small { font-size: 1.2rem; color: var(--muted); margin-left: 0.6rem; }
  .row { margin-top: 7rem; display: grid; grid-template-columns: repeat(6, 1fr); gap: 3rem 1.6rem; }
  /* Two or three rows (Apps plus Games and/or Cameras): each is one line that scrolls sideways,
     and the focus ring sits inside the tile so the scrolling row can never clip it. */
  .rows .row { grid-template-columns:none; grid-auto-flow:column; grid-auto-columns:calc((100% - 7.6rem) / 5); gap:1.6rem; overflow-x:auto; scrollbar-width:none; padding:1rem .6rem; margin-top:2rem; }
  .rows h2 + .row { margin-top:0; }
  .rows .row :global(.focused .tile) { transform:none; box-shadow:none; --inner-ring:block; }
  /* With games, rows keep the focused tile clear of the edges (scroll-padding) and fade tiles
     that are only partly in view, like the slide-up panel; the negative margin keeps alignment. */
  .has-games .row { padding:1rem 1.6rem; margin-inline:-1rem; scroll-padding-inline:1.6rem;
                    mask-image:linear-gradient(90deg, transparent 0, #000 1rem, #000 calc(100% - 1rem), transparent 100%); }
  /* Three rows: smaller tiles so everything fits on a 16:9 screen above the footer. */
  .compact .row { grid-auto-columns:calc((100% - 5 * 1.2rem - 1rem) / 6); gap:1.2rem; padding-block:.7rem .5rem; margin-top:1.2rem; }
  .compact .row :global(.slot) { --ts:.8; }
  .compact .row :global(.camera) { width:2.9rem; height:2.9rem; }
  .compact h2 { margin-top:.5rem; font-size:1.25rem; }
  /* Games, no cameras: the plain home's six-column Apps grid, closer to the header, then the
     Games row lined up with it and scrolling sideways. Both use the inner focus ring (no scaling),
     so the scrolling row can't clip it and the two rows look alike. */
  .wrapped .row { margin-top:1rem; gap:1rem 1.6rem; padding:.5rem 1rem; margin-inline:-1rem; }
  .wrapped .game-row { grid-template-columns:none; grid-auto-flow:column; grid-auto-columns:calc((100% - 5 * 1.6rem) / 6);
                       overflow-x:auto; scrollbar-width:none; scroll-padding-inline:1rem; margin-top:.2rem;
                       mask-image:linear-gradient(90deg, transparent 0, #000 1rem, #000 calc(100% - 1rem), transparent 100%); }
  .wrapped h2 { margin-top:.4rem; }
  .wrapped .row :global(.focused .tile) { transform:none; box-shadow:none; --inner-ring:block; }
  .camera-row :global(.focused .tile) { background:var(--accent); color:var(--accent-contrast); }
  h2 { margin:1.2rem 0 0 .6rem; font-size:1.5rem; color:var(--muted); }
  .empty { grid-column: 1 / -1; font-size: 1.6rem; color: var(--muted); }
  .hints { position: absolute; left: 0; right: 0; bottom: 0; padding: 1.3rem 4rem; display: flex; gap: 2.4rem;
           font-size: 1.2rem; color: #9aa4b6; background: linear-gradient(transparent, rgba(0, 0, 0, 0.55)); }
  .version { align-self: center; font-size: 0.95rem; color: var(--muted); }
  .right { margin-left: auto; }
  .footer-button { all:unset; display:inline-flex; align-items:center; border-radius:0.6rem; padding:0.4rem 0.6rem; margin:-0.4rem -0.6rem; }
  .footer-button.right { margin-left:auto; }
  .footer-button.focused { background:var(--accent); color:var(--accent-contrast); box-shadow:0 0 0 0.16rem var(--focus-ring),0 0 1.2rem var(--accent-glow); font-weight:700; }
  .k { display: inline-flex; align-items: center; justify-content: center; min-width: 1.8rem; height: 1.8rem; padding: 0 0.5rem;
       margin-right: 0.5rem; border-radius: 0.5rem; background: #222a38; color: #fff; font-weight: 700; font-size: 1rem; }
</style>
