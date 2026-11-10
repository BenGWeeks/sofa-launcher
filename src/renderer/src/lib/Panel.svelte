<script lang="ts">
  import RemoteIcon from './RemoteIcon.svelte';
  import { onMount, tick } from 'svelte';
  import type { PanelState, TileState, PipState } from '@shared/types';
  import Tile from './Tile.svelte';
  import Keyboard from './Keyboard.svelte';
  import { BACK_KEYS, movePanelFocus, type PanelFocus } from './nav';

  /**
   * The slide-up panel: lives in its own transparent window over the bottom third
   * of the screen while an app keeps playing. `demo` draws a fake video behind it.
   */
  let { demo = null }: { demo?: string | null } = $props();

  let allApps = $state<TileState[]>([]);
  /** Games stay on the home screen's Games row only (they would also take the 1-9 numbers here). */
  const apps = $derived(allApps.filter(app => app.group !== 'games'));
  let currentAppId = $state<string | null>(null);
  let keyboard = $state(false);
  let pip = $state<PipState>({ active: false });
  let selectingScreen = $state(false);
  let selectedScreen = $state<'base' | 'inset'>('base');
  const mainApp = $derived(apps.find(a => a.id === pip.baseId));
  const insetApp = $derived(apps.find(a => a.id === pip.insetId));
  const insetWidth = $derived([30, 40, 50][pip.size ?? 0] ?? 30);
  const insetRight = $derived([0, 3].includes(pip.corner ?? 0));
  const insetBottom = $derived((pip.corner ?? 0) < 2);
  let focus = $state<PanelFocus>({ row: 0, index: 0 });
  $effect(() => {
    const row = focus.row;
    const index = focus.index;
    void tick().then(() => {
      document.querySelectorAll(row === 0 ? '.tiles > .slot' : '.actions > button')[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  });
  const current = $derived(allApps.find((a) => a.id === currentAppId) ?? null);
  const actions = $derived([
    { id: 'close', icon: 'M6 6l12 12M18 6L6 18', label: current ? `Close ${current.name}` : 'Close app', enabled: !!current },
    { id: 'pointer', icon: 'M4 3l6 17 3-7 7-3z', label: 'Remote pointer', enabled: !!current },
    { id: 'keyboard', icon: 'M3 6h18v12H3zM7 10h1m3 0h1m3 0h1M7 14h10', label: 'Keyboard / mic', enabled: !!current },
    { id: 'pip', icon: 'M3 4h18v16H3zM12 11h7v7h-7z', label: 'Screen-in-screen', enabled: true },
    ...(pip.active ? [
      { id: 'close-inset', icon: 'M6 6l12 12M18 6L6 18', label: 'Close second screen', enabled: true },
      { id: pip.expanded ? 'shrink' : 'browse', icon: 'M3 4h18v16H3z', label: pip.expanded ? 'Return to small screen' : 'Browse second screen', enabled: true },
    ] : []),
    { id: 'nodie', icon: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM19 12a7 7 0 0 1-14 0M12 19v3', label: 'Talk to Nodie', enabled: true },
    { id: 'guide', icon: '', label: 'Remote guide', enabled: true },
  ]);

  function apply(state: PanelState) {
    allApps = state.apps;
    currentAppId = state.currentAppId;
    pip = state.pip ?? (demo === 'pip' ? { active: true, baseId: 'netflix', insetId: 'jellyfin', focused: 'base', corner: 0, size: 0 } : { active: false });
    selectingScreen = false;
    selectedScreen = pip.focused ?? 'base';
    const i = state.apps.filter(app => app.group !== 'games').findIndex((a) => a.id === currentAppId);
    focus = { row: 0, index: i >= 0 ? i : 0 };
  }

  function choose() {
    if (focus.row === 0) {
      const a = apps[focus.index];
      if (a) void window.sofa.openApp(a.id);
    } else if (actions[focus.index]?.id === 'close' && current) {
      void window.sofa.closeApp(current.id);
    } else if (focus.row === 1 && actions[focus.index]?.id === 'nodie') {
      void window.sofa.panelTalk();
    } else if (focus.row === 1 && actions[focus.index]?.id === 'guide') {
      void window.sofa.panelGuide();
    } else if (focus.row === 1 && actions[focus.index]?.id === 'pointer' && current) {
      void window.sofa.panelPointer();
    } else if (focus.row === 1 && actions[focus.index]?.id === 'keyboard' && current) {
      void window.sofa.keyboardOpen();
    } else if (focus.row === 1 && actions[focus.index]?.id === 'pip') {
      void window.sofa.pipShow();
    } else if (focus.row === 1 && ['close-inset', 'browse', 'shrink'].includes(actions[focus.index]?.id ?? '')) {
      void window.sofa.pipControl(actions[focus.index]!.id as 'close-inset' | 'browse' | 'shrink');
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (keyboard) return;
    if (e.repeat && !e.key.startsWith('Arrow')) return e.preventDefault();
    if (pip.active && selectingScreen) {
      if (e.key === 'Enter') void window.sofa.pipControl(selectedScreen);
      else if (e.key === 'ArrowDown' && selectedScreen === 'inset') selectingScreen = false;
      else if (e.key.startsWith('Arrow')) {
        const towardsInset = e.key === (insetRight ? 'ArrowRight' : 'ArrowLeft') || e.key === (insetBottom ? 'ArrowDown' : 'ArrowUp');
        selectedScreen = towardsInset ? 'inset' : 'base';
      } else if (BACK_KEYS.has(e.key)) void window.sofa.panelDismiss();
      else return;
      e.preventDefault(); return;
    }
    if (pip.active && e.key === 'ArrowUp' && focus.row === 0) { selectingScreen = true; e.preventDefault(); return; }
    // Up from the top row leaves the panel, back to what's playing above it.
    if (e.key === 'ArrowUp' && focus.row === 0) { if (!e.repeat) void window.sofa.panelDismiss(); e.preventDefault(); return; }
    if (e.key.startsWith('Arrow')) focus = movePanelFocus(focus, e.key, apps.length, actions.length);
    else if (e.key === 'Enter') choose();
    else if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
      const a = apps[Number(e.key) - 1];
      if (a) void window.sofa.openApp(a.id);
    } else if (BACK_KEYS.has(e.key)) void window.sofa.panelDismiss();
    else return;
    e.preventDefault();
  }

  onMount(() => {
    const offKeyboard = window.sofa.onKeyboard((visible) => keyboard = visible);
    const offPanel = window.sofa.onPanel(apply);
    const offPip = window.sofa.onPip(value => { pip = value; if (!value.active) selectingScreen = false; });
    const offAction = window.sofa.onAction((e) => {
      if (e.action === 'back') onkeydown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    const offApps = window.sofa.onApps((a) => (allApps = a));
    void window.sofa.listApps().then((a) => apply({ apps: a, currentAppId: demo ? 'netflix' : currentAppId }));
    return () => { offKeyboard(); offPanel(); offApps(); offAction(); offPip(); };
  });
</script>

<svelte:window {onkeydown} />

{#if demo}<div class="video"></div>{/if}

{#if pip.active && selectingScreen && !keyboard}
  <div class="screen-selection" aria-label="Choose screen to control">
    <button class="main-screen" class:selected={selectedScreen === 'base'} onclick={() => void window.sofa.pipControl('base')}><span>Control {mainApp?.name ?? 'main app'}</span></button>
    <button class="inset-screen" class:selected={selectedScreen === 'inset'} style:width={pip.expanded ? 'calc(100vw - 1rem)' : `min(${insetWidth}vw, calc((100vh - 3vw) * 16 / 9))`} style:height={pip.expanded ? 'calc(100vh - 1rem)' : null} style:left={pip.expanded ? '.5rem' : insetRight ? 'auto' : '1.5vw'} style:right={pip.expanded ? 'auto' : insetRight ? '1.5vw' : 'auto'} style:top={pip.expanded ? '.5rem' : insetBottom ? 'auto' : '1.5vw'} style:bottom={pip.expanded ? 'auto' : insetBottom ? '1.5vw' : 'auto'} onclick={() => void window.sofa.pipControl('inset')}><span>Control {insetApp?.name ?? 'inset app'}</span></button>
    <p class="screen-help">Arrows choose a screen · OK controls it · Down from inset opens app controls · Back cancels</p>
  </div>
{/if}

<div class="panel" class:screen-selecting={pip.active && selectingScreen && !keyboard} class:demo class:keyboard-open={keyboard} role="dialog" aria-label="Launcher panel">
  {#if keyboard}
    <Keyboard />
  {:else}
  <div class="head">
    <span class="title">Sofa Launcher{#if current}<small> · watching <b>{current.name}</b></small>{/if}</span>
    <span class="hints">
      <span>{#if pip.active}Up chooses a screen{:else}Up returns to {current?.name ?? 'the app'}{/if} · <span class="k"><RemoteIcon name="menu" />/<RemoteIcon name="back" /></span>Menu/Back close · <span class="k"><RemoteIcon name="home" /></span>Home</span>
    </span>
  </div>
  <div class="tiles">
    {#each apps as app, i (app.id)}
      <div class="slot" class:now={app.id === currentAppId}>
        <Tile {app} index={i} focused={focus.row === 0 && i === focus.index} onclick={() => { focus = { row: 0, index: i }; choose(); }} />
        {#if app.id === currentAppId}<span class="badge"><RemoteIcon name="play" /> now</span>{/if}
      </div>
    {/each}
  </div>
  <div class="actions">
    {#each actions as a, i (a.id)}
      <button class="act" class:f={focus.row === 1 && i === focus.index} class:off={!a.enabled} tabindex="-1"
              onclick={() => { focus = { row: 1, index: i }; choose(); }}>
        {#if a.id === 'guide'}<RemoteIcon name="info" />{:else if a.id === 'nodie'}<RemoteIcon name="record" />{:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d={a.icon} /></svg>{/if}{a.label}
      </button>
    {/each}
  </div>
  {/if}
</div>

<style>
  .panel.screen-selecting { visibility:hidden; }
  .screen-selection { position:fixed; inset:0; z-index:5; pointer-events:none; }
  .screen-selection button { position:fixed; background:transparent; border:.2rem solid #667080; border-radius:1rem; pointer-events:auto; color:white; }
  .main-screen { inset:.5rem; }
  .inset-screen { aspect-ratio:16 / 9; }
  .screen-selection .selected { border:.3rem solid var(--accent); box-shadow:0 0 1.2rem var(--accent-glow), inset 0 0 1.2rem var(--accent-glow); }
  .screen-selection span { position:absolute; left:1rem; top:1rem; padding:.6rem 1rem; border-radius:.5rem; background:#141922; font-size:1.4rem; font-weight:700; }
  .screen-selection .selected span { background:var(--accent); color:var(--accent-contrast); }
  .screen-help { position:fixed; top:4rem; left:4rem; background:#141922; color:white; border-radius:.5rem; padding:.7rem 1rem; font-size:1.1rem; }
  /* Demo backdrop: pretend video, so the screenshot shows the panel in context. */
  .video { position: fixed; inset: 0; background:
    radial-gradient(60% 80% at 70% 40%, rgba(255, 170, 80, 0.35), transparent 60%),
    radial-gradient(50% 70% at 20% 70%, rgba(30, 90, 160, 0.45), transparent 60%),
    linear-gradient(180deg, #1a1410, #2a1c14 50%, #0e0a08); }

  /* A little over a third of the screen: room for tiles big enough to read from the sofa. */
  .panel { position: fixed; left: 0; right: 0; bottom: 0; height: 35%; padding: 1.2rem 4rem 1.1rem; display: flex; flex-direction: column; gap: 0.5rem;
           background: linear-gradient(rgba(5, 7, 10, 0) 0%, rgba(5, 7, 10, 0.94) 14%, #07090d 70%); }
  .panel.demo { height: 35%; }
  .panel.keyboard-open { height: 62%; }
  .head { display: flex; justify-content: space-between; align-items: baseline; }
  .title { font-size: 1.5rem; font-weight: 600; }
  .title small { font-size: 1.15rem; font-weight: 400; color: var(--muted); margin-left: 0.3rem; }
  .title b { color: #fff; font-weight: 600; }
  .hints { display: flex; gap: 2rem; font-size: 1.1rem; color: #9aa4b6; }
  .k { display: inline-flex; align-items: center; justify-content: center; min-width: 1.7rem; height: 1.7rem; padding: 0 0.45rem; margin-right: 0.5rem;
       border-radius: 0.45rem; background: #222a38; color: #fff; font-weight: 700; font-size: 0.95rem; }
  /* Smaller tiles: the home tiles scaled down (--ts), so they look the same. Sized to fill the panel
     between the title and the buttons, with about seven and a half in view so the next one peeks in. */
  /* The row scrolls sideways. Side padding (kept clear by scroll-padding) leaves room for the focused
     tile's enlarged ring at either end; the mask fades tiles that are only partly in view, so
     nothing is cut off with a hard edge. The negative margin keeps the first tile under the title. */
  .tiles { --ts: 0.58; display: grid; grid-auto-flow: column; grid-auto-columns: 11.2rem; gap: 1.2rem; padding: 0.9rem 1.9rem .4rem; margin-inline: -1.3rem;
           overflow-x:auto; scrollbar-width:none; scroll-padding-inline: 1.9rem; flex-shrink: 0;
           mask-image: linear-gradient(90deg, transparent 0, #000 0.8rem, #000 calc(100% - 0.8rem), transparent 100%); }
  .tiles :global(.slot) { --ts: 0.58; }
  /* Names stay readable from the sofa rather than shrinking with the tile. */
  .tiles :global(.label) { margin-top: 0.8rem; font-size: 1rem; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tiles :global(.label small) { font-size: 0.8rem; }
  .slot { position: relative; }
  .badge { position: absolute; left: 50%; top: -0.6rem; transform: translateX(-50%); padding: 0.15rem 0.7rem; border-radius: 2rem; z-index: 2;
           background: var(--accent); color: var(--accent-contrast); font-size: 0.9rem; font-weight: 800; letter-spacing: 0.03em; white-space: nowrap;
           box-shadow: 0 0.2rem 0.6rem rgba(0, 0, 0, 0.5); }
  .actions { display: flex; gap: 1rem; margin-top: auto; overflow-x:auto; padding:.4rem .8rem; margin-inline:-.4rem; scroll-padding-inline:.8rem; scrollbar-width:none; flex-shrink:0; }
  .act { all: unset; display: inline-flex; align-items: center; gap: 0.7rem; padding: 0.75rem 1.4rem; border-radius: 2rem; font-size: 1.2rem; font-weight: 600;
         background: #1b212c; box-shadow: 0 0 0 1px #2a3240 inset; transition: transform 120ms, background 120ms; white-space:nowrap; flex-shrink:0; }
  .act svg { width: 1.4rem; height: 1.4rem; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .act.off { color: #8b95a8; }
  .act.f { background: var(--accent); color: var(--accent-contrast); transform: scale(1.04); box-shadow: 0 0 0 0.25rem var(--focus-ring), 0 0 2rem var(--accent-glow); }
</style>
