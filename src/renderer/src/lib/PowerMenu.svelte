<script lang="ts">
  import { onMount } from 'svelte';
  import Menu from './Menu.svelte';

  let { onclose }: { onclose: () => void } = $props();
  let confirming = $state(false);
  let username = $state('');
  let failed = $state(false);
  onMount(() => { void window.sofa.username().then((name) => (username = name)); });
  const options = [
    { id: 'close', icon: 'M6 6l12 12M18 6L6 18', label: 'Close Sofa Launcher' },
    { id: 'logout', icon: 'M9 3H3v18h6M10 12h12m-5-5 5 5-5 5', label: 'Log off' },
    { id: 'screen', icon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z', label: 'Turn screen off' },
    { id: 'cancel', remoteIcon: 'back', icon: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', label: 'Cancel' },
  ] as const;

  async function choose(id: string) {
    if (id === 'logout') { confirming = true; return; }
    onclose();
    if (id === 'close') await window.sofa.closeLauncher();
    if (id === 'screen') await window.sofa.screenOff();
  }
  const confirmOptions = [
    { id: 'cancel', remoteIcon: 'back', icon: '', label: 'Cancel' },
    { id: 'logout', icon: 'M9 3H3v18h6M10 12h12m-5-5 5 5-5 5', label: 'Log off', hint: 'Apps will close.' },
  ] as const;
  async function confirm(id: string) {
    if (id === 'cancel') { confirming = false; return; }
    try { await window.sofa.logOff(); onclose(); }
    catch { failed = true; }
  }
</script>

{#if confirming}
  <Menu title={failed ? 'Couldn’t log off. Try again?' : `Log off ${username}? Apps will close.`} options={confirmOptions} initialFocus={0} onchoose={confirm} onclose={() => (confirming = false)} />
{:else}
  <Menu title="Power" {options} onchoose={choose} {onclose} />
{/if}
