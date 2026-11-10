<script lang="ts">
  import { onMount } from 'svelte';
  let items = $state<{ id: number; text: string }[]>([]);
  let next = 0;
  onMount(() =>
    window.sofa.onToast(({ text }) => {
      const id = next++;
      items = [...items.slice(-2), { id, text }];
      setTimeout(() => (items = items.filter((t) => t.id !== id)), 3500);
    }),
  );
</script>

<div class="toasts" aria-live="polite">
  {#each items as t (t.id)}<div class="toast">{t.text}</div>{/each}
</div>

<style>
  .toasts { position: fixed; left: 50%; top: 3rem; transform: translateX(-50%); display: flex;
            flex-direction: column; align-items: center; gap: 0.8rem; z-index: 20; }
  .toast { padding: 1rem 2rem; border-radius: 3rem; font-size: 1.5rem; font-weight: 600; max-width: 70rem;
           background: rgba(18, 22, 30, 0.92); box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 0.8rem 2rem rgba(0, 0, 0, 0.5);
           animation: in 180ms ease-out; }
  @keyframes in { from { opacity: 0; transform: translateY(-0.6rem); } }
</style>
