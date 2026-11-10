<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { CameraViewState } from '@shared/camera-types';
  import CameraPlayer from './CameraPlayer.svelte';
  let view = $state<CameraViewState>({ name: 'Cameras', connected: false, storage: 'none', audio: { volume: 100, muted: true }, cameras: [] });
  let loading = $state(true);
  let connecting = $state(false);
  let token = $state('');
  let error = $state('');
  let revision = $state(0);
  let editingConnection = $state(false);
  const configuring = $derived(!view.connected || editingConnection);
  let container: HTMLElement;
  let tokenField = $state<HTMLInputElement>();
  async function refresh() {
    loading = true; error = '';
    try { view = await window.sofaCamera.state(); revision++; }
    catch { error = 'Camera connection is unavailable'; }
    finally { loading = false; await tick(); if (configuring) tokenField?.focus(); }
  }
  async function connect(event: SubmitEvent) {
    event.preventDefault();
    if (connecting) return;
    connecting = true; error = '';
    const value = token;
    token = '';
    try { view = await window.sofaCamera.connect(value); editingConnection = false; revision++; }
    catch { error = 'Home Assistant could not connect. Check the token and try again.'; }
    finally { connecting = false; await tick(); if (configuring) tokenField?.focus(); }
  }
  function onkeydown(event: KeyboardEvent) {
    if (event.repeat && !event.key.startsWith('Arrow')) { event.preventDefault(); return; }
    const active = document.activeElement;
    if (configuring) {
      const fields = [tokenField, ...container.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter(Boolean) as HTMLElement[];
      const index = fields.indexOf(active as HTMLElement);
      if (event.key === 'ArrowDown') fields[Math.min(fields.length - 1, Math.max(0, index + 1))]?.focus();
      else if (event.key === 'ArrowUp') fields[Math.max(0, index - 1)]?.focus();
      else return;
      event.preventDefault(); return;
    }
    if (event.key === 'Enter' && active instanceof HTMLVideoElement) {
      if (active.paused) void active.play().catch(() => undefined); else active.pause();
      event.preventDefault(); return;
    }
    if (!event.key.startsWith('Arrow')) return;
    const elements = [...container.querySelectorAll<HTMLButtonElement | HTMLVideoElement>('button:not(:disabled),video')].filter(element => element.getBoundingClientRect().width > 0 && !(element instanceof HTMLVideoElement && element.parentElement?.querySelector('.status')));
    const current = elements.find(element => element === active);
    if (!current) { elements[0]?.focus(); event.preventDefault(); return; }
    const rect = current.getBoundingClientRect();
    const horizontal = ['ArrowLeft', 'ArrowRight'].includes(event.key);
    const forward = ['ArrowRight', 'ArrowDown'].includes(event.key);
    const candidates = elements.filter(element => element !== current).map(element => {
      const target = element.getBoundingClientRect();
      const dx = target.x + target.width / 2 - rect.x - rect.width / 2;
      const dy = target.y + target.height / 2 - rect.y - rect.height / 2;
      const along = horizontal ? dx : dy;
      return { element, along, score: Math.abs(along) + 2 * Math.abs(horizontal ? dy : dx) };
    }).filter(value => forward ? value.along > 4 : value.along < -4).sort((a, b) => a.score - b.score);
    candidates[0]?.element.focus();
    event.preventDefault();
  }
  async function changeConnection() {
    editingConnection = true; token = ''; error = '';
    await tick(); tokenField?.focus();
  }
  onMount(() => {
    void refresh();
    const resume = window.sofaCamera.onResume(() => void refresh());
    const audio = window.sofaCamera.onAudio(value => view.audio = value);
    return () => { resume(); audio(); };
  });
</script>
<svelte:window {onkeydown} />
<main bind:this={container} class:single={view.cameras.length === 1}>
  {#if loading}<div class="message">Loading cameras…</div>
  {:else if configuring}
    <form onsubmit={(event) => void connect(event)}>
      <h1>{view.connected ? 'Camera connection' : 'Connect your cameras'}</h1>
      <p>Use one Home Assistant long-lived access token for all your cameras. Create it in your Home Assistant profile under Security.</p>
      <label for="ha-token">API token</label>
      <input id="ha-token" type="password" bind:this={tokenField} bind:value={token} autocomplete="off" spellcheck="false" disabled={connecting} />
      <p class="storage">The connection is saved using the system keyring when available, otherwise a private file for this Linux account. The token is never included in camera addresses.</p>
      {#if view.storage !== 'none'}<p class="storage">{view.storage === 'keyring' ? 'Saved connection: encrypted with the system keyring.' : 'Saved connection: private file (0600), protected by Linux file permissions. System keyring protection is unavailable.'}</p>{/if}
      {#if error || view.error}<p role="alert">{error || view.error}</p>{/if}
      <button disabled={connecting || !token.trim()} type="submit">{connecting ? 'Connecting…' : 'Connect cameras'}</button>
      {#if view.connected}<button disabled={connecting} type="button" onclick={() => editingConnection = false}>Cancel</button>{/if}
    </form>
  {:else}
    {#if view.cameras.length !== 1}<header><h1>{view.name}</h1><div><button onclick={() => void changeConnection()}>Connection</button> <button onclick={() => void refresh()}>Refresh</button></div></header>
    {:else}<button class="connection" onclick={() => void changeConnection()}>Connection</button>{/if}
    {#if error || view.error}<p class="error" role="alert">{error || view.error}</p>{/if}
    {#key revision}
      <div class="grid" class:one={view.cameras.length === 1}>
        {#each view.cameras as camera, index (camera.entity)}<CameraPlayer {index} name={camera.name} cameraState={camera.state} volume={view.audio.volume} muted={view.audio.muted} onretry={() => void refresh()} />{/each}
      </div>
    {/key}
    {#if !view.cameras.length}<div class="message">No cameras are configured.</div>{/if}
  {/if}
</main>
<style>
  main { position:fixed; inset:0; background:#07090d; color:#f2f4f9; padding:1rem; display:flex; flex-direction:column; font-family:system-ui,sans-serif; }
  main.single { padding:0; }
  header { display:flex; align-items:center; justify-content:space-between; gap:1rem; margin-bottom:.8rem; }
  h1 { font-size:1.6rem; margin:0; }
  .grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); grid-auto-rows:minmax(0,1fr); gap:.7rem; flex:1; min-height:0; }
  .grid.one { grid-template-columns:1fr; gap:0; }
  form { margin:auto; width:min(40rem,90vw); display:flex; flex-direction:column; gap:1rem; font-size:1.2rem; }
  p { line-height:1.5; margin:0; }
  input { border:.15rem solid #8792a5; background:#17202f; color:white; font:inherit; padding:.7rem; border-radius:.5rem; }
  button { border:0; background:#f7931a; color:#101010; font:inherit; padding:.65rem 1rem; border-radius:.5rem; }
  button:disabled { opacity:.5; }
  input:focus,button:focus-visible { outline:.2rem solid white; outline-offset:.2rem; }
  .connection { position:absolute; top:.6rem; right:.7rem; z-index:3; padding:.3rem .6rem; font-size:.9rem; background:#10141cce; color:white; }
  .storage { color:#bbc3d0; font-size:1rem; }
  .error { padding:.6rem; color:#ffb6b6; }
  .message { margin:auto; padding:2rem; text-align:center; }
  @media (max-width:600px) { .grid:not(.one) { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
