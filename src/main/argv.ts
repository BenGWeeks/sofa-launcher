import { isAllowedWebUrl } from './web-url';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedApp } from './config';
import { NO_BROWSER } from './browsers';
import type { BrowserId, InstalledBrowser } from '../shared/browsers';

/** Expand a leading "~/" (and only that); never passes through a shell. */
export function expandHome(p: string, home = homedir()): string {
  return p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p;
}

export function profileDir(appId: string, dataDir: string, browser: BrowserId = 'edge'): string {
  return browser === 'edge' ? join(dataDir, 'profiles', appId) : join(dataDir, 'profiles', browser, appId);
}

/** YouTube keeps native TV keys; only its card sizing comes from the extension. */
export function usesBrowserExtension(app: ResolvedApp): boolean {
  if (!app.url || new URL(app.url).protocol !== 'https:') return false;
  if (app.remoteNavigation) return true;
  const url = new URL(app.url);
  return url.origin === 'https://www.youtube.com' && /^\/tv(?:\/|$)/.test(url.pathname);
}

/** Build [file, args] for spawn(). Arguments are an array; no shell is involved. */
export function launchArgv(app: ResolvedApp, opts: { dataDir: string; home?: string; browserExtensionPath?: string; browser?: InstalledBrowser | null }): [string, string[]] {
  if (app.type === 'web' && !opts.browser) throw new Error(NO_BROWSER);
  if (app.type === 'web' && app.fullBrowser) {
    // Tabs and address bar stay visible, so not --app and not --start-fullscreen (which hides
    // them). Maximised is the closest to full screen that keeps the toolbar. No URL: the browser's new tab.
    if (app.url && !isAllowedWebUrl(app.url)) throw new Error(`app ${app.id} has an unsafe url`);
    const args = [
      `--user-data-dir=${profileDir(app.id, opts.dataDir, opts.browser!.id)}`,
      `--class=${app.wmClass}`,
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
    ];
    if (app.userAgent) args.push(`--user-agent=${app.userAgent}`);
    if (app.url) args.push(app.url);
    return [opts.browser!.binary, args];
  }
  if (app.type === 'web') {
    if (!app.url || !isAllowedWebUrl(app.url)) throw new Error(`app ${app.id} has no url`);
    const args = [
      `--user-data-dir=${profileDir(app.id, opts.dataDir, opts.browser!.id)}`,
      `--class=${app.wmClass}`,
      `--app=${app.url}`,
      '--start-fullscreen',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
    ];
    if (usesBrowserExtension(app) && opts.browserExtensionPath) {
      // Google Chrome 137+ ignores --load-extension unless this switch is turned back on; later
      // Chrome versions may remove the switch, so Chrome is the last-choice browser.
      if (opts.browser!.id === 'chrome') args.push('--disable-features=DisableLoadExtensionCommandLineSwitch');
      args.push(`--load-extension=${opts.browserExtensionPath}`);
    }
    if (app.userAgent) args.push(`--user-agent=${app.userAgent}`);
    return [opts.browser!.binary, args];
  }
  if (!app.command || app.command.length === 0) throw new Error(`app ${app.id} has no command`);
  const [file, ...args] = app.command.map((c) => expandHome(c, opts.home));
  return [file!, args];
}
