<script lang="ts">
  /**
   * The ✕ in a pop-up's top-right corner, for a mouse: it does what Back does (a sub-menu goes back
   * a step). Not part of the remote's navigation, which keeps Back. The box must be positioned.
   */
  let { onclick }: { onclick: () => void } = $props();
</script>

<button class="close" tabindex="-1" aria-label="Close" title="Close" {onclick}>
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
</button>

<style>
  .close { all: unset; position: absolute; top: 1rem; right: 1rem; width: 2.6rem; height: 2.6rem; border-radius: 50%;
           display: grid; place-items: center; cursor: pointer; color: var(--muted); }
  .close:hover { background: #222a38; color: #fff; }
  .close svg { width: 1.4rem; height: 1.4rem; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
</style>
