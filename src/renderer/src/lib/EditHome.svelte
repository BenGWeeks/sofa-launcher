<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { HomeItem, HomeItems, HomeSection } from '@shared/types';
  import Tile from './Tile.svelte';
  import { BACK_KEYS, firstSectionFocus, moveSectionFocus, type SectionFocus } from './nav';

  /** Ten compact tiles per row: about 13 apps, a row of games and up to 19 cameras fit without scrolling. */
  const COLS = 10;
  const SECTIONS: { id: HomeSection; label: string }[] = [
    { id: 'apps', label: 'Apps' },
    { id: 'games', label: 'Games' },
    { id: 'cameras', label: 'Cameras' },
  ];
  let { onclose }: { onclose: () => void } = $props();

  let data = $state<HomeItems>({ items: [], notes: {} });
  let loaded = $state(false);
  let message = $state<string | null>(null);
  let messageTimer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let focus = $state<SectionFocus>({ section: 0, index: 0 });
  let art = $state<Record<string, string>>({});
  let thumbs = $state<Record<string, string>>({});
  let body: HTMLDivElement;

  const sections = $derived(SECTIONS.map((s) => ({ ...s, items: data.items.filter((i) => i.section === s.id) })));
  const lengths = $derived(sections.map((s) => s.items.length));
  const focused = $derived(sections[focus.section]?.items[focus.index]);

  function say(text: string) {
    message = text;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => (message = null), 4000);
  }

  function load(items: HomeItems) {
    data = items;
    loaded = true;
    const len = items.items.filter((i) => i.section === SECTIONS[focus.section]!.id).length;
    if (focus.index >= len) focus = len ? { ...focus, index: len - 1 } : firstSectionFocus(SECTIONS.map((s) => items.items.filter((i) => i.section === s.id).length));
    for (const item of items.items) {
      if (item.section === 'games' && !(item.id in art)) {
        art[item.id] = '';
        void window.sofa.gameArt(item.id).then((value) => { if (value) art[item.id] = value; }).catch(() => undefined);
      }
      if (item.section === 'cameras' && item.installed && !(item.id in thumbs)) {
        thumbs[item.id] = '';
        void window.sofa.cameraThumbnail(item.id).then((value) => { if (value) thumbs[item.id] = value; }).catch(() => undefined);
      }
    }
  }

  async function toggle(item: HomeItem) {
    if (busy) return;
    if (!item.shown && item.unavailable) {
      return say(item.unavailable === 'needs-setup' ? (item.type === 'containers' ? `${item.name} needs a [containers] status file in config.toml first` : `${item.name} needs its address in config.toml first`) : `${item.name} isn’t installed, so it can’t go on the home screen`);
    }
    busy = true;
    try {
      const result = await window.sofa.setHomeItem(item.id, !item.shown);
      load(result.items);
      if (!result.ok && result.message) say(result.message);
    } catch {
      say('Couldn’t save that change. Try again?');
    } finally { busy = false; }
  }

  // Keep the focused tile (and, on a section's first row, its heading) in view.
  $effect(() => {
    const { section, index } = focus;
    if (!loaded) return;
    void tick().then(() => {
      if (index < COLS) body?.querySelector(`[data-section="${section}"]`)?.scrollIntoView({ block: 'nearest' });
      body?.querySelector('.choice.f')?.scrollIntoView({ block: 'nearest' });
    });
  });

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (e.key === 'Enter') { if (!e.repeat && focused) void toggle(focused); }
    else if (BACK_KEYS.has(e.key)) { if (!e.repeat) onclose(); }
    else if (e.key.startsWith('Arrow')) focus = moveSectionFocus(focus, e.key, lengths, COLS);
  }

  onMount(() => {
    void window.sofa.homeItems().then((items) => {
      load(items);
      focus = firstSectionFocus(SECTIONS.map((s) => items.items.filter((i) => i.section === s.id).length));
    }).catch(() => say('Couldn’t read the home screen’s apps'));
    const offArt = window.sofa.onGameArt(({ appId, value }) => { art[appId] = value; });
    return () => { offArt(); clearTimeout(messageTimer); };
  });
</script>

<svelte:window {onkeydown} />

