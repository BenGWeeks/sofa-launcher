<script lang="ts">
  import { onMount } from 'svelte';
  import type { AboutInfo } from '@shared/types';
  import { BACK_KEYS } from './nav';
  import RemoteIcon from './RemoteIcon.svelte';
  import { DONATE_ADDRESS, PROJECT_URL, PROJECT_URL_LABEL } from '@shared/project';
  import donateQr from '../assets/donate-lightning.svg';

  let { onclose }: { onclose: () => void } = $props();
  let info = $state<AboutInfo | null>(null);

  /** The remote's highlight is on the GitHub link (Down moves it there; OK then opens it). */
  let onLink = $state(false);

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (e.repeat) return;
    if (e.key === 'ArrowDown') onLink = true;
    else if (e.key === 'ArrowUp') onLink = false;
    else if (e.key === 'Enter' && onLink) openLink();
    else if (BACK_KEYS.has(e.key) || e.key === 'Enter') onclose();
  }

  /** Sofa steps aside for the browser; About is closed for when Home comes back. */
  function openLink() {
    void window.sofa.openProject();
    onclose();
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
        <dt>OS sandbox</dt><dd class:ok={info.sandboxed} class:bad={!info.sandboxed}>{info.sandboxed ? '✓ on' : info.noSandboxSwitch ? '✗ off (started with --no-sandbox, as when run from source)' : '✗ off'}</dd>
      </dl>
    {/if}
    <div class="more">
      <section>
        <h4>Source code</h4>
        <!-- An address to read from the sofa, and a real link for a mouse or the remote's OK. -->
        <a class="github" class:focused={onLink} href={PROJECT_URL} tabindex="-1"
          onclick={(e) => { e.preventDefault(); openLink(); }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>
          <span>{PROJECT_URL_LABEL}</span>
        </a>
        <p class="small">Free and open source (MIT).</p>
      </section>
      <section class="donate">
        <img src={donateQr} alt="QR code: pay {DONATE_ADDRESS} over Bitcoin Lightning" />
        <div>
          <h4>Enjoying Sofa Launcher?</h4>
          <p class="small">Buy me a coffee with Bitcoin: scan with a Lightning wallet, or pay</p>
          <p class="address">{DONATE_ADDRESS}</p>
        </div>
      </section>
    </div>
    <p class="keys"><span class="k">{onLink ? '↑' : '↓'}</span>{onLink ? 'Leave link' : 'GitHub link'}<button class="hint" onclick={() => (onLink ? openLink() : onclose())}><span class="k">OK</span>{onLink ? 'Open' : 'Close'}</button><button class="hint" onclick={onclose}><span class="k"><RemoteIcon name="back" /></span>Back</button></p>
  </div>
</div>

<style>
  .dim { position: fixed; inset: 0; background: rgba(3, 4, 6, 0.72); backdrop-filter: blur(0.3rem);
         display: flex; align-items: center; justify-content: center; z-index: 10; }
  .card { width: 63rem; border-radius: 1.6rem; padding: 2.4rem 2.8rem; background: #141922;
          box-shadow: 0 0 0 1px #262e3c, 0 2rem 5rem rgba(0, 0, 0, 0.7); }
  h3 { margin: 0 0 1.4rem; font-size: 2rem; text-align: center; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.8rem 1.6rem; margin: 0; font-size: 1.35rem; }
  dt { color: var(--muted); }
  dd { margin: 0; }
  .path { font-family: 'JetBrains Mono', 'DejaVu Sans Mono', monospace; font-size: 1.1rem; word-break: break-all; }
  .ok { color: var(--ok); } .bad { color: #ff8b3e; }
  .more { display: grid; grid-template-columns: auto 1fr; gap: 3rem; margin-top: 1.8rem; padding-top: 1.6rem; border-top: 1px solid #262e3c; }
  h4 { margin: 0 0 0.6rem; font-size: 1.25rem; font-weight: 700; }
  .github { display: inline-flex; align-items: center; gap: 0.7rem; padding: 0.55rem 0.8rem; margin-left: -0.8rem; border-radius: 0.7rem;
            color: #e6e9f0; text-decoration: none; font-size: 1.15rem; cursor: pointer; white-space: nowrap; }
  .github svg { width: 2rem; height: 2rem; fill: currentColor; flex-shrink: 0; }
  .github:hover, .github.focused { background: #222a38; color: #fff; }
  .github.focused { box-shadow: 0 0 0 0.22rem var(--focus-ring), 0 0 1.2rem var(--accent-glow); }
  .donate { display: flex; align-items: center; gap: 1.2rem; }
  /* White with its own quiet zone: a QR code must stay dark-on-light to scan. */
  .donate img { width: 11.5rem; height: 11.5rem; border-radius: 0.6rem; background: #fff; flex-shrink: 0; }
  .small { margin: 0.35rem 0 0; font-size: 1.05rem; color: var(--muted); }
  .address { margin: 0.3rem 0 0; font-family: 'JetBrains Mono', 'DejaVu Sans Mono', monospace; font-size: 1rem; color: #e6e9f0; white-space: nowrap; }
  .keys { margin: 1.8rem 0 0; text-align: center; color: var(--muted); font-size: 1.2rem; }
  .keys .k { margin-left: 1rem; }
  /* The OK and Back hints are buttons too, for a mouse. */
  .hint { all: unset; cursor: pointer; margin-left: 1rem; }
  .hint .k:first-child { margin-left: 0; }
  .hint:hover { color: #fff; } .hint:hover .k { background: #2f3a4e; }
  .keys .k:first-child { margin-left: 0; }
  .k { display: inline-flex; align-items: center; justify-content: center; min-width: 1.8rem; height: 1.8rem; padding: 0 0.4rem; margin-right: 0.4rem;
       border-radius: 0.45rem; background: #222a38; color: #fff; font-weight: 700; font-size: 1rem; vertical-align: middle; }
</style>
