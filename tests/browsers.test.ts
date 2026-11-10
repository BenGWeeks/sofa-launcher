import { describe, expect, it } from 'vitest';
import { BROWSER_BINARIES, browserTile, desktopBrowser, discoverBrowsers, resolveBrowser, NO_BROWSER } from '../src/main/browsers';
import { BROWSER_IDS } from '../src/shared/browsers';
import { parseConfig, resolveCatalogueApp, SEED_CONFIG } from '../src/main/config';
import { launchArgv, profileDir, usesBrowserExtension } from '../src/main/argv';
import { AppManager } from '../src/main/apps';
import { FakeWindowManager } from '../src/main/windows';

const discover = (desktop: string, binaries: string[] = BROWSER_IDS.map((id) => BROWSER_BINARIES[id][0]!)) => discoverBrowsers({
  isExecutable: (file) => binaries.includes(file),
  isSnap: () => false,
  run: async (file, args, options) => {
    expect([file, args, options]).toEqual(['xdg-settings', ['get', 'default-web-browser'], { timeout: 1500 }]);
    return { stdout: desktop };
  },
});

describe('browser discovery and selection', () => {
  it('skips Snap browsers and uses Chrome only when nothing else is installed', async () => {
    const snap = await discoverBrowsers({
      isExecutable: (file) => ['/usr/bin/chromium-browser', '/usr/bin/brave'].includes(file),
      isSnap: (file) => file === '/usr/bin/chromium-browser',
      run: async () => ({ stdout: 'chromium-browser.desktop' }),
    });
    expect(snap).toEqual({ installed: [{ id: 'brave', binary: '/usr/bin/brave' }], defaultBrowser: { id: 'brave', binary: '/usr/bin/brave' } });
    const chromeOnly = await discover('google-chrome.desktop', ['/usr/bin/google-chrome-stable']);
    expect(chromeOnly.defaultBrowser?.id).toBe('chrome');
    expect(resolveBrowser(await discover('google-chrome.desktop'), 'chrome')?.id).toBe('chrome');
  });
  it.each([
    ['microsoft-edge.desktop\n', 'edge'], ['brave-browser.desktop', 'brave'],
    ['firefox.desktop', 'edge'], ['', 'edge'],
    // Chrome may ignore --load-extension, so a Chrome system default prefers a browser that loads the remote helper.
    ['google-chrome.desktop', 'edge'],
  ])('resolves default %j to %s', async (desktop, expected) => {
    expect(resolveBrowser(await discover(desktop), 'default')?.id).toBe(expected);
  });
  it.each([
    ['microsoft-edge-stable.desktop', 'edge'], ['google-chrome-beta.desktop', 'chrome'],
    ['chromium_chromium.desktop', 'chromium'], ['chromium-browser.desktop', 'chromium'],
    ['brave-browser.desktop', 'brave'], ['vivaldi-stable.desktop', 'vivaldi'],
    ['firefox.desktop', null], ['org.chromium.Chromium.desktop', null],
  ])('maps desktop id %s', (desktop, expected) => {
    expect(desktopBrowser(desktop)).toBe(expected);
  });
  it('uses candidate order, skips missing defaults and handles xdg-settings failure', async () => {
    const browsers = await discover('microsoft-edge.desktop', ['/usr/bin/chromium-browser']);
    expect(browsers).toEqual({ installed: [{ id: 'chromium', binary: '/usr/bin/chromium-browser' }], defaultBrowser: { id: 'chromium', binary: '/usr/bin/chromium-browser' } });
    expect((await discoverBrowsers({ isExecutable: () => false, isSnap: () => false, run: async () => { throw new Error('timeout'); } })).defaultBrowser).toBeNull();
    expect((await discoverBrowsers({ isExecutable: (file) => file === '/usr/bin/brave', isSnap: () => false, run: async () => { throw new Error('missing'); } })).defaultBrowser?.id).toBe('brave');
  });
  it('honours explicit and per-app choices, including per-app system default', async () => {
    const browsers = await discover('vivaldi-stable.desktop');
    const config = parseConfig('[ui]\nbrowser="brave"\n[[apps]]\nid="x"\ncatalogue="netflix"\nbrowser="chromium"');
    expect(resolveBrowser(browsers, config.ui.browser)?.id).toBe('brave');
    expect(resolveBrowser(browsers, config.ui.browser, config.apps[0]?.browser)?.id).toBe('chromium');
    expect(resolveBrowser(browsers, 'edge', 'default')?.id).toBe('vivaldi');
    expect(resolveBrowser(await discover('', []), 'edge')).toBeNull();
  });
  it('keeps legacy settings and HTTPS addresses, with browser taking precedence', () => {
    const source = '[ui]\ndefaultBrowser="edge"\n[[apps]]\nid="homeassistant"\ncatalogue="homeassistant"\nurl="https://ha.example.com"';
    const config = parseConfig(source);
    expect(config.ui.browser).toBe('edge');
    expect(config.apps[0]?.url).toBe('https://ha.example.com');
    expect(parseConfig(source.replace('[ui]', '[ui]\nbrowser="chrome"')).ui.browser).toBe('chrome');
    expect(parseConfig(SEED_CONFIG).ui.browser).toBe('default');
    expect(parseConfig(SEED_CONFIG).homeAssistantUrl).toBe('http://homeassistant.local:8123');
  });
  it('never probes the real workstation in demo mode', async () => {
    const result = await discoverBrowsers({ demo: true, run: async () => { throw new Error('must not run'); }, isExecutable: () => { throw new Error('must not probe'); } });
    expect(result.installed.map((b) => b.id)).toEqual(['edge', 'chrome']);
    expect(result.defaultBrowser?.id).toBe('edge');
  });
});

