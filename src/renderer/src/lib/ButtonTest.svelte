<script lang="ts">
  import RemoteIcon from './RemoteIcon.svelte';
  import { onDestroy, onMount } from 'svelte';
  import { buttonMap, GROUPS, keyFromEvent, matchKey, type ButtonDef } from '@shared/buttons';
  import { IDLE_EXIT_SECONDS, nextExitPresses, shouldExit, type ExitPresses } from './buttontest';

  /** While open, main releases the global key grabs so every button arrives here as a plain keydown. */
  let { demo = false, onclose }: { demo?: boolean; onclose: () => void } = $props();

  interface Seen { key: string; exact: boolean; }
  interface Cell { id: string; icon: import("@shared/buttons").RemoteIconId; label: string; ids: string[]; expected: string; color?: string; }

  let buttons = $state<ButtonDef[]>([]);
  let seen = $state<Record<string, Seen>>({});
  let unknown = $state<string[]>([]);
  let last = $state<{ button: ButtonDef | null; key: string; exact: boolean } | null>(null);
  /** Seconds left before the test closes itself (any key resets it). */
  let idle = $state(IDLE_EXIT_SECONDS);
  let exit: ExitPresses = { id: null, count: 0 };

  const cells = $derived.by((): Cell[] => {
    const out: Cell[] = [];
    for (const b of buttons) {
      const grp = b.group ? GROUPS[b.group] : undefined;
      const existing = b.group && out.find((c) => c.id === b.group);
      if (existing) existing.ids.push(b.id);
      else out.push({ id: b.group ?? b.id, icon: grp?.icon ?? b.icon, label: grp?.label ?? b.label, ids: [b.id], expected: grp?.keys ?? b.key, color: b.color });
    }
    return out;
  });
  const working = $derived(Object.keys(seen).length);
  const differs = $derived(Object.values(seen).filter((s) => !s.exact).length);
  const pct = $derived(buttons.length ? Math.round((working / buttons.length) * 100) : 0);

  type CellState = 'todo' | 'partial' | 'ok' | 'warn' | 'now';
  function stateOf(c: Cell): CellState {
    if (last?.button && c.ids.includes(last.button.id)) return 'now';
    const got = c.ids.filter((id) => seen[id]);
    if (got.length === 0) return 'todo';
    if (got.some((id) => !seen[id]!.exact)) return 'warn';
    return got.length === c.ids.length ? 'ok' : 'partial';
  }
  function detail(c: Cell): string {
    const s = stateOf(c);
    const lastSeen = c.ids.map((id) => seen[id]).filter(Boolean).at(-1);
    if (s === 'todo') return 'not pressed yet';
    if (s === 'now') return `${last!.key} · just now`;
    if (s === 'warn') {
      const bad = c.ids.find((id) => seen[id] && !seen[id]!.exact)!;
      return `${seen[bad]!.key} · expected ${buttons.find((b) => b.id === bad)?.key}`;
    }
    if (s === 'partial') return `${c.ids.filter((id) => seen[id]).length} of ${c.ids.length} · ${c.expected}`;
    return c.ids.length > 1 ? c.expected : lastSeen!.key;
  }

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (e.repeat) return;
    const key = keyFromEvent(e);
    if (!key) return;
    idle = IDLE_EXIT_SECONDS;
    const match = matchKey(buttons, key);
    exit = nextExitPresses(exit, match?.button.id ?? null);
    if (!match) {
      unknown = [...unknown.filter((k) => k !== key), key];
      last = { button: null, key, exact: false };
      return;
    }
    seen = { ...seen, [match.button.id]: { key, exact: match.exact } };
    last = { button: match.button, key, exact: match.exact };
    if (shouldExit(exit)) onclose();
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  onMount(async () => {
    void window.sofa.buttonTest(true);
    timer = setInterval(() => {
      if (demo) return;
      idle -= 1;
      if (idle <= 0) onclose();
    }, 1000);
    buttons = buttonMap(await window.sofa.buttons());
    if (demo) seedDemo();
  });
  onDestroy(() => {
    clearInterval(timer);
    void window.sofa.buttonTest(false);
  });

  /** Fake results for the docs screenshot. */
  function seedDemo() {
    const ok = ['home', 'power', 'up', 'down', 'left', 'right', 'ok', 'record', 'playPause', 'ff', 'rew', 'volUp', 'volDown', 'mute', 'menu', 'info', 'chUp', 'chDown', 'stop'];
    const s: Record<string, Seen> = {};
    for (const id of [...ok, ...Array.from({ length: 10 }, (_, n) => `digit${n}`)]) {
      const b = buttons.find((x) => x.id === id);
      if (b) s[id] = { key: b.key, exact: true };
    }
    s['back'] = { key: 'Escape', exact: false };
    const red = buttons.find((b) => b.id === 'red')!;
    s['red'] = { key: red.key, exact: true };
    seen = s;
    last = { button: red, key: red.key, exact: true };
  }
