<script lang="ts">
  import { onMount } from 'svelte';
  import { followAppearanceState } from './appearance';
  import { DEFAULT_BACKGROUND } from '@shared/backgrounds';
  import type { Background, Theme } from '@shared/types';
  import { BROWSER_NAMES, type BrowserChoice, type BrowserState } from '@shared/browsers';
  import Menu from './Menu.svelte';
  import BackgroundPicker from './BackgroundPicker.svelte';
  import EditHome from './EditHome.svelte';
  import { untrack } from 'svelte';

  let { onchoose, onclose, initial }: {
    onchoose: (id: 'button-test' | 'guide' | 'about') => void;
    onclose: () => void;
    /** Open a sub-screen straight away (screenshots). */
    initial?: 'edit-home';
  } = $props();
  const options = [
    { id: 'button-test', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', label: 'Button test', hint: 'Check every remote button' },
    { id: 'guide', remoteIcon: 'info', icon: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01', label: 'Remote guide', hint: 'What each button does' },
    { id: 'theme', icon: 'M12 3a9 9 0 1 0 9 9c0-2-4-1-4-4s-3-5-5-5z', label: 'Theme', hint: 'KnowAll green / Nodie orange' },
    { id: 'background', icon: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6', label: 'Background', hint: 'Home screen backdrop' },
    { id: 'browser', icon: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2c-6 6-6 14 0 20 6-6 6-14 0-20z', label: 'Browser', hint: 'Browser for web apps' },
    { id: 'about', icon: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01', label: 'About' },
    { id: 'quit', remoteIcon: 'power', icon: 'M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10', label: 'Quit completely', hint: 'Home won’t bring it back until you restart it' },
    { id: 'edit-home', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7', label: 'Edit home screen', hint: 'Show or hide apps, games and cameras' },
  ] as const;

  const confirmOptions = [
    { id: 'cancel', remoteIcon: 'back', icon: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', label: 'Cancel' },
    { id: 'quit', remoteIcon: 'power', icon: 'M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10', label: 'Quit completely', hint: 'The remote can’t reopen it until you log in again' },
  ] as const;
  let browserMenu = $state(false);
  let browserError = $state(false);
  let browsers = $state<BrowserState>({ choice: 'default', installed: [], defaultBrowser: null });
  onMount(() => { void window.sofa.browsers().then((state) => { browsers = state; }); });
  const browserOptions = $derived([
    { id: 'default', icon: browsers.choice === 'default' ? 'M5 12l4 4L19 6' : '', selected: browsers.choice === 'default', label: `System default (${browsers.defaultBrowser ? BROWSER_NAMES[browsers.defaultBrowser] : 'No browser found'})` },
    ...browsers.installed.map((id) => ({ id, icon: browsers.choice === id ? 'M5 12l4 4L19 6' : '', selected: browsers.choice === id, label: BROWSER_NAMES[id] })),
  ]);
  async function chooseBrowser(id: string) {
    try {
      await window.sofa.setBrowser(id as BrowserChoice);
      browsers = await window.sofa.browsers();
      browserMenu = false;
      browserError = false;
    } catch { browserError = true; }
  }
  let themeMenu = $state(false);
  let theme = $state<Theme>('knowall');
  let themeError = $state(false);
  let backgroundMenu = $state(false);
  let background = $state<Background>(DEFAULT_BACKGROUND);
  let backgroundError = $state(false);
  onMount(() => followAppearanceState(window.sofa, (state) => { theme = state.theme; background = state.background; }));
  const themeOptions = $derived([
    { id: 'knowall', icon: theme === 'knowall' ? 'M5 12l4 4L19 6' : '', selected: theme === 'knowall', label: 'KnowAll green', hint: theme === 'knowall' ? 'Current theme' : undefined },
    { id: 'nodie', icon: theme === 'nodie' ? 'M5 12l4 4L19 6' : '', selected: theme === 'nodie', label: 'Nodie orange', hint: theme === 'nodie' ? 'Current theme' : undefined },
  ]);
  async function chooseTheme(id: string) {
    try {
      await window.sofa.setTheme(id as Theme);
      theme = id as Theme;
      themeMenu = false;
      themeError = false;
    } catch { themeError = true; }
  }
  /** Closes the whole menu on success, so the new backdrop is in full view. */
  async function chooseBackground(id: Background) {
    try {
      await window.sofa.setBackground(id);
      background = id;
      backgroundError = false;
      backgroundMenu = false;
      onclose();
    } catch { backgroundError = true; }
  }
  let confirmQuit = $state(false);
  let editHome = $state(untrack(() => initial === 'edit-home'));
  /** Settings reopens on the entry it was left from. */
  let returnFocus = $state(0);

  function choose(id: string) {
    returnFocus = options.findIndex((o) => o.id === id);
    if (id === 'browser') return (browserMenu = true);
    if (id === 'theme') return (themeMenu = true);
    if (id === 'background') return (backgroundMenu = true);
    if (id === 'quit') return (confirmQuit = true);
    if (id === 'edit-home') { returnFocus = options.findIndex((o) => o.id === id); return (editHome = true); }
    onclose();
    onchoose(id as 'button-test' | 'guide' | 'about');
  }

  function confirm(id: string) {
    if (id === 'quit') void window.sofa.quit();
    else confirmQuit = false;
  }
</script>

{#if browserMenu}
  <Menu title={browserError ? 'Couldn’t save browser. Try again?' : 'Browser'} options={browserOptions} initialFocus={Math.max(0, browserOptions.findIndex((o) => o.id === browsers.choice))} onchoose={(id) => void chooseBrowser(id)} onclose={() => { browserMenu = false; browserError = false; }} />
{:else if themeMenu}
  <Menu title={themeError ? 'Couldn’t save theme. Try again?' : 'Theme'} options={themeOptions} initialFocus={theme === 'nodie' ? 1 : 0} onchoose={(id) => void chooseTheme(id)} onclose={() => { themeMenu = false; themeError = false; }} />
{:else if backgroundMenu}
  <BackgroundPicker current={background} error={backgroundError} onchoose={(id) => void chooseBackground(id)} onclose={() => { backgroundMenu = false; backgroundError = false; }} />
{:else if editHome}
  <EditHome onclose={() => (editHome = false)} />
{:else if confirmQuit}
  <Menu title="Quit Sofa Launcher?" options={confirmOptions} onchoose={confirm} onclose={() => (confirmQuit = false)} initialFocus={0} />
{:else}
  <Menu title="Settings" initialFocus={returnFocus} {options} onchoose={choose} {onclose} />
{/if}
