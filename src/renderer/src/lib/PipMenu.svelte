<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { PipState, TileState } from '@shared/types';
  import Menu from './Menu.svelte';
  import Tile from './Tile.svelte';
  import { BACK_KEYS, moveFocus } from './nav';

  let { apps, initialBaseId, onclose }: { apps: TileState[]; initialBaseId?: string; onclose: () => void } = $props();
  let stage = $state<'base' | 'inset' | 'controls' | 'starting' | 'audio'>('base');
  let baseId = $state('');
  let focus = $state(0);
  $effect(() => { const selected = focus; void tick().then(() => document.querySelectorAll('.choices button')[selected]?.scrollIntoView({block:'nearest'})); });
  let error = $state('');
  let audioRole = $state<'base' | 'inset'>('base');
  let audio = $state({ available: false, volume: 0, muted: false });
  let audioBusy = $state(false);
  const audioOptions = $derived([
    {id:'up', icon:'M12 4v16M4 12h16', label:'Volume up', disabled:audioBusy},
    {id:'down', icon:'M4 12h16', label:'Volume down', disabled:audioBusy},
    {id:'mute', icon:'M4 9h4l5-5v16l-5-5H4z', label:audio.muted ? 'Unmute' : 'Mute', disabled:audioBusy},
  ]);
  let pipState = $state<PipState>({ active: false });
  // Games are not offered: their windows' classes are not reliably known yet.
  const choices = $derived(apps.filter((app) => app.installed && app.group !== 'games' && app.type !== 'containers' && (stage !== 'inset' || app.id !== baseId)));
  const base = $derived(apps.find((app) => app.id === (pipState.baseId ?? baseId)));
  const inset = $derived(apps.find((app) => app.id === pipState.insetId));
  const controls = $derived([
    { id: 'close-inset', icon: 'M6 6l12 12M18 6L6 18', label: `Close second screen · ${inset?.name ?? 'inset app'}`, hint: `Keep ${base?.name ?? 'the main app'} playing` },
    ...(!pipState.pinned ? [{ id: pipState.expanded ? 'shrink' : 'browse', icon: 'M3 4h18v16H3z', label: pipState.expanded ? 'Return to small screen' : `Browse ${inset?.name ?? 'second screen'} full screen`, hint: 'Choose something to play, then return it to the corner' }] : []),
    { id: 'base', icon: 'M3 4h18v16H3z', label: `Control ${base?.name ?? 'main app'}`, hint: 'Arrows and OK go to the main app' },
    ...(!pipState.pinned ? [{ id: 'inset', icon: 'M3 4h18v16H3zM12 11h7v7h-7z', label: `Control ${inset?.name ?? 'inset app'}`, hint: 'Arrows and OK go to the small window' }] : []),
    { id: 'audio-base', icon: 'M4 9h4l5-5v16l-5-5H4z', label: `${base?.name ?? 'Main'} audio`, hint: 'Separate volume and mute' },
    { id: 'audio-inset', icon: 'M4 9h4l5-5v16l-5-5H4z', label: `${inset?.name ?? 'Inset'} audio`, hint: 'Separate volume and mute' },
    ...([base, inset].some(a => a?.id === 'nodie') ? [
      {id:'nodie-camera', icon:'M3 7h18v12H3z', label:'Nodie camera on/off'},
      {id:'nodie-mic', icon:'M12 4v16', label:'Nodie listening on/off'},
      {id:'nodie-speaker', icon:'M4 9h4l5-5v16l-5-5H4z', label:'Nodie voice output on/off'},
    ] : []),
    { id: 'corner', icon: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', label: 'Move to next corner', hint: 'Yellow on the remote' },
    { id: 'size', icon: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', label: 'Change inset size', hint: 'Blue: 30%, 40% or 50% of the screen width' },
    { id: 'choose', icon: 'M4 4h7v7H4zM13 13h7v7h-7z', label: 'Choose different apps' },
    { id: 'stop', icon: 'M6 6l12 12M18 6L6 18', label: 'Stop screen-in-screen', hint: 'Restore both windows · Red on the remote' },
  ]);

  // Latest still per camera, so inputs are recognisable at a glance; the icon stays as the fallback.
  let thumbs = $state<Record<string, string>>({});
  onMount(() => {
    for (const app of apps) if (app.type === 'camera' && app.installed) void window.sofa.cameraThumbnail(app.id).then(value => { if (value) thumbs[app.id] = value; }).catch(() => undefined);
    if (initialBaseId && apps.some(app => app.id === initialBaseId && app.group !== 'games')) { baseId = initialBaseId; stage = 'inset'; }
    void window.sofa.pipState().then((value) => { pipState = value; if (value.active) stage = 'controls'; });
    return window.sofa.onPip((value) => {
      pipState = value;
      if (!value.active && (stage === 'controls' || stage === 'audio')) onclose();
    });
  });

  async function choose(id: string) {
    error = '';
    if (stage === 'base') { baseId = id; stage = 'inset'; focus = 0; return; }
    if (stage !== 'inset') return;
    stage = 'starting';
    try {
      const result = await window.sofa.pipStart(baseId, id);
      if (result.ok) onclose();
      else { error = result.message ?? 'Couldn’t start screen-in-screen'; stage = 'inset'; }
    } catch { error = 'Couldn’t start screen-in-screen'; stage = 'inset'; }
  }

  async function control(id: string) {
    if (id.startsWith('audio-')) { audioRole = id === 'audio-base' ? 'base' : 'inset'; stage = 'audio'; await adjustAudio('get'); return; }
    if (id === 'choose') { stage = 'base'; focus = 0; return; }
    try {
      if (id.startsWith('nodie-')) { await window.sofa.pipNodie(id.slice(6) as 'camera' | 'mic' | 'speaker'); onclose(); return; }
      await window.sofa.pipControl(id as 'base' | 'inset' | 'browse' | 'shrink' | 'close-inset' | 'corner' | 'size' | 'stop');
      if (['base', 'inset', 'browse', 'shrink', 'close-inset', 'stop'].includes(id)) onclose();
    } catch { error = 'The app window is no longer available'; }
  }

  async function adjustAudio(action: 'get' | 'up' | 'down' | 'mute') {
    audioBusy = true; error = '';
    try { audio = await window.sofa.pipAudio(audioRole, action); }
    catch { error = 'App audio unavailable'; }
    finally { audioBusy = false; }
  }

  function back() {
    if (stage === 'inset' && !initialBaseId) { stage = 'base'; focus = 0; return; }
    if (stage === 'starting') void window.sofa.pipControl('stop');
    onclose();
  }

  function onkeydown(event: KeyboardEvent) {
    if (stage === 'controls' || stage === 'audio') return;
    if (event.repeat && !event.key.startsWith('Arrow')) return event.preventDefault();
    if (event.key.startsWith('Arrow') && stage !== 'starting') focus = moveFocus(focus, event.key, choices.length, 3);
    else if (event.key === 'Enter' && stage !== 'starting') { const app = choices[focus]; if (app) void choose(app.id); }
    else if (BACK_KEYS.has(event.key)) back();
    else return;
    event.preventDefault();
  }
</script>

<svelte:window {onkeydown} />

{#if stage === 'audio'}
  <Menu title={error || `${(audioRole === 'base' ? base : inset)?.name} · ${audio.available ? (audio.muted ? 'Muted' : `${audio.volume}%`) : 'No audio stream yet'}`} options={audioOptions} onchoose={(id) => void adjustAudio(id as 'up' | 'down' | 'mute')} onclose={() => stage = 'controls'} />
{:else if stage === 'controls'}
  <Menu title={error || `${inset?.name ?? 'Inset'} over ${base?.name ?? 'main app'}`} options={controls} onchoose={(id) => void control(id)} {onclose} />
{:else}
  <div class="pip-chooser" role="dialog" aria-modal="true" aria-label="Screen-in-screen">
    <h2>Screen-in-screen</h2>
    <p>{stage === 'base' ? '1 · Choose the main app' : stage === 'inset' ? `${initialBaseId ? '' : '2 · '}Choose what to show over ${base?.name ?? 'the main app'}` : 'Opening both apps…'}</p>
    <div class="choices">
      {#each choices as app, index (app.id)}
        <button disabled={stage === 'starting'} class:focused={focus === index} onclick={() => { focus = index; void choose(app.id); }}>
          {#if app.type === 'camera'}
            {#if thumbs[app.id]}<img class="thumb" src={thumbs[app.id]} alt="" />{:else}<span class="thumb"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h12v11H3zM15 10l6-3v11l-6-3z" /></svg></span>{/if}
          {:else}
            <span class="art"><Tile {app} bare /></span>
          {/if}
          <span class="label">{app.name}<small>{app.running ? 'Already open' : app.type === 'camera' ? 'Open camera' : 'Open app'}</small></span>
        </button>
      {/each}
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <p class="help">Arrows select · OK chooses · Back {stage === 'inset' && !initialBaseId ? 'changes main app' : 'cancels'}<br />Both apps keep running. Menu opens app controls. Green switches the remote.</p>
  </div>
{/if}

<style>
  .pip-chooser { position:fixed; inset:0; z-index:10; background:var(--bg); padding:3rem 6rem; display:flex; flex-direction:column; }
  h2 { margin:0 0 .5rem; font-size:2.5rem; }
  p { font-size:1.5rem; margin:.8rem 0 1.8rem; }
  .choices { display:grid; grid-template-columns:repeat(3,1fr); gap:1.2rem; overflow-y:auto; min-height:0; padding:.5rem; }
  button { all:unset; background:#1b212c; border-radius:.8rem; padding:1.4rem 1.6rem; font-size:1.6rem; border:.15rem solid transparent; }
  button { display:flex; align-items:center; gap:1.2rem; box-sizing:border-box; min-height:6.4rem; }
  .thumb { width:7.2rem; aspect-ratio:16 / 9; flex-shrink:0; border-radius:.45rem; object-fit:cover; background:#142c39; color:#8cdef1; display:flex; align-items:center; justify-content:center; }
  .thumb svg { width:2.2rem; height:2.2rem; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linejoin:round; }
  /* The app's home-screen artwork, scaled down, so apps are recognisable at a glance. */
  .art { width:7.2rem; flex-shrink:0; }
  .art :global(.slot) { --ts:.36; }
  .label { min-width:0; }
  button small { display:block; font-size:1rem; margin-top:.3rem; color:var(--muted); }
  button.focused { background:var(--accent); border-color:var(--focus-ring); color:var(--accent-contrast); box-shadow:0 0 1.2rem var(--accent-glow); font-weight:700; }
  button.focused small { color:var(--accent-contrast); }
  button:disabled { opacity:.45; }
  .help { font-size:1.1rem; color:var(--muted); line-height:1.7; }
  .error { color:#ffb1b1; }
</style>