describe('resolved browser launches', () => {
  it.each(BROWSER_IDS)('uses %s binary and a separate profile', async (id) => {
    const browser = resolveBrowser(await discover(''), id)!;
    const app = resolveCatalogueApp('netflix')!;
    const [file, args] = launchArgv(app, { dataDir: '/data', browser });
    expect(file).toBe(BROWSER_BINARIES[id][0]);
    expect(args).toContain(`--user-data-dir=${id === 'edge' ? '/data/profiles/netflix' : `/data/profiles/${id}/netflix`}`);
    expect(profileDir('netflix', '/data', id)).toBe(id === 'edge' ? '/data/profiles/netflix' : `/data/profiles/${id}/netflix`);
    const tile = browserTile(resolveCatalogueApp('edge')!, browser);
    expect(tile).toMatchObject({ id: 'edge', wmClass: 'sofa-edge', name: { edge: 'Microsoft Edge', chrome: 'Google Chrome', chromium: 'Chromium', brave: 'Brave', vivaldi: 'Vivaldi' }[id], brand: id === 'edge' ? 'edge' : 'browser' });
    expect(launchArgv(tile, { dataDir: '/data', browser })[0]).toBe(file);
  });
  it('reports the missing browser through the existing open-result path', async () => {
    const mgr = new AppManager([resolveCatalogueApp('netflix')!], new FakeWindowManager(), { dataDir: '/data', browserFor: () => null });
    expect(await mgr.open('netflix')).toEqual({ ok: false, message: NO_BROWSER });
    expect((await mgr.states())[0]?.installed).toBe(false);
    expect(() => launchArgv(resolveCatalogueApp('netflix')!, { dataDir: '/data' })).toThrow(NO_BROWSER);
  });
  it('never enables browser remote navigation on LAN HTTP', () => {
    const app = { ...resolveCatalogueApp('netflix')!, url: 'http://homeassistant.local:8123', remoteNavigation: true };
    expect(usesBrowserExtension(app)).toBe(false);
    expect(launchArgv(app, { dataDir: '/data', browser: { id: 'chrome', binary: '/usr/bin/google-chrome' }, browserExtensionPath: '/extension' })[1].some((arg) => arg.startsWith('--load-extension'))).toBe(false);
  });
});
