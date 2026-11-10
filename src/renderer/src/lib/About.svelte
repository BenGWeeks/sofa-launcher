<script lang="ts">
  import { onMount } from 'svelte';
  import type { AboutInfo } from '@shared/types';
  import { BACK_KEYS } from './nav';

  let { onclose }: { onclose: () => void } = $props();
  let info = $state<AboutInfo | null>(null);

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (!e.repeat && (BACK_KEYS.has(e.key) || e.key === 'Enter')) onclose();
  }

  onMount(() => void window.sofa.about().then((i) => (info = i)));
</script>

<svelte:window {onkeydown} />

<div class="dim" role="dialog" aria-modal="true" aria-label="About">
  <div class="card">
    <h3>Sofa Launcher</h3>
    {#if info}
      <dl>
        <dt>Version</dt><dd>v{info.version}</dd>
        <dt>Electron</dt><dd>{info.electron}</dd>
        <dt>Chromium</dt><dd>{info.chrome}</dd>
        <dt>Settings</dt><dd class="path">{info.configPath}</dd>
        <dt>OS sandbox</dt><dd class:ok={info.sandboxed} class:bad={!info.sandboxed}>{info.sandboxed ? '✓ on' : '✗ off (dev mode?)'}</dd>
      </dl>
    {/if}
    <p><span class="k">↩</span> Back</p>
  </div>
</div>

<style>
  .dim { position: fixed; inset: 0; background: rgba(3, 4, 6, 0.72); backdrop-filter: blur(0.3rem);
         display: flex; align-items: center; justify-content: center; z-index: 10; }
  .card { width: 44rem; border-radius: 1.6rem; padding: 2.4rem 2.8rem; background: #141922;
          box-shadow: 0 0 0 1px #262e3c, 0 2rem 5rem rgba(0, 0, 0, 0.7); }
  h3 { margin: 0 0 1.4rem; font-size: 2rem; text-align: center; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.8rem 1.6rem; margin: 0; font-size: 1.35rem; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  .path { font-family: 'JetBrains Mono', 'DejaVu Sans Mono', monospace; font-size: 1.1rem; word-break: break-all; }
  .ok { color: var(--ok); } .bad { color: #ff8b3e; }
  p { margin: 1.8rem 0 0; text-align: center; color: var(--muted); font-size: 1.2rem; }
  .k { display: inline-flex; align-items: center; justify-content: center; min-width: 1.8rem; height: 1.8rem; padding: 0 0.4rem; margin-right: 0.4rem;
       border-radius: 0.45rem; background: #222a38; color: #fff; font-weight: 700; font-size: 1rem; vertical-align: middle; }
</style>
