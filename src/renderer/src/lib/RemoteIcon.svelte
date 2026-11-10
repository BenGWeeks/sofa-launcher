<script lang="ts">
  import type { RemoteIconId } from '@shared/buttons';
  let { name }: { name: RemoteIconId } = $props();
  const paths: Partial<Record<RemoteIconId, string>> = {
    power: 'M12 2v10M7 4.5a9 9 0 1 0 10 0',
    input: 'M8 3h13v18H8v-6M8 9V3M2 12h13m-5-4 5 4-5 4',
    menu: 'M3 5h18M3 12h18M3 19h18', home: 'M2 11 12 2l10 9h-4v11H6V11z',
    info: 'M12 11v7M12 6.5v.1', back: 'M9 4 3 8l6 4M3 8h14q4 0 4 4v5q0 3-3 3h-5',
    up: 'M12 3 22 21H2z', down: 'M2 3h20L12 21z', left: 'M3 12 21 2v20z', right: 'M3 2 21 12 3 22z',
    chUp: 'M3 16 12 7l9 9', chDown: 'M3 8 12 17l9-9',
    volUp: 'M3 9h4l8-6v18l-8-6H3zM19 8v8M22 5v14',
    volDown: 'M3 9h4l8-6v18l-8-6H3zM20 9v6', mute: 'M3 9h4l8-6v18l-8-6H3zM4 22 21 2', minus: 'M7 12h10',
  };
  const colors = { red: '#e5484d', green: '#30a46c', yellow: '#f5d90a', blue: '#3e63dd' };
</script>
<svg class="remote-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'info' || name === 'ok'}<circle cx="12" cy="12" r="10" />{/if}
  {#if paths[name]}<path d={paths[name]} />
  {:else if name in colors}<rect x="2" y="10" width="20" height="4" rx="1" fill={colors[name as keyof typeof colors]} stroke="none" />
  {:else if name === 'play'}<path d="M5 2 22 12 5 22z" fill="currentColor" stroke="none" />
  {:else if name === 'pause'}<path d="M8 4v16M16 4v16" stroke-width="4" />
  {:else if name === 'playPause'}<path d="M2 3 12 8 2 13zM16 3v18M22 3v18" fill="currentColor" stroke-width="2.8" />
  {:else if name === 'rew' || name === 'ff'}<path d={name === 'rew' ? 'M12 4 2 12l10 8zM22 4 12 12l10 8z' : 'M2 4 12 12 2 20zM12 4 22 12 12 20z'} fill="currentColor" stroke="none" />
  {:else if name === 'stop'}<rect x="4" y="4" width="16" height="16" rx=".5" fill="currentColor" stroke="none" />
  {:else if name === 'record'}<circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" />
  {:else}<text x="12" y="12" dy=".35em" text-anchor="middle" fill="currentColor" stroke="none" font-size={name === 'ok' ? '11' : '21'} font-family="sans-serif">{name === 'ok' ? 'OK' : name === 'e' ? 'E' : name}</text>{/if}
</svg>
<style>
  .remote-icon { width: 1.5em; height: 1.5em; display: inline-block; flex: none; vertical-align: middle; }
</style>
