<script lang="ts">
  import type { ContainerColour } from '@shared/containers';
  /** A shape per status, so colour is never the only signal: ✓ circle, ! triangle, × octagon, ■ ring. */
  let { colour }: { colour: ContainerColour } = $props();
</script>

<svg viewBox="0 0 24 24" aria-hidden="true" class={colour}>
  {#if colour === 'green'}
    <circle cx="12" cy="12" r="10" fill="#3ddc84" /><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#06120c" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
  {:else if colour === 'amber'}
    <path d="M12 2.5L22.5 21h-21z" fill="#ffb020" stroke="#ffb020" stroke-width="1.5" stroke-linejoin="round" /><path d="M12 9v5.5" stroke="#1a1002" stroke-width="2.6" stroke-linecap="round" /><circle cx="12" cy="17.8" r="1.5" fill="#1a1002" />
  {:else if colour === 'red'}
    <path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" fill="#ff5c5c" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#2a0606" stroke-width="2.6" stroke-linecap="round" />
  {:else}
    <circle cx="12" cy="12" r="9" fill="none" stroke="#8b95a8" stroke-width="2.4" /><rect x="8.5" y="8.5" width="7" height="7" rx="1" fill="#8b95a8" />
  {/if}
</svg>

<style>
  svg { flex-shrink: 0; display: block; }
</style>