</script>

<svelte:window {onkeydown} />

<div class="test" role="dialog" aria-modal="true" aria-label="Button test">
  <h3>Button test <span class="sub">{' · '}{working} of {buttons.length} working{#if differs}{` · ${differs} differ`}{/if}{#if unknown.length}{` · ${unknown.length} unknown`}{/if}{' · '}<span class="k"><RemoteIcon name="back" /></span> Back or <span class="k"><RemoteIcon name="home" /></span> Home twice exits{` · closes by itself in ${idle} s`}</span></h3>
  <div class="prog"><div class="fill" style="width: {pct}%"></div></div>
  <div class="grid">
    {#each cells as c (c.id)}
      {@const s = stateOf(c)}
      <div class="cell {s}">
        <span class="name"><RemoteIcon name={c.icon} />{c.label}</span>
        <small>{detail(c)}</small>
      </div>
    {/each}
  </div>
  <div class="last">
    <div>Last button<b>{#if last?.button}<RemoteIcon name={last.button.icon} /> {last.button.label}{:else if last}Unknown{:else}—{/if}</b></div>
    <div>PC received<b>{last?.key ?? '—'}</b></div>
    <div class:okk={last?.button && last.exact} class:warnk={last && (!last.button || !last.exact)}>
      Launcher action
      <b>
        {#if !last}—
        {:else if !last.button}! No button sends this key
        {:else if !last.exact}! Works, but expected {last.button.key}
        {:else}✓ {last.button.does}{/if}
      </b>
    </div>
  </div>
</div>

<style>
  .test { position: fixed; inset: 0; z-index: 10; background: var(--bg); padding: 3.2rem 5rem; display: flex; flex-direction: column; }
  h3 { margin: 0; font-size: 2.3rem; letter-spacing: -0.02em; }
  .sub { font-weight: 400; color: var(--muted); font-size: 1.4rem; }
  .k { display: inline-flex; align-items: center; justify-content: center; min-width: 1.8rem; height: 1.8rem; padding: 0 0.4rem;
       border-radius: 0.45rem; background: #222a38; color: #fff; font-weight: 700; font-size: 1rem; vertical-align: middle; }
  .prog { margin: 1.3rem 0 1.8rem; height: 1rem; border-radius: 1rem; background: #1f2633; overflow: hidden; }
  .fill { height: 100%; background: linear-gradient(90deg, var(--accent-strong), var(--accent)); border-radius: 1rem; transition: width 200ms; }
  .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.9rem; }
  .cell { border-radius: 0.8rem; padding: 1rem 1.2rem; background: #151a23; font-size: 1.25rem; line-height: 1.4; position: relative;
          transition: background 150ms, box-shadow 150ms; }
  .cell .name { display: inline-flex; align-items: center; gap: 0.4rem; }
  .cell small { display: block; color: #7c8598; font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cell.todo { color: #8b95a8; }
  .cell.ok, .cell.partial { background: #11261b; box-shadow: 0 0 0 1px #1f5c3b inset; }
  .cell.ok::after { content: '✓'; position: absolute; right: 1rem; top: 0.9rem; color: #3ddc84; font-weight: 800; }
  .cell.partial::after { content: '…'; position: absolute; right: 1rem; top: 0.9rem; color: #3ddc84; font-weight: 800; }
  .cell.now { background: var(--accent); box-shadow: 0 0 0 0.2rem var(--focus-ring), 0 0 1.6rem var(--accent-glow); color: var(--accent-contrast); }
  .cell.now small { color: var(--accent-contrast); }
  .cell.warn { background: #2a1a12; box-shadow: 0 0 0 1px #7a3d1d inset; }
  .cell.warn::after { content: '!'; position: absolute; right: 1rem; top: 0.9rem; color: #ff8b3e; font-weight: 800; }
  .last { margin-top: auto; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.4rem; padding: 1.6rem 2rem; border-radius: 1.2rem;
          background: #121722; box-shadow: 0 0 0 1px #232b3a inset; }
  .last div { font-size: 1.1rem; color: #7c8598; }
  .last b { display: block; margin-top: 0.4rem; font-size: 1.9rem; color: #fff; letter-spacing: -0.01em; }
  .last .okk b { color: #3ddc84; }
  .last .warnk b { color: #ff8b3e; }
</style>
