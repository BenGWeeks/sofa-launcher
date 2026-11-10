import { describe, expect, it } from 'vitest';
import { expandHome, launchArgv } from '../src/main/argv';
import { parseConfig } from '../src/main/config';
import { backKeyFor } from '../src/main/back';

const app = (toml: string) => parseConfig(toml).apps[0]!;

describe('launchArgv', () => {
  it('starts Jellyfin with its native TV interface in fullscreen', () => {
    const [, args] = launchArgv(app('[[apps]]\nid = "jellyfin"\ncatalogue = "jellyfin"'), { dataDir: '/d', browser: { id: 'edge' as const, binary: '/usr/bin/microsoft-edge-stable' } });
    expect(args.slice(-3)).toEqual(['org.jellyfin.JellyfinDesktop', '--tv', '--fullscreen']);
  });
  it('builds an Edge app window with its own profile and class', () => {
    const [file, args] = launchArgv(app('[[apps]]\nid = "netflix"\ncatalogue = "netflix"'), { dataDir: '/d', browser: { id: 'edge' as const, binary: '/usr/bin/microsoft-edge-stable' } });
    expect(file).toBe('/usr/bin/microsoft-edge-stable');
    expect(args).toEqual([
      '--user-data-dir=/d/profiles/netflix',
      '--class=sofa-netflix',
      '--app=https://www.netflix.com/browse',
      '--start-fullscreen',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
    ]);
  });

  it('opens Edge as the full browser: no --app, its own profile and window class, maximised', () => {
    const edge = parseConfig('[[apps]]\nid = "edge"\ncatalogue = "edge"').apps[0]!;
    const [file, args] = launchArgv(edge, { dataDir: '/d', browser: { id: 'edge' as const, binary: '/usr/bin/microsoft-edge-stable' }, browserExtensionPath: '/r/browser-remote' });
    expect(file).toBe('/usr/bin/microsoft-edge-stable');
    expect(args).toEqual([
      '--user-data-dir=/d/profiles/edge',
      '--class=sofa-edge',
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
    ]);
    expect(args.some((a) => a.startsWith('--app') || a === '--start-fullscreen' || a === '--kiosk')).toBe(false);
    expect(backKeyFor(edge)).toBe('alt+Left');
    const [, search] = launchArgv({ ...edge, url: 'https://www.bing.com/search?q=x' }, { dataDir: '/d', browser: { id: 'edge' as const, binary: '/usr/bin/microsoft-edge-stable' } });
    expect(search.at(-1)).toBe('https://www.bing.com/search?q=x');
    expect(() => launchArgv({ ...edge, url: 'file:///etc/passwd' }, { dataDir: '/d', browser: { id: 'edge' as const, binary: '/usr/bin/microsoft-edge-stable' } })).toThrow();
  });

  it('loads Sofa navigation only for apps that enable it, with an explicit resource path', () => {
    const opts = { dataDir: '/d', browser: { id: 'edge' as const, binary: '/usr/bin/microsoft-edge-stable' }, browserExtensionPath: '/r/browser-remote' };
    const [, prime] = launchArgv(app('[[apps]]\nid = "prime"\ncatalogue = "prime"'), opts);
    const [, youtube] = launchArgv(app('[[apps]]\nid = "youtube"\ncatalogue = "youtube"'), opts);
    expect(prime).toContain('--load-extension=/r/browser-remote');
    expect(youtube).toContain('--load-extension=/r/browser-remote');
  });

  it('adds the TV user agent for YouTube', () => {
    const [, args] = launchArgv(app('[[apps]]\nid = "youtube"\ncatalogue = "youtube"'), { dataDir: '/d', browser: { id: 'edge' as const, binary: '/usr/bin/microsoft-edge-stable' } });
    expect(args.at(-1)).toMatch(/^--user-agent=.*TV/);
  });

  it('expands only a leading ~/ in desktop commands', () => {
    const [file, args] = launchArgv(
      app('[[apps]]\nid = "x"\ntype = "desktop"\ncommand = ["~/bin/run", "~/keep", "a~/b"]'),
      { dataDir: '/d', browser: { id: 'edge' as const, binary: '/usr/bin/microsoft-edge-stable' }, home: '/home/u' },
    );
    expect(file).toBe('/home/u/bin/run');
    expect(args).toEqual(['/home/u/keep', 'a~/b']);
  });

  it('passes shell metacharacters through as literal arguments', () => {
    const [, args] = launchArgv(app('[[apps]]\nid = "x"\ntype = "desktop"\ncommand = ["echo", "$(id); rm -rf ~"]'), { dataDir: '/d', browser: { id: 'edge' as const, binary: '/usr/bin/microsoft-edge-stable' } });
    expect(args).toEqual(['$(id); rm -rf ~']);
  });

  it('expandHome leaves other paths alone', () => {
    expect(expandHome('/usr/bin/x', '/h')).toBe('/usr/bin/x');
    expect(expandHome('~', '/h')).toBe('/h');
  });
});
