import { execFile } from 'node:child_process';
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { promisify } from 'node:util';
import { BROWSER_IDS, BROWSER_NAMES, type BrowserChoice, type BrowserId, type InstalledBrowser } from '../shared/browsers';
import type { ResolvedApp } from './config';

export const BROWSER_BINARIES: Record<BrowserId, readonly string[]> = {
  edge: ['/usr/bin/microsoft-edge-stable', '/usr/bin/microsoft-edge', '/opt/microsoft/msedge/msedge'],
  chrome: ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'],
  // Snap builds are skipped (see isSnapBrowser): they can't use profiles under hidden home folders.
  chromium: ['/usr/bin/chromium', '/usr/bin/chromium-browser'],
  brave: ['/usr/bin/brave-browser', '/usr/bin/brave'],
  vivaldi: ['/usr/bin/vivaldi-stable', '/usr/bin/vivaldi'],
};
export const NO_BROWSER = 'Sofa needs a Chromium-based browser (Edge, Chrome, Chromium, Brave or Vivaldi)';
const run = promisify(execFile);
const executable = (file: string): boolean => {
  try { accessSync(file, constants.X_OK); return true; } catch { return false; }
};

/**
 * A Snap browser (or Ubuntu's /usr/bin/chromium-browser wrapper script that runs one) can't read
 * or write Sofa's profiles and extension under hidden home folders, so it can't be used.
 */
export function isSnapBrowser(file: string): boolean {
  try {
    if (realpathSync(file).startsWith('/snap/')) return true;
    if (statSync(file).size > 64 * 1024) return false;
    const head = readFileSync(file, 'utf8');
    return head.startsWith('#!') && head.includes('/snap/');
  } catch {
    return false;
  }
}

/**
 * Fallback order when the system default can't be used. Google Chrome comes last: since Chrome 137
 * it may ignore --load-extension, which Sofa's remote helper (arrow navigation, Back to home) needs.
 */
export const FALLBACK_ORDER: readonly BrowserId[] = ['edge', 'chromium', 'brave', 'vivaldi', 'chrome'];

export function desktopBrowser(value: string): BrowserId | null {
  const id = value.trim();
  const prefixes: Record<BrowserId, string> = { edge: 'microsoft-edge', chrome: 'google-chrome', chromium: 'chromium', brave: 'brave-browser', vivaldi: 'vivaldi' };
  return BROWSER_IDS.find((browser) => new RegExp(`^${prefixes[browser]}[a-z0-9_-]*\\.desktop$`).test(id)) ?? null;
}

export interface BrowserDiscovery { installed: InstalledBrowser[]; defaultBrowser: InstalledBrowser | null }
/** Only startup/config reload calls this: no process or binary probes on a button press. */
export async function discoverBrowsers(options: {
  isExecutable?: (file: string) => boolean;
  isSnap?: (file: string) => boolean;
  run?: (file: string, args: string[], options: { timeout: number }) => Promise<{ stdout: string }>;
  demo?: boolean;
} = {}): Promise<BrowserDiscovery> {
  if (options.demo) {
    const installed = (['edge', 'chrome'] as const).map((id) => ({ id, binary: BROWSER_BINARIES[id][0]! }));
    return { installed, defaultBrowser: installed[0]! };
  }
  const installed = BROWSER_IDS.flatMap((id) => {
    const usable = (file: string) => (options.isExecutable ?? executable)(file) && !(options.isSnap ?? isSnapBrowser)(file);
    const binary = BROWSER_BINARIES[id].find(usable);
    return binary ? [{ id, binary }] : [];
  });
  let preferred: BrowserId | null = null;
  try { preferred = desktopBrowser((await (options.run ?? run)('xdg-settings', ['get', 'default-web-browser'], { timeout: 1500 })).stdout); }
  catch { /* No desktop setting (or xdg-settings): use installation priority. */ }
  const fallback = FALLBACK_ORDER.map((id) => installed.find((b) => b.id === id)).find(Boolean) ?? null;
  // A system default of Google Chrome is only used when nothing that loads the remote helper is installed.
  const system = preferred === 'chrome' ? null : installed.find((b) => b.id === preferred);
  return { installed, defaultBrowser: system ?? fallback };
}

export function resolveBrowser(discovery: BrowserDiscovery, choice: BrowserChoice, override?: BrowserChoice): InstalledBrowser | null {
  const selected = override ?? choice;
  return selected === 'default' ? discovery.defaultBrowser : discovery.installed.find((b) => b.id === selected) ?? null;
}

/** Keep the catalogue id and WM class stable across browser changes. */
export function browserTile(app: ResolvedApp, browser: InstalledBrowser | null): ResolvedApp {
  if (!app.fullBrowser) return app;
  return { ...app, name: browser ? BROWSER_NAMES[browser.id] : 'Browser', brand: browser?.id === 'edge' ? 'edge' : 'browser' };
}
