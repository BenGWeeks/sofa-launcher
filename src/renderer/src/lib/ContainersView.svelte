<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    countParts, displayImage, groupContainers, iconFor, monogram, OTHER_GROUP, packGroups, shortName,
    type ContainerColour, type ContainerInfo, type ContainersSnapshot,
  } from '@shared/containers';
  import StatusGlyph from './StatusGlyph.svelte';
  import { BACK_KEYS } from './nav';
  import { spatialMove } from './spatial-nav';

  let { onclose }: { onclose: () => void } = $props();

  /** Bundled dashboard-icons (see assets/ATTRIBUTION.md); never fetched at run time. */
  const files = import.meta.glob('../assets/containers/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
  const ICONS = new Map(Object.entries(files).map(([path, url]) => [path.replace(/^.*\/(.+)\.svg$/, '$1'), url]));
  const KEYS = new Set(ICONS.keys());

  /** Re-read the status file this often while the view is open. */
  const REFRESH_MS = 10_000;
  /** Cards per row: wide enough for a name and "UNHEALTHY · Up 6 days" at TV distance. */
  const COLS = 5;

  let snap = $state<ContainersSnapshot | null>(null);
  let now = $state(Date.now());
  let focus = $state(0);
  let detail = $state<ContainerInfo | null>(null);
  let grid = $state<HTMLElement>();

  const groups = $derived(groupContainers(snap?.containers ?? []));
  const rows = $derived(packGroups(groups, COLS));
  /** Cards in display order (focus indexes into this), with each group's first index. */
  const cards = $derived(rows.flat().flatMap((g) => g.containers));
  const offsets = $derived.by(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const g of rows.flat()) { map.set(g.name, n); n += g.containers.length; }
    return map;
  });
  const counts = $derived(countParts(snap?.containers ?? []));
  /** Hide the heading when everything is in one unnamed group (no compose data published). */
  const headings = $derived(!(groups.length === 1 && groups[0]!.name === OTHER_GROUP));
  const dim = $derived(!!snap && (!!snap.error || snap.stale));

  const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function ago(t: number): string {
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return `${s} s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
  }
  /** Image without tag for the card ("linuxserver/sonarr"); the detail panel shows the tag too. */
  const repo = (c: ContainerInfo) => c.image.replace(/:[^:/]*$/, '') || 'unknown image';

  async function refresh(fresh = false) {
    try {
      const next = await window.sofaContainers.snapshot(fresh);
      const focusedId = cards[focus]?.id;
      snap = next;
      await tick();
      // Keep the highlight on the same container across refreshes (the order can change).
      const i = focusedId ? cards.findIndex((c) => c.id === focusedId) : -1;
      focus = i >= 0 ? i : Math.min(focus, Math.max(0, cards.length - 1));
      if (detail) detail = cards.find((c) => c.id === detail!.id) ?? null;
    } catch {
      if (snap) snap = { ...snap, error: 'The launcher could not read the status' };
    }
  }

  function boxes() {
    return [...(grid?.querySelectorAll<HTMLElement>('.card') ?? [])].map((el) => el.getBoundingClientRect());
  }

  async function reveal() {
    await tick();
    const card = grid?.querySelectorAll<HTMLElement>('.card')[focus];
    if (!card || !grid) return;
    // Bring the whole stack (with its heading) into view when it fits, then the card itself.
    const group = card.closest<HTMLElement>('.group');
    if (group && group.offsetHeight < grid.clientHeight * 0.8) group.scrollIntoView({ block: 'nearest' });
    card.scrollIntoView({ block: 'nearest' });
  }

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.repeat && !e.key.startsWith('Arrow')) { e.preventDefault(); return; }
    if (BACK_KEYS.has(e.key)) {
      if (detail) detail = null; else onclose();
    } else if (e.key === 'Enter') {
      detail = detail ? null : cards[focus] ?? null;
    } else if (e.key.startsWith('Arrow')) {
      if (detail) { e.preventDefault(); return; }
      focus = spatialMove(boxes(), focus, e.key);
      void reveal();
    } else return;
    e.preventDefault();
  }

  onMount(() => {
    document.documentElement.classList.add('containers-open');
    void refresh(true);
    const poll = setInterval(() => void refresh(), REFRESH_MS);
    const ticker = setInterval(() => (now = Date.now()), 1000);
    return () => {
      clearInterval(poll); clearInterval(ticker);
      document.documentElement.classList.remove('containers-open');
    };
  });
</script>

<!-- `label`: the name shown beside the icon, so a monogram matches it ("web" → We, not t3-web → TW). -->
{#snippet icon(c: ContainerInfo, label: string, big = false)}
  {@const key = iconFor(c, KEYS)}
  <span class="icon" class:big>
    {#if key}<img src={ICONS.get(key)} alt="" />
    {:else}{@const m = monogram(label)}<span class="mono" style:--hue={m.hue}>{m.letters}</span>{/if}
  </span>
{/snippet}

{#snippet badge(colour: ContainerColour, word: string)}
  <span class="badge {colour}"><StatusGlyph {colour} /><b>{word}</b></span>
{/snippet}

<svelte:window {onkeydown} />

<div class="view" role="dialog" aria-modal="true" aria-label="Containers">
  <header>
    <div class="title">
      <h1>Containers</h1>
      <p class="counts">
        {#each counts as part, i}{#if i}<span class="sep">·</span>{/if}<span class="count {part.colour}"><StatusGlyph colour={part.colour} />{part.text}</span>{/each}
      </p>
    </div>
    <div class="updated">
      {#if snap?.modifiedAt}Updated {clock(snap.modifiedAt)}<small>{ago(snap.modifiedAt)}</small>{:else if snap}Not updated yet{/if}
    </div>
  </header>

  {#if snap && (snap.error || snap.stale)}
    <p class="warning" role="alert">
      <StatusGlyph colour="amber" />
      <span>
        {#if snap.stale}<b>Status is stale.</b> The status file was last written {snap.modifiedAt ? ago(snap.modifiedAt) : 'a while ago'}: its writer may have stopped.{/if}
        {#if snap.error}<b>{snap.error}.</b> {snap.containers.length ? `Showing the last good data${snap.readAt ? ` (read at ${clock(snap.readAt)})` : ''}.` : ''}{/if}
      </span>
    </p>
  {/if}

  <div class="grid" class:dim bind:this={grid}>
    {#if !snap}
      <p class="message">Reading container status…</p>
    {:else if !snap.configured}
      <p class="message">Docker isn’t set up. Add a <code>[containers]</code> status file to <code>config.toml</code>.</p>
    {:else if !cards.length}
      <p class="message">{snap.error ? 'No container status yet.' : 'The status file lists no containers.'}</p>
    {:else}
      {#each rows as row, r (r)}
        <div class="row">
          {#each row as group (group.name)}
            {@const offset = offsets.get(group.name) ?? 0}
            <section class="group" style:--n={Math.min(group.containers.length, COLS)} aria-label={group.name}>
              {#if headings}<h2>{group.name}<small>{group.containers.length}</small></h2>{/if}
              <div class="cards">
                {#each group.containers as c, i (c.id)}
                  {@const label = headings ? shortName(c.name, group.name) : c.name}
                  <button class="card {c.colour}" class:focused={offset + i === focus} tabindex="-1"
                    onclick={() => { focus = offset + i; detail = c; }}>
                    {@render icon(c, label)}
                    <span class="text">
                      <span class="name">{label}</span>
                      <span class="sub">{repo(c)}</span>
                      <span class="line">{@render badge(c.colour, c.word)}<span class="when">{c.line}</span></span>
                    </span>
                  </button>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      {/each}
    {/if}
  </div>

  <footer><span class="k">↕↔</span>Move<span class="k">OK</span>Details<span class="k">↩</span>Back</footer>

  {#if detail}
    <aside class="detail {detail.colour}" aria-label="{detail.name} details">
      <div class="head">{@render icon(detail, detail.name, true)}<h3>{detail.name}</h3></div>
      {@render badge(detail.colour, detail.word)}
      <dl>
        <dt>Status</dt><dd>{detail.status || '—'}</dd>
        <dt>State</dt><dd>{detail.state}</dd>
        {#if detail.project}<dt>Stack</dt><dd>{detail.project}</dd>{/if}
        {#if detail.service}<dt>Service</dt><dd>{detail.service}</dd>{/if}
        <dt>Image</dt><dd class="mono-text">{displayImage(detail.image) || '—'}</dd>
        <dt>Container</dt><dd class="mono-text">{detail.id}</dd>
      </dl>
      <p class="hint">Read-only · <span class="k">OK</span> or <span class="k">↩</span> closes</p>
    </aside>
  {/if}
</div>

<style>
  /* The home screen stays mounted underneath (Home dismisses this view): hide it. */
  :global(html.containers-open #app > main) { visibility: hidden; }
  .view { position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column; padding: 2rem 3.2rem 0; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 2rem; }
  .title { display: flex; align-items: baseline; gap: 2.2rem; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 2.4rem; font-weight: 600; letter-spacing: -0.02em; }
  .counts { margin: 0; font-size: 1.35rem; display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; }
  .count { display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600; }
  .count :global(svg) { width: 1.35rem; height: 1.35rem; }
  .sep { color: var(--muted); }
  .updated { text-align: right; font-size: 1.35rem; }
  .updated small { display: block; font-size: 1.05rem; color: var(--muted); margin-top: 0.2rem; }
  .warning { display: flex; align-items: center; gap: 0.8rem; margin: 1rem 0 0; padding: 0.7rem 1.1rem; border-radius: 0.8rem;
             background: rgba(255, 176, 32, 0.12); box-shadow: inset 0 0 0 0.12rem rgba(255, 176, 32, 0.5); font-size: 1.2rem; color: #ffe2a8; }
  .warning :global(svg) { width: 1.8rem; height: 1.8rem; flex-shrink: 0; }

  /* Rows of stacks (packGroups): small stacks share a row; a stack of more than five cards has
     rows of its own. Padding keeps the focus ring clear of the scrolling edge. */
  .grid { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: none; margin: 0.6rem -1rem 0; padding: 0.6rem 1rem 1.6rem;
          display: flex; flex-direction: column; gap: 0.75rem; scroll-padding-block: 1rem 1.6rem; }
  .row { display: flex; gap: 1.4rem; }
  /* Stale or unreadable: grey the cards' contents, but never the focus ring. */
  .grid.dim .card > *, .grid.dim .card::before { filter: grayscale(0.85) brightness(0.7); }
  .group { --card: 17.5rem; }
  .group h2 { margin: 0 0 0.4rem 0.2rem; font-size: 1.15rem; font-weight: 700; color: #c3cad8; text-transform: lowercase; }
  .group h2 small { margin-left: 0.5rem; font-weight: 500; color: var(--muted); font-size: 0.95rem; }
  .cards { display: grid; grid-template-columns: repeat(var(--n), var(--card)); gap: 0.75rem; }

  .card { all: unset; position: relative; box-sizing: border-box; display: flex; align-items: center; gap: 0.75rem; height: 5.3rem;
          padding: 0.6rem 0.8rem 0.6rem 1.1rem; border-radius: 0.8rem; background: rgba(20, 25, 34, 0.88);
          box-shadow: 0 0 0 1px #262e3c; overflow: hidden; transition: transform 120ms ease, box-shadow 120ms ease; }
  /* The status bar: the card's left edge in its colour. */
  .card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 0.42rem; background: var(--c); }
  .card.focused { box-shadow: 0 0 0 0.28rem var(--focus-ring), 0 0 1.8rem var(--accent-glow); background: #1d2533; overflow: visible; }
  .card.focused::before { border-radius: 0.8rem 0 0 0.8rem; }
  .red { --c: #ff5c5c; } .amber { --c: #ffb020; } .green { --c: #3ddc84; } .grey { --c: #8b95a8; }
  .icon { flex-shrink: 0; width: 2.9rem; height: 2.9rem; display: flex; align-items: center; justify-content: center; }
  .icon img { width: 100%; height: 100%; object-fit: contain; }
  .icon.big { width: 4rem; height: 4rem; }
  .mono { width: 100%; height: 100%; border-radius: 0.6rem; display: flex; align-items: center; justify-content: center;
          background: hsl(var(--hue) 38% 30%); color: hsl(var(--hue) 70% 88%); font-weight: 800; font-size: 1.2rem; letter-spacing: 0.02em; }
  .big .mono { font-size: 1.6rem; }
  .text { min-width: 0; display: flex; flex-direction: column; gap: 0.12rem; }
  .name { font-size: 1.25rem; font-weight: 700; color: #f2f4f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { font-size: 0.9rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .line { display: flex; align-items: center; gap: 0.45rem; font-size: 0.95rem; white-space: nowrap; overflow: hidden; }
  .when { color: #b5bdcb; overflow: hidden; text-overflow: ellipsis; }
  .badge { display: inline-flex; align-items: center; gap: 0.3rem; color: var(--c); flex-shrink: 0; }
  .badge b { font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; font-size: 0.9rem; }
  .badge :global(svg) { width: 1.3rem; height: 1.3rem; }
  .message { margin: 6rem auto; font-size: 1.6rem; color: var(--muted); text-align: center; }

  footer { display: flex; align-items: center; gap: 0.5rem; padding: 0.7rem 0 1rem; font-size: 1.1rem; color: #9aa4b6; }
  .k { display: inline-flex; align-items: center; justify-content: center; min-width: 1.8rem; height: 1.8rem; padding: 0 0.45rem; margin: 0 0.3rem 0 0.9rem;
       border-radius: 0.45rem; background: #222a38; color: #fff; font-weight: 700; font-size: 0.95rem; }
  footer .k:first-child { margin-left: 0; }

  .detail { position: absolute; top: 0; right: 0; bottom: 0; width: 34rem; padding: 2.6rem 2.4rem; background: #121722;
            box-shadow: -1.5rem 0 4rem rgba(0, 0, 0, 0.6), inset 0.42rem 0 0 var(--c); display: flex; flex-direction: column; gap: 1.1rem; }
  .head { display: flex; align-items: center; gap: 1rem; }
  h3 { margin: 0; font-size: 2rem; word-break: break-word; }
  .detail .badge b { font-size: 1.3rem; }
  .detail .badge :global(svg) { width: 1.9rem; height: 1.9rem; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.75rem 1.4rem; margin: 0.4rem 0 0; font-size: 1.25rem; }
  dt { color: var(--muted); }
  dd { margin: 0; word-break: break-word; }
  .mono-text { font-family: 'JetBrains Mono', 'DejaVu Sans Mono', monospace; font-size: 1.05rem; }
  .hint { margin-top: auto; color: var(--muted); font-size: 1.1rem; }
  .hint .k { margin-left: 0.2rem; }
</style>
