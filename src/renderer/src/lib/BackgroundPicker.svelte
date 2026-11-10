<script lang="ts">
  import { untrack } from 'svelte';
  import { BACKGROUNDS } from '@shared/backgrounds';
  import type { Background } from '@shared/types';
  import { BACK_KEYS, moveFocus } from './nav';

  const COLS = 6;
  let { current, error = false, onchoose, onclose }: {
    current: Background;
    error?: boolean;
    onchoose: (id: Background) => void;
    onclose: () => void;
  } = $props();
  // The highlight starts on the background in use; arrows move it from there.
  let focus = $state(untrack(() => Math.max(0, BACKGROUNDS.findIndex((b) => b.id === current))));

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (e.key === 'Enter') { if (!e.repeat) onchoose(BACKGROUNDS[focus]!.id); }
    else if (BACK_KEYS.has(e.key)) { if (!e.repeat) onclose(); }
    else focus = moveFocus(focus, e.key, BACKGROUNDS.length, COLS);
  }
</script>

<svelte:window {onkeydown} />

<div class="dim" role="dialog" aria-modal="true" aria-label="Background">
  <div class="picker">
    <h3>{error ? 'Couldn’t save background. Try again?' : 'Background'}</h3>
    <div class="grid" style:--cols={COLS}>
      {#each BACKGROUNDS as b, i (b.id)}
        <button class="choice" class:f={i === focus} aria-pressed={b.id === current} tabindex="-1" onclick={() => onchoose(b.id)}>
          <span class="bg-swatch" data-background={b.id}>
            {#if b.id === current}<svg viewBox="0 0 24 24" aria-label="Current background"><path d="M5 12l4 4L19 6" /></svg>{/if}
          </span>
          <span class="label">{b.label}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .dim { position: fixed; inset: 0; background: rgba(3, 4, 6, 0.72); backdrop-filter: blur(0.3rem);
         display: flex; align-items: center; justify-content: center; z-index: 10; }
  .picker { border-radius: 1.6rem; padding: 2.2rem 2.4rem 2.4rem; background: #141922;
            box-shadow: 0 0 0 1px #262e3c, 0 2rem 5rem rgba(0, 0, 0, 0.7); }
  h3 { margin: 0 0 1.6rem; font-size: 2rem; text-align: center; }
  .grid { display: grid; grid-template-columns: repeat(var(--cols), 13rem); gap: 1.4rem 1.6rem; }
  .choice { all: unset; display: flex; flex-direction: column; gap: 0.6rem; align-items: center; transition: transform 120ms; }
  .bg-swatch { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 0.8rem; overflow: hidden;
               box-shadow: 0 0 0 1px #2a3240; }
  .label { font-size: 1.15rem; color: var(--muted); }
  .choice.f { transform: scale(1.05); }
  .choice.f .bg-swatch { box-shadow: 0 0 0 0.25rem var(--focus-ring), 0 0 1.8rem var(--accent-glow); }
  .choice.f .label { color: var(--fg); font-weight: 700; }
  svg { position: absolute; right: 0.6rem; top: 0.6rem; width: 1.8rem; height: 1.8rem; padding: 0.3rem; border-radius: 50%;
        background: var(--accent); stroke: var(--accent-contrast); fill: none; stroke-width: 3;
        stroke-linecap: round; stroke-linejoin: round; }
</style>