<div class="dim" role="dialog" aria-modal="true" aria-label="Edit home screen">
  <div class="picker">
    <header>
      <h3>Edit home screen</h3>
      <p class="help" class:message={!!message} aria-live="polite">{message ?? 'OK shows or hides the selected tile · Back returns to Settings'}</p>
    </header>
    <div class="body" bind:this={body}>
      {#each sections as s, si (s.id)}
        <h4 data-section={si}>{s.label}{#if s.items.length}<small>{s.items.filter((i) => i.shown).length} of {s.items.length} on the home screen</small>{/if}</h4>
        {#if s.items.length}
          <div class="grid" style:--cols={COLS}>
            {#each s.items as item, i (item.id)}
              <button class="choice" class:f={focus.section === si && focus.index === i} class:off={!item.shown} aria-pressed={item.shown} tabindex="-1"
                onclick={() => { focus = { section: si, index: i }; void toggle(item); }}>
                <span class="thumb">
                  <Tile app={item} bare art={art[item.id] || undefined} />
                  {#if thumbs[item.id]}<img class="still" src={thumbs[item.id]} alt="" />{/if}
                  {#if item.unavailable}<span class="strip">{item.unavailable === 'needs-setup' ? 'Needs setup' : 'Not installed'}</span>{/if}
                  <span class="badge" class:on={item.shown} aria-label={item.shown ? 'On the home screen' : 'Hidden'}>
                    {#if item.shown}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4L19 6" /></svg>{/if}
                  </span>
                </span>
                <span class="label">{item.name}</span>
              </button>
            {/each}
          </div>
        {:else if loaded}
          <p class="note">{data.notes[s.id] ?? 'Nothing to show here.'}</p>
        {/if}
      {/each}
    </div>
  </div>
</div>

<style>
  .dim { position: fixed; inset: 0; background: rgba(3, 4, 6, 0.72); backdrop-filter: blur(0.3rem); z-index: 10; }
  .picker { position: absolute; inset: 1.4rem 2rem; border-radius: 1.6rem; background: #141922; display: flex; flex-direction: column;
            box-shadow: 0 0 0 1px #262e3c, 0 2rem 5rem rgba(0, 0, 0, 0.7); overflow: hidden; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 2rem; padding: 1.6rem 2.4rem 0.4rem; }
  h3 { margin: 0; font-size: 2rem; }
  .help { margin: 0; font-size: 1.1rem; color: var(--muted); }
  .help.message { color: var(--fg); font-weight: 700; }
  /* Only the body scrolls; its padding and scroll-padding keep the focus ring clear of the edges. */
  .body { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; padding: 0.2rem 2.4rem 1.6rem; scroll-padding-block: 1rem; }
  h4 { margin: 0.9rem 0 0.7rem; font-size: 1.35rem; color: var(--fg); display: flex; align-items: baseline; gap: 1rem; }
  h4 small { font-size: 1rem; font-weight: 400; color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: 1rem 1.2rem; padding: 0.4rem; }
  .note { margin: 0 0 0.4rem 0.4rem; font-size: 1.15rem; color: var(--muted); }
  .choice { all: unset; display: flex; flex-direction: column; gap: 0.45rem; min-width: 0; }
  .thumb { position: relative; display: block; border-radius: 0.7rem; overflow: hidden; box-shadow: 0 0 0 1px #2a3240;
           transition: transform 120ms; }
  .thumb :global(.slot) { --ts: 0.42; }
  .thumb :global(.tile) { border-radius: 0; }
  .thumb :global(.camera) { width: 2.2rem; height: 2.2rem; }
  .still { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  /* Hidden: faded and grey, with an empty circle; shown: full colour with a ticked badge. */
  /* Only the artwork fades, so the focus ring and the badge stay crisp on a hidden tile. */
  .off .thumb :global(.slot), .off .still { opacity: 0.4; filter: grayscale(1); transition: opacity 120ms, filter 120ms; }
  .choice.f.off .thumb :global(.slot), .choice.f.off .still { opacity: 0.6; }
  .choice.f .thumb { transform: scale(1.06); box-shadow: 0 0 0 0.25rem var(--focus-ring), 0 0 1.4rem var(--accent-glow); }
  .badge { position: absolute; right: 0.35rem; top: 0.35rem; width: 1.7rem; height: 1.7rem; border-radius: 50%; z-index: 3;
           background: rgba(10, 12, 16, 0.75); box-shadow: inset 0 0 0 0.18rem #e9edf5; }
  .badge.on { background: var(--accent); box-shadow: 0 0 0 0.12rem rgba(0, 0, 0, 0.5); }
  .badge svg { width: 100%; height: 100%; padding: 0.28rem; fill: none; stroke: var(--accent-contrast); stroke-width: 3.4;
               stroke-linecap: round; stroke-linejoin: round; display: block; }
  .strip { position: absolute; left: 0; right: 0; bottom: 0; z-index: 3; padding: 0.15rem 0; text-align: center;
           font-size: 0.85rem; font-weight: 700; color: #fff; background: rgba(0, 0, 0, 0.78); }
  .label { font-size: 1rem; color: var(--muted); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .choice:not(.off) .label { color: #c9d1de; }
  .choice.f .label { color: var(--fg); font-weight: 700; }
</style>
