<script lang="ts">
  import RemoteIcon from './RemoteIcon.svelte';
  import { onMount } from 'svelte';
  import { buttonMap, legendFor, type ButtonDef } from '@shared/buttons';
  import type { ActionContext } from '@shared/types';
  import RemoteDrawing from './RemoteDrawing.svelte';
  import { BACK_KEYS } from './nav';

  let { context, appName, onclose }: { context: ActionContext; appName?: string; onclose: () => void } = $props();

  let buttons = $state<ButtonDef[]>([]);
  const legend = $derived(legendFor(buttons, context, appName));
  const active = $derived(new Set(legend.flatMap((r) => r.ids)));
  const where = $derived(
    context === 'home' ? 'On the home screen' : context === 'panel' ? 'Launcher panel over' : 'Watching',
  );

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (e.repeat) return;
    if (BACK_KEYS.has(e.key) || e.key === 'Enter') onclose();
  }

  onMount(() => void window.sofa.buttons().then((b) => (buttons = buttonMap(b))));
</script>

<svelte:window {onkeydown} />

<div class="guide" role="dialog" aria-modal="true" aria-label="Remote guide">
  <RemoteDrawing {buttons} {active} />
  <div class="legend">
    <h3>Your remote, right now</h3>
    <p>{where}{#if context !== 'home' && appName}&nbsp;<b>{appName}</b>{/if}<span class="sep">·</span><span class="k"><RemoteIcon name="back" /></span> or <span class="k"><RemoteIcon name="info" /></span> closes this</p>
    <div class="lg" class:two={legend.length > 9}>
      {#each legend as row (row.id)}
        <span class="key {row.color ?? ''}">{#if row.icon}<RemoteIcon name={row.icon} />{/if}{row.label}</span>
        <span>{row.text}</span>
      {/each}
    </div>
  </div>
</div>

<style>
  .guide { position: fixed; inset: 0; z-index: 10; background: rgba(5, 7, 10, 0.92); backdrop-filter: blur(0.2rem);
           display: grid; grid-template-columns: 22rem 1fr; gap: 4rem; padding: 3.5rem 5rem; }
  .legend { min-width: 0; }
  h3 { margin: 0 0 0.4rem; font-size: 2.3rem; letter-spacing: -0.02em; }
  p { margin: 0 0 1.8rem; color: var(--muted); font-size: 1.25rem; }
  p b { color: #fff; }
  .sep { margin: 0 0.7rem; }
  .k { display: inline-flex; align-items: center; justify-content: center; min-width: 1.7rem; height: 1.7rem; padding: 0 0.4rem;
       border-radius: 0.45rem; background: #222a38; color: #fff; font-weight: 700; font-size: 0.95rem; vertical-align: middle; }
  .lg { display: grid; grid-template-columns: auto 1fr; gap: 0.95rem 1.4rem; font-size: 1.35rem; align-items: center; }
  .lg.two { grid-template-columns: auto 1fr auto 1fr; column-gap: 1.2rem; font-size: 1.2rem; }
  .lg.two > span:nth-child(4n + 3) { margin-left: 1.6rem; }
  .key { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; min-width: 8rem; height: 2.2rem; padding: 0 0.9rem;
         border-radius: 0.6rem; background: #222a38; color: #fff; font-weight: 700; font-size: 1.05rem; white-space: nowrap; }

</style>
