<script lang="ts">
  import { onMount } from 'svelte';
  import Menu from './Menu.svelte';

  /** `start`: open straight at a confirmation (the remote's Input button on Home asks to switch account). */
  let { onclose, start = null }: { onclose: () => void; start?: 'switch' | null } = $props();
  // svelte-ignore state_referenced_locally (where the menu opens; it is not re-opened by a prop change)
  let confirming = $state<'logout' | 'switch' | null>(start);
  let username = $state('');
  let failed = $state(false);
  onMount(() => { void window.sofa.username().then((name) => (username = name)); });
  const SWITCH = 'M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7';
  const LOGOUT = 'M9 3H3v18h6M10 12h12m-5-5 5 5-5 5';
  const options = [
    { id: 'close', icon: 'M6 6l12 12M18 6L6 18', label: 'Close Sofa Launcher', hint: 'Back to the desktop.' },
    { id: 'switch', icon: SWITCH, label: 'Switch account' },
    { id: 'logout', icon: LOGOUT, label: 'Log off' },
    { id: 'screen', icon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z', label: 'Turn screen off' },
    { id: 'cancel', remoteIcon: 'back', icon: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', label: 'Cancel' },
  ] as const;

  async function choose(id: string) {
    if (id === 'logout' || id === 'switch') { failed = false; confirming = id; return; }
    onclose();
    if (id === 'close') await window.sofa.closeLauncher();
    if (id === 'screen') await window.sofa.screenOff();
  }
  const confirmOptions = $derived(confirming === 'switch'
    ? [{ id: 'cancel', remoteIcon: 'back', icon: '', label: 'Cancel' }, { id: 'go', icon: SWITCH, label: 'Switch account', hint: 'Shows the login screen.' }] as const
    : [{ id: 'cancel', remoteIcon: 'back', icon: '', label: 'Cancel' }, { id: 'go', icon: LOGOUT, label: 'Log off', hint: 'Apps will close.' }] as const);
  const title = $derived(confirming === 'switch'
    ? (failed ? 'Couldn’t show the login screen. Try again?' : `Switch account? ${username} stays signed in, locked.`)
    : (failed ? 'Couldn’t log off. Try again?' : `Log off ${username}? Apps will close.`));
  /** Leaving a confirmation: back to the menu, or away entirely when it was opened directly. */
  function leave() { if (start) onclose(); else confirming = null; }
  async function confirm(id: string) {
    if (id === 'cancel') return leave();
    try {
      if (confirming === 'switch') await window.sofa.switchAccount(); else await window.sofa.logOff();
      onclose();
    } catch { failed = true; }
  }
</script>

{#if confirming}
  <Menu {title} options={confirmOptions} initialFocus={0} onchoose={confirm} onclose={leave} />
{:else}
  <Menu title="Power" {options} onchoose={choose} {onclose} />
{/if}
