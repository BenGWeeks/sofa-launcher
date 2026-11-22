<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    countParts, displayImage, FILTER_FOR_COLOUR, FILTER_LABELS, groupContainers, iconFor, matchesFilter, monogram, OTHER_GROUP, packGroups, shortName,
    type ContainerColour, type ContainerFilter, type ContainerHistorySeries, type ContainerInfo, type ContainersSnapshot,
  } from '@shared/containers';
  import StatusGlyph from './StatusGlyph.svelte';
  import { BACK_KEYS } from './nav';
  import RemoteIcon from './RemoteIcon.svelte';
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
  /** The open container's last 24 hours (null until read, or when the launcher has none). */
  let history = $state<ContainerHistorySeries | null>(null);
  let historyFor = '';

  async function loadHistory() {
    const name = detail?.name ?? '';
    if (name !== historyFor) { history = null; historyFor = name; }
    if (!name) return;
    const next = await window.sofaContainers.history(name).catch(() => null);
    if (detail?.name === name) history = next;
  }
  $effect(() => { void detail?.name; void loadHistory(); });
  let polls = 0;

  // ---- restart and update (only when this account may: the snapshot says so) -----
  type Action = 'restart' | 'update';
  /** Which panel button has the highlight, and which action we are asking "are you sure?" about. */
  let choice = $state<'close' | Action>('close');
  let confirming = $state<Action | null>(null);
  /** The container being restarted or updated, while waiting for the answer. */
  let working = $state<{ name: string; verb: Action } | null>(null);
  /** When the confirmation appeared: a double-click must not also be the answer to it. */
  let askedAt = 0;
  let outcome = $state<{ ok: boolean; message: string; verb: Action } | null>(null);
  /** Only what is running: this never starts something that was stopped. */
  const canRestart = $derived(!!snap?.canRestart && !!detail?.restartable && detail.state === 'running');
  /** Only an opted-in (sofa.update) running container with a newer image, for an account the update service lets in. */
  const canUpdate = $derived(!!snap?.canUpdate && !!detail?.updatable && detail.state === 'running' && detail.update?.available === true);
  const buttons = $derived<('close' | Action)[]>(['close', ...(canRestart ? ['restart' as const] : []), ...(canUpdate ? ['update' as const] : [])]);

  function openDetail(c: ContainerInfo | null) {
    detail = c; choice = 'close'; confirming = null; outcome = null;
  }

  async function act(verb: Action) {
    const target = detail;
    if (!target || working) return;
    working = { name: target.name, verb }; confirming = null; outcome = null;
    const ask = verb === 'update' ? window.sofaContainers.update : window.sofaContainers.restart;
    const result = await ask(target.name).catch(() => ({ ok: false, message: `The launcher could not ask for the ${verb}` }));
    working = null; choice = 'close';
    if (detail?.name === target.name) outcome = { ...result, verb };
    void refresh(true);
  }

  /** OK and the arrows inside the details panel. */
  function panelKey(key: string) {
    if (working) return;
    if (buttons.length < 2) { if (key === 'Enter') openDetail(null); return; }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const row: ('close' | Action)[] = confirming ? ['close', confirming] : buttons;
      const at = Math.max(0, row.indexOf(choice));
      choice = row[(at + (key === 'ArrowRight' ? 1 : -1) + row.length) % row.length]!;
      return;
    }
    if (key !== 'Enter') return;
    if (choice === 'close') { if (confirming) confirming = null; else openDetail(null); }
    else if (confirming === choice) void act(choice);
    // Asking moves the highlight to Cancel: a second OK by reflex must not restart or update anything.
    else { confirming = choice; choice = 'close'; outcome = null; askedAt = Date.now(); }
  }

  /** A mouse click on a panel button (the remote uses the keys). */
  function click(which: 'close' | Action) {
    if (confirming && which !== 'close' && Date.now() - askedAt < 700) return;
    choice = which; panelKey('Enter');
  }

  /** What an answer says on screen: "web was restarted", "web: already up to date". */
  function said(o: { ok: boolean; message: string; verb: Action }, name: string): string {
    if (!o.ok) return o.message;
    if (o.message === 'Restarted') return `${name} was restarted`;
    if (o.message === 'Updated') return `${name} was updated`;
    return `${name}: ${o.message[0]!.toLowerCase()}${o.message.slice(1)}`;
  }

  const STATUS_WORDS: Record<ContainerColour, string> = { green: 'Running', amber: 'Not ready', red: 'Problem', grey: 'Stopped' };
  const ORDER: ContainerColour[] = ['green', 'amber', 'red', 'grey'];
  /** The strip as runs of one status, so neighbouring slices draw as one block. */
  const runs = $derived.by(() => {
    const out: { colour: ContainerColour | null; from: number; length: number }[] = [];
    for (const [i, p] of (history?.points ?? []).entries()) {
      const last = out.at(-1);
      if (last && last.colour === p.colour) last.length++; else out.push({ colour: p.colour, from: i, length: 1 });
    }
    return out;
  });
  const seen = $derived(ORDER.filter((c) => history?.points.some((p) => p.colour === c)));
  const gaps = $derived(!!history?.points.some((p) => p.colour === null));
  const recorded = $derived(history ? history.coveredMs / 3_600_000 : 0);
  /** Rounded down, so 99.96% never reads as 100%. */
  const percent = (v: number) => (v >= 100 ? '100' : (Math.floor(v * 10) / 10).toFixed(1));
  const cpuText = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
  const memText = (v: number) => (v >= 2 ** 30 ? `${(v / 2 ** 30).toFixed(1)} GB` : `${Math.max(1, Math.round(v / 2 ** 20))} MB`);

  /** A line (and the area under it) over the 24 hours; slices without a value break the line. */
  function trace(key: 'cpu' | 'mem') {
    const values = (history?.points ?? []).map((p) => p[key]);
    const known = values.filter((v): v is number => v !== null);
    if (known.length < 2) return null;
    const peak = Math.max(...known), top = peak || 1;
    const y = (v: number) => 38 - (v / top) * 34;
    let line = '', area = '', open = false, startX = 0, lastX = 0;
    values.forEach((v, i) => {
      const x = i + 0.5;
      if (v === null) { if (open) { area += `L${lastX} 38L${startX} 38Z`; open = false; } return; }
      line += `${open ? 'L' : 'M'}${x} ${y(v).toFixed(2)}`;
      area += `${open ? 'L' : 'M'}${x} ${y(v).toFixed(2)}`;
      if (!open) { startX = x; open = true; }
      lastX = x;
    });
    if (open) area += `L${lastX} 38L${startX} 38Z`;
    return { line, area, peak };
  }
  const cpu = $derived(trace('cpu'));
  const mem = $derived(trace('mem'));

  /** Red, green, yellow or blue on the remote (or a click on a count): only those cards. The same again: all. */
  let filter = $state<ContainerFilter | null>(null);
  function toggleFilter(f: ContainerFilter) {
    if (working) return;
    filter = filter === f ? null : f;
    focus = 0;
    openDetail(null);
  }
  const shown = $derived(filter ? (snap?.containers ?? []).filter((c) => matchesFilter(c, filter!)) : snap?.containers ?? []);
  const groups = $derived(groupContainers(shown));
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
  /** A version for the one-line Update row: long tags are cut, the panel cannot scroll. */
  const short = (v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v);
  /** "valkey/valkey:9" → "9"; no tag means "latest". */
  const tagOf = (image: string) => { const i = image.lastIndexOf(':'); return i > image.lastIndexOf('/') ? image.slice(i + 1) : 'latest'; };
  const updates = $derived((snap?.containers ?? []).filter((c) => c.update?.available).length);
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
      // The history gains a reading a minute: no need to redraw it on every 10 s poll.
      if (++polls % 6 === 0) void loadHistory();
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

  /** Back: one step out (confirmation, then details, then the view). */
  function back() {
    if (working) { /* wait for the answer */ } else if (confirming) confirming = null; else if (detail) openDetail(null); else onclose();
  }

  function onkeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.repeat && !e.key.startsWith('Arrow')) { e.preventDefault(); return; }
    if (BACK_KEYS.has(e.key)) back(); else if (e.key === 'Enter') {
      if (detail) panelKey('Enter'); else openDetail(cards[focus] ?? null);
    } else if (e.key === ' ' && detail) {
      // Space would press whichever button a mouse click left focused: only OK chooses.
    } else if (e.key.startsWith('Arrow')) {
      if (detail) { panelKey(e.key); e.preventDefault(); return; }
      focus = spatialMove(boxes(), focus, e.key);
      void reveal();
    } else return;
    e.preventDefault();
  }

  // Fewer cards after a refresh or a filter: keep the highlight on one that exists.
  $effect(() => { if (focus >= cards.length && cards.length) focus = cards.length - 1; });

  onMount(() => {
    document.documentElement.classList.add('containers-open');
    void window.sofa.containersView(true);
    const onFilter = (e: Event) => toggleFilter((e as CustomEvent<ContainerFilter>).detail);
    window.addEventListener('sofa-containers-filter', onFilter);
    void refresh(true);
    const poll = setInterval(() => void refresh(), REFRESH_MS);
    const ticker = setInterval(() => (now = Date.now()), 1000);
    return () => {
      clearInterval(poll); clearInterval(ticker);
      window.removeEventListener('sofa-containers-filter', onFilter);
      void window.sofa.containersView(false);
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

<!-- "A newer image exists": an arrow in a ring, always beside or labelled with words. -->
{#snippet arrow()}
  <svg class="up" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2" /><path d="M12 17V8m-4 3.5L12 7.5l4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
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
        <!-- Each count is also a filter (the remote's coloured buttons do the same). -->
        {#each counts as part, i}{#if i}<span class="sep">·</span>{/if}<button class="count {part.colour}" class:on={filter === FILTER_FOR_COLOUR[part.colour]} class:off={!!filter && filter !== FILTER_FOR_COLOUR[part.colour]} tabindex="-1" onclick={() => toggleFilter(FILTER_FOR_COLOUR[part.colour])}><StatusGlyph colour={part.colour} />{part.text}</button>{/each}
        {#if updates}<span class="sep">·</span><button class="count newer" class:on={filter === 'updates'} class:off={!!filter && filter !== 'updates'} tabindex="-1" onclick={() => toggleFilter('updates')}>{@render arrow()}{updates} {updates === 1 ? 'update' : 'updates'}</button>{/if}
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
    {:else if !cards.length && filter}
      <p class="message">No containers match <b>{FILTER_LABELS[filter]}</b>. Press the same colour again, or click it above, to show all.</p>
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
                    onclick={() => { if (!working) { focus = offset + i; openDetail(c); } }}>
                    {@render icon(c, label)}
                    {#if c.update?.available}<span class="newer corner" title="Update available">{@render arrow()}<span class="sr">Update available</span></span>{/if}
                    <span class="text">
                      <span class="name" class:marked={!!c.update?.available}>{label}</span>
                      <span class="sub">{c.description || repo(c)}</span>
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

  <footer><span class="k">↕↔</span>Move<span class="k">OK</span>Details<span class="k colours" aria-hidden="true"><i class="red"></i><i class="green"></i><i class="yellow"></i><i class="blue"></i></span>{filter ? `${FILTER_LABELS[filter]} only` : 'Filter'}<button class="hint" onclick={back}><span class="k"><RemoteIcon name="back" /></span>Back</button></footer>

  {#if detail}
    <!-- For a mouse: a click anywhere left of the details closes them, as Back does. -->
    <button class="shade" tabindex="-1" aria-label="Close details" onclick={back}></button>
    <aside class="detail {detail.colour}" aria-label="{detail.name} details">
      <div class="head">{@render icon(detail, detail.name, true)}<h3>{detail.name}</h3></div>
      {@render badge(detail.colour, detail.word)}
      {#if detail.description}<p class="about">{detail.description}</p>{/if}
      <dl>
        <dt>Status</dt><dd>{detail.status || '—'}</dd>
        {#if detail.project}<dt>Stack</dt><dd>{detail.project}</dd>{/if}
        {#if detail.service}<dt>Service</dt><dd>{detail.service}</dd>{/if}
        <dt>Image</dt><dd class="mono-text">{displayImage(detail.image) || '—'}</dd>
        {#if detail.update && detail.update.available !== null}
          {@const u = detail.update}
          <dt>Update</dt>
          <dd>
            {#if u.available}
              <span class="newer inline">{@render arrow()}Available</span>
              <!-- Each on its own smaller line under Available: the versions, or for a floating tag the tag and image digests. -->
              {#if u.kind === 'pinned' && u.latest && u.latest !== u.current}<small class="mono-text versions">{short(u.current) || '?'} → {short(u.latest)}</small>
              {:else if u.kind === 'floating'}
                <small class="quiet">A newer image for tag <span class="mono-text">{tagOf(detail.image)}</span></small>
                {#if u.current && u.latest && u.latest !== u.current}<small class="mono-text quiet">{short(u.current)} → {short(u.latest)}</small>{/if}
              {/if}
            {:else}Up to date{/if}
            {#if u.checkedAt && u.checkedAt <= now + 300_000}<small class="quiet">checked {ago(u.checkedAt)}</small>{/if}
          </dd>
        {/if}
      </dl>
      {#if history && history.coveredMs}
        <section class="history" aria-label="Last 24 hours">
          <h4>Last 24 hours
            {#if history.runningPct !== null}<small>running {percent(history.runningPct)}% of {recorded >= 23.9 ? 'the time' : `the ${recorded < 1 ? `${Math.round(recorded * 60)} min` : `${Math.round(recorded)} h`} recorded`}</small>{/if}
          </h4>
          <svg class="strip" viewBox="0 0 {history.points.length} 10" preserveAspectRatio="none" role="img"
            aria-label="Status over the last 24 hours">
            <rect class="track" x="0" y="0" width={history.points.length} height="10" />
            {#each runs as run}{#if run.colour}<rect class={run.colour} x={run.from} y="0" width={run.length} height="10" />{/if}{/each}
          </svg>
          <div class="axis"><span>24 h ago</span><span>12 h</span><span>now</span></div>
          <p class="legend">
            {#each seen as colour}<span class="{colour}"><StatusGlyph {colour} />{STATUS_WORDS[colour]}</span>{/each}
            {#if gaps}<span><i class="none"></i>No reading</span>{/if}
          </p>
          {#each [{ title: 'CPU', t: cpu, now: detail.cpu, text: cpuText, unit: ' of a core' }, { title: 'Memory', t: mem, now: detail.mem, text: memText, unit: '' }] as chart (chart.title)}
            {#if chart.t}
              <div class="usage">
                <p><b>{chart.title}</b><span>{chart.now === null ? 'not running now' : `${chart.text(chart.now)}${chart.unit} now`}</span><span class="peak">peak {chart.text(chart.t.peak)}</span></p>
                <svg viewBox="0 0 {history.points.length} 40" preserveAspectRatio="none" role="img"
                  aria-label="{chart.title} over the last 24 hours: {chart.now === null ? 'not running now' : `now ${chart.text(chart.now)}`}, peak {chart.text(chart.t.peak)}">
                  <line class="base" x1="0" y1="38" x2={history.points.length} y2="38" />
                  <path class="area" d={chart.t.area} /><path class="trace" d={chart.t.line} />
                </svg>
              </div>
            {/if}
          {/each}
        </section>
      {/if}
      {#if buttons.length > 1 || working || outcome}
        <div class="actions">
          {#if working}
            <p class="note" role="status">{working.verb === 'update' ? `Updating ${working.name}… downloading the newer image can take a few minutes` : `Restarting ${working.name}…`}</p>
          {:else}
            {#if outcome}<p class="note {outcome.ok ? 'green' : 'red'}" role="status"><StatusGlyph colour={outcome.ok ? 'green' : 'red'} />{said(outcome, detail.name)}</p>{/if}
            {#if confirming === 'restart'}<p class="note" role="alert">Restart {detail.name}? It will be unavailable for a moment.</p>
            {:else if confirming === 'update' && detail.update}
              {@const u = detail.update}
              <p class="note" role="alert">
                <span>Update {detail.name} to the newer image? It restarts with it: unavailable for a moment, and a faulty image could stop it working.
                  <small class="mono-text">{detail.image}: {u.kind === 'floating' ? `${short(u.current)} → ${short(u.latest)} (tag ${tagOf(detail.image)})` : `${short(u.current) || '?'} → ${short(u.latest)}`}</small></span>
              </p>
            {/if}
            {#if buttons.length > 1}
              <div class="buttons">
                <button class:focused={choice === 'close'} tabindex="-1" onclick={() => click('close')}>{confirming ? 'Cancel' : 'Close'}</button>
                {#if confirming}
                  <button class="go" class:focused={choice === confirming} tabindex="-1" onclick={() => click(confirming!)}>{confirming === 'update' ? 'Update now' : 'Restart now'}</button>
                {:else}
                  {#if canRestart}<button class="go" class:focused={choice === 'restart'} tabindex="-1" onclick={() => click('restart')}>Restart</button>{/if}
                  {#if canUpdate}<button class="go" class:focused={choice === 'update'} tabindex="-1" onclick={() => click('update')}>Update</button>{/if}
                {/if}
              </div>
            {/if}
          {/if}
        </div>
      {/if}
      {#if buttons.length > 1}
        <p class="hint"><span class="k">↔</span>Choose<span class="k">OK</span>Select<button class="hint-button" onclick={back}><span class="k"><RemoteIcon name="back" /></span>{confirming ? 'Cancel' : 'Close'}</button></p>
      {:else}
        <!-- A tag, apart from the keys: this account can look but not restart (no restart service for it). -->
        <p class="hint ro"><span class="tag" title="This account can’t restart containers">Read-only</span><button class="hint-button" onclick={back}><span class="k">OK</span> or <span class="k"><RemoteIcon name="back" /></span> closes</button></p>
      {/if}
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
  button.count { all: unset; display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600; cursor: pointer; border-radius: 0.5rem; padding: 0.1rem 0.35rem; margin: 0 -0.35rem; }
  button.count:hover { background: #1c2330; }
  button.count.on { box-shadow: 0 0 0 0.15rem currentColor; }
  button.count.off { opacity: 0.45; }
  /* The remote's four coloured buttons, in the footer's key hint. */
  .k.colours { gap: 0.2rem; padding: 0 0.45rem; }
  .k.colours i { width: 0.55rem; height: 0.55rem; border-radius: 50%; }
  .k.colours .red { background: #ff5b5b; } .k.colours .green { background: #3ddc84; } .k.colours .yellow { background: #ffc83d; } .k.colours .blue { background: #4d8dff; }
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

  /* Everything left of the details: invisible, and only there to take a mouse click. */
  .shade { all: unset; position: absolute; top: 0; left: 0; bottom: 0; right: 34rem; cursor: pointer; }
  /* A hand over a card (it opens the details) and over the details' controls, for a mouse. */
  .card, .detail button { cursor: pointer; }
  .hint-button { all: unset; cursor: pointer; } .hint-button:hover { color: #fff; }
  .hint.ro { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .tag { padding: 0.15rem 0.6rem; border-radius: 1rem; border: 1px solid #3a4456; color: var(--muted); font-size: 0.85rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
  .detail { position: absolute; top: 0; right: 0; bottom: 0; width: 34rem; padding: 1.6rem 2.4rem 1.2rem; overflow: hidden; background: #121722;
            box-shadow: -1.5rem 0 4rem rgba(0, 0, 0, 0.6), inset 0.42rem 0 0 var(--c); display: flex; flex-direction: column; gap: 0.9rem; }
  .head { display: flex; align-items: center; gap: 1rem; }
  h3 { margin: 0; font-size: 2rem; word-break: break-word; }
  .detail .badge b { font-size: 1.3rem; }
  .detail .badge :global(svg) { width: 1.9rem; height: 1.9rem; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 0.45rem 1.4rem; margin: 0.2rem 0 0; font-size: 1.15rem; }
  dt { color: var(--muted); }
  dd { margin: 0; word-break: break-word; }
  .mono-text { font-family: 'JetBrains Mono', 'DejaVu Sans Mono', monospace; font-size: 1.05rem; }
  /* Three lines at most: the panel cannot scroll, and the charts below must stay on screen. */
  /* Updates: the blue of the usage lines, never a status colour (an update is not a fault). */
  .newer { color: #6aa9ff; }
  .up { width: 1.35rem; height: 1.35rem; flex-shrink: 0; }
  .corner { position: absolute; top: 0.35rem; right: 0.4rem; display: flex; }
  .corner .up { width: 1.25rem; height: 1.25rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .inline { display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 700; margin-right: 0.6rem; }
  .quiet { color: var(--muted); }
  .name.marked { padding-right: 1.3rem; }
  .versions { white-space: nowrap; }
  dd small { display: block; font-size: 1rem; margin-top: 0.1rem; }
  dd small.mono-text { font-size: 0.95rem; }
  .about { margin: 0; font-size: 1.25rem; line-height: 1.35; color: #d5dae4; display: -webkit-box; -webkit-box-orient: vertical;
           -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; flex-shrink: 0; }
  /* History: status colours are the view's own (always beside a glyph and word in the legend);
     the usage lines are one neutral blue each on its own scale, with the numbers in text. */
  .history { display: flex; flex-direction: column; gap: 0.45rem; margin-top: 0.3rem; padding-top: 0.9rem; border-top: 1px solid #262e3c; }
  h4 { margin: 0; display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; font-size: 1.2rem; font-weight: 700; }
  h4 small { font-size: 1.05rem; font-weight: 500; color: #b5bdcb; }
  .strip { width: 100%; height: 1.5rem; border-radius: 0.35rem; }
  .strip .track { fill: #222a38; }
  .strip rect:not(.track) { fill: var(--c); }
  .axis { display: flex; justify-content: space-between; font-size: 0.95rem; color: var(--muted); }
  .legend { margin: 0; display: flex; flex-wrap: wrap; gap: 0.3rem 1.1rem; font-size: 1rem; color: #c3cad8; }
  .legend span { display: inline-flex; align-items: center; gap: 0.35rem; }
  .legend :global(svg) { width: 1.15rem; height: 1.15rem; color: var(--c); }
  .legend .none { width: 1rem; height: 1rem; border-radius: 0.2rem; background: #222a38; box-shadow: inset 0 0 0 1px #3a4456; }
  .usage { margin-top: 0.3rem; }
  .usage p { margin: 0 0 0.25rem; display: flex; align-items: baseline; gap: 0.8rem; font-size: 1.1rem; }
  .usage b { font-weight: 700; }
  .usage .peak { margin-left: auto; color: var(--muted); font-size: 1rem; }
  .usage svg { display: block; width: 100%; height: 2.5rem; }
  .usage .trace { fill: none; stroke: #6aa9ff; stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
  .usage .area { fill: rgba(106, 169, 255, 0.14); }
  .usage .base { stroke: #2c3546; stroke-width: 1; vector-effect: non-scaling-stroke; }
  .history { flex-shrink: 0; }
  .history > * { flex-shrink: 0; }
  .head, .detail > .badge, dl { flex-shrink: 0; }
  h3 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
  .actions { flex-shrink: 0; margin-top: auto; display: flex; flex-direction: column; gap: 0.6rem; }
  .actions + .hint { margin-top: 0; }
  .note { margin: 0; display: flex; align-items: center; gap: 0.5rem; font-size: 1.15rem; color: #e6e9f0; }
  .note :global(svg) { width: 1.4rem; height: 1.4rem; flex-shrink: 0; color: var(--c); }
  .buttons { display: flex; gap: 0.8rem; }
  .buttons button { all: unset; box-sizing: border-box; flex: 1; text-align: center; padding: 0.65rem 1rem; border-radius: 0.7rem; background: #222a38;
                    font-size: 1.2rem; font-weight: 700; color: #e6e9f0; }
  .buttons button.focused { box-shadow: 0 0 0 0.25rem var(--focus-ring), 0 0 1.4rem var(--accent-glow); background: #2b3547; color: #fff; }
  .hint { flex-shrink: 0; margin-top: auto; color: var(--muted); font-size: 1.1rem; }
  .hint .k { margin-left: 0.2rem; }
  /* Back is also a button, for a mouse. */
  .hint { all: unset; cursor: pointer; } .hint:hover { color: #fff; }
</style>
