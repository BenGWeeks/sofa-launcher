<script lang="ts">
  import RemoteIcon from './RemoteIcon.svelte';
  import type { RemoteIconId } from '@shared/buttons';
  import { untrack } from 'svelte';
  import { BACK_KEYS, moveFocus } from './nav';

  export interface MenuOption {
    id: string;
    /** SVG path (24×24 viewBox), stroked. */
    icon: string;
    remoteIcon?: RemoteIconId;
    label: string;
    hint?: string;
    disabled?: boolean;
    selected?: boolean;
  }

  let { title, options, onchoose, onclose, initialFocus = 0, columns }: {
    title: string;
    options: readonly MenuOption[];
    onchoose: (id: string) => void;
    onclose: () => void;
    /** Which option starts highlighted (a confirm dialog puts Cancel first). */
    initialFocus?: number;
    /** Options per row. By default a long menu becomes two columns, so it never needs to scroll. */
    columns?: number;
  } = $props();
  const cols = $derived(columns ?? (options.length > 6 ? 2 : 1));
  let focus = $state(untrack(() => initialFocus)); // the starting highlight only; keys move it from there
  let menu: HTMLDivElement;
  $effect(() => {
    focus;
    queueMicrotask(() => menu?.querySelector('.opt.f')?.scrollIntoView({ block: 'nearest' }));
  });

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (e.repeat) return;
    if (e.key.startsWith('Arrow')) {
      // Step in the pressed direction, passing over disabled options; stay put if none is reachable.
      let at = focus;
      for (;;) {
        const next = moveFocus(at, e.key, options.length, cols);
        if (next === at) break;
        at = next;
        if (!options[at]!.disabled) { focus = at; break; }
      }
    } else if (e.key === 'Enter' && !options[focus]?.disabled) onchoose(options[focus]!.id);
    else if (BACK_KEYS.has(e.key)) onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="dim" role="dialog" aria-modal="true" aria-label={title}>
  <div class="menu" class:wide={cols > 1} bind:this={menu}>
    <h3>{title}</h3>
    <div class="options" style:--cols={cols}>
    {#each options as o, i (o.id)}
      <button disabled={o.disabled} aria-pressed={o.selected} class="opt" class:f={i === focus} tabindex="-1" onclick={() => onchoose(o.id)}>
        {#if o.remoteIcon}<RemoteIcon name={o.remoteIcon} />{:else}<svg viewBox="0 0 24 24" aria-hidden="true"><path d={o.icon} /></svg>{/if}
        <span class="text">{o.label}{#if o.hint}<small>{o.hint}</small>{/if}</span>
      </button>
    {/each}
    </div>
  </div>
</div>

<style>
  .dim { position: fixed; inset: 0; background: rgba(3, 4, 6, 0.72); backdrop-filter: blur(0.3rem);
         display: flex; align-items: center; justify-content: center; z-index: 10; }
  .menu { width: 34rem; max-height: 90vh; overflow-y: auto; border-radius: 1.6rem; padding: 2.4rem; background: #141922;
          box-shadow: 0 0 0 1px #262e3c, 0 2rem 5rem rgba(0, 0, 0, 0.7); }
  .menu.wide { width: 62rem; }
  .options { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 0.8rem 1.2rem; }
  h3 { margin: 0 0 1.6rem; font-size: 2rem; text-align: center; }
  .opt { all: unset; display: flex; align-items: center; gap: 1.2rem; padding: 1.3rem 1.6rem; border-radius: 1rem;
         font-size: 1.5rem; background: #1b212c; width: 100%; box-sizing: border-box;
         transition: transform 120ms, background 120ms; }
  .opt:disabled { opacity: 0.45; }
  .opt.f { background: var(--accent); color: var(--accent-contrast); box-shadow: 0 0 0 0.15rem var(--focus-ring), 0 0 1.8rem var(--accent-glow); font-weight: 700; transform: scale(1.03); }
  .opt svg { width: 1.8rem; height: 1.8rem; fill: none; stroke: currentColor; stroke-width: 2.2;
             stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .text { display: flex; flex-direction: column; }
  .text small { font-size: 1rem; font-weight: 400; color: var(--muted); margin-top: 0.2rem; }
  .opt.f .text small { color: var(--accent-contrast); }
</style>
