<script lang="ts">
  import RemoteIcon from './RemoteIcon.svelte';
  import { REMOTE_LAYOUT, type ButtonDef } from '@shared/buttons';

  /** A drawing of the SofaBaton U1; `active` ids glow, `pressed` flashes. */
  let { buttons, active, pressed = null }: { buttons: ButtonDef[]; active: Set<string>; pressed?: string | null } = $props();

  const byId = $derived(new Map(buttons.map((b) => [b.id, b])));
  const positions: Record<string, string> = {
    power: '1 / 1 / 2 / 5', input: '1 / 9 / 2 / 13',
    menu: '2 / 1 / 3 / 5', home: '2 / 5 / 3 / 9', info: '2 / 9 / 3 / 13',
    ring: '3 / 4 / 6 / 10', volUp: '3 / 1 / 4 / 4', volDown: '5 / 1 / 6 / 4',
    chUp: '3 / 10 / 4 / 13', chDown: '5 / 10 / 6 / 13',
    mute: '6 / 1 / 7 / 7', back: '6 / 7 / 7 / 13',
    rew: '7 / 1 / 8 / 5', playPause: '7 / 6 / 9 / 8', ff: '7 / 9 / 8 / 13',
    record: '8 / 1 / 9 / 5', stop: '8 / 9 / 9 / 13',
    red: '9 / 1 / 10 / 4', green: '9 / 4 / 10 / 7', yellow: '9 / 7 / 10 / 10', blue: '9 / 10 / 10 / 13',
    minus: '13 / 1 / 14 / 5', digit0: '13 / 5 / 14 / 9', e: '13 / 9 / 14 / 13',
  };
  function position(id: string): string {
    const digit = /^digit([1-9])$/.exec(id);
    if (!digit) return positions[id]!;
    const n = Number(digit[1]) - 1;
    const row = 10 + Math.floor(n / 3);
    const column = 1 + (n % 3) * 4;
    return `${row} / ${column} / ${row + 1} / ${column + 4}`;
  }
  const DPAD = [
    { id: 'up', style: 'top: 0.6rem; left: 50%; transform: translateX(-50%)' },
    { id: 'down', style: 'bottom: 0.6rem; left: 50%; transform: translateX(-50%)' },
    { id: 'left', style: 'left: 0.9rem; top: 50%; transform: translateY(-50%)' },
    { id: 'right', style: 'right: 0.9rem; top: 50%; transform: translateY(-50%)' },
  ];
</script>

<div class="remote" aria-hidden="true">
  {#each REMOTE_LAYOUT as row, r (r)}
    {#each row as id, c (c)}
      {#if id === 'ring'}
        <div class="ring" style="grid-area: {positions.ring}">
          {#each DPAD as d (d.id)}
            <span class="dir" class:hi={active.has(d.id)} class:now={pressed === d.id} style={d.style}><RemoteIcon name={d.id as import("@shared/buttons").RemoteIconId} /></span>
          {/each}
          <div class="ok" class:hi={active.has('ok')} class:now={pressed === 'ok'}><RemoteIcon name="ok" /></div>
        </div>
      {:else if id !== null}
        {@const b = byId.get(id)}
        <div
          class="b {b?.color ?? ''}"
          class:hi={active.has(id)}
          class:now={pressed === id}
          class:dim={!active.has(id) && pressed !== id}
          style="grid-area: {position(id)}"
        >{#if b}{#if id === 'playPause'}<span class="play-stack"><RemoteIcon name="play" /><RemoteIcon name="pause" /></span>{:else}<RemoteIcon name={b.icon} />{/if}{/if}</div>
      {/if}
    {/each}
  {/each}
</div>

<style>
  .remote { background: linear-gradient(#20242c, #111317); border-radius: 5rem 5rem 7rem 7rem; padding: 2.4rem 2rem 2.8rem;
            display: grid; grid-template-columns: repeat(12, 1fr); grid-template-rows: repeat(13, 2.2rem); gap: 0.7rem 0.8rem; align-content: start;
            box-shadow: 0 0 0 1px #2b313c inset, 0 2rem 4rem rgba(0, 0, 0, 0.5); }
  .b { height: 100%; border-radius: 0.6rem; background: #2a2f39; display: flex; align-items: center; justify-content: center;
       font-size: 1rem; font-weight: 600; color: #cfd6e2; transition: background 150ms, box-shadow 150ms, opacity 150ms; }
  .b.dim { opacity: 0.45; }
  .b.hi { background: var(--accent); color: var(--accent-contrast); box-shadow: 0 0 1.2rem var(--accent-glow); }
  .b.red.hi, .b.green.hi, .b.yellow.hi, .b.blue.hi { background: #222a38; }
  .play-stack { display: flex; flex-direction: column; gap: 0.6rem; font-size: 0.8rem; }
  .b.red.hi { box-shadow: 0 0 1.2rem rgba(229, 72, 77, 0.9); } .b.green.hi { box-shadow: 0 0 1.2rem rgba(48, 164, 108, 0.9); }
  .b.yellow.hi { box-shadow: 0 0 1.2rem rgba(245, 217, 10, 0.9); } .b.blue.hi { box-shadow: 0 0 1.2rem rgba(62, 99, 221, 0.9); }
  .b.now:not(.red):not(.green):not(.yellow):not(.blue), .dir.now, .ok.now { background: var(--accent) !important; color: var(--accent-contrast) !important; box-shadow: 0 0 1.6rem var(--accent-glow); }
  .ring { position: relative; height: 100%; border-radius: 50%; background: #2a2f39; margin: 0;
          display: flex; align-items: center; justify-content: center; box-shadow: 0 0 0 1px #343a46 inset; }
  .dir { position: absolute; font-size: 0.85rem; line-height: 1; color: #7c8598; transition: color 150ms; }
  .dir.hi { color: var(--accent); text-shadow: 0 0 0.8rem var(--accent-glow); }
  .ok { width: 2.8rem; height: 2.8rem; border-radius: 50%; background: #3a404c; display: flex; align-items: center; justify-content: center;
        font-size: 1.1rem; font-weight: 700; color: #cfd6e2; transition: background 150ms, box-shadow 150ms; }
  .ok.hi { background: var(--accent); color: var(--accent-contrast); box-shadow: 0 0 1.2rem var(--accent-glow); }
</style>
