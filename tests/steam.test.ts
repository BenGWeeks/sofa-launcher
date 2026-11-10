import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSteamGames, gameArtPath, isSteamTool, jpegSize, libraryPaths, parseVdf, steamBinary, steamGameApps, steamRoot } from '../src/main/steam';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'sofa-steam-test-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

function manifest(library: string, appId: string, name: string, flags = '4', lastPlayed = '0'): void {
  mkdirSync(join(library, 'steamapps'), { recursive: true });
  writeFileSync(join(library, 'steamapps', `appmanifest_${appId}.acf`), `"AppState"
{
\t"appid"\t\t"${appId}"
\t"universe"\t\t"1"
\t"name"\t\t"${name}"
\t"StateFlags"\t\t"${flags}"
\t"installdir"\t\t"${name}"
\t"LastUpdated"\t\t"1749154459"
\t"LastPlayed"\t\t"${lastPlayed}"
\t"UserConfig"
\t{
\t\t"language"\t\t"english"
\t}
}
`);
}

function libraries(root: string, paths: string[]): void {
  mkdirSync(join(root, 'steamapps'), { recursive: true });
  writeFileSync(join(root, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"
{
${paths.map((path, i) => `\t"${i}"
\t{
\t\t"path"\t\t"${path}"
\t\t"label"\t\t""
\t\t"apps"
\t\t{
\t\t\t"552990"\t\t"123"
\t\t}
\t}`).join('\n')}
}
`);
}

/** A minimal JPEG: SOI, an APP0 segment, then a baseline frame header with the given size. */
function jpeg(width: number, height: number): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

describe('parseVdf', () => {
  it('reads nested KeyValues with lower-cased keys, escapes and comments', () => {
    const data = parseVdf('// comment\n"AppState"\n{\n\t"appid"\t"552990"\n\t"name"\t"Say \\"hi\\""\n\t"Sub" { "Key" "v" [$WIN32] }\n}\n');
    expect(data).toEqual({ appstate: { appid: '552990', name: 'Say "hi"', sub: { key: 'v' } } });
  });

  it('survives truncated input', () => {
    expect(parseVdf('"AppState"\n{\n\t"appid"\t"1"\n\t"name"')).toEqual({ appstate: { appid: '1' } });
  });
});

describe('steam detection', () => {
  it('finds the root in the usual places, resolving symlinks', () => {
    expect(steamRoot(home)).toBeNull();
    const real = join(home, '.steam', 'debian-installation');
    mkdirSync(real, { recursive: true });
    symlinkSync(real, join(home, '.steam', 'steam'));
    expect(steamRoot(home)).toBe(real);
    mkdirSync(join(home, '.local/share/Steam'), { recursive: true });
    expect(steamRoot(home)).toBe(join(home, '.local/share/Steam'));
  });

  it('resolves the Steam command, or reports Steam missing', () => {
    expect(steamBinary((f) => f === '/usr/games/steam')).toBe('/usr/games/steam');
    expect(steamBinary((f) => f === 'steam' || f === '/usr/games/steam')).toBe('steam');
    expect(steamBinary(() => false)).toBeNull();
  });

  it('reads every existing library once, skipping missing ones', () => {
    const root = join(home, '.local/share/Steam');
    const bulk = join(home, 'bulk-storage', 'steamapps');
    mkdirSync(join(bulk, 'steamapps'), { recursive: true });
    libraries(root, [root, bulk, join(home, 'unplugged-drive')]);
    expect(libraryPaths(root)).toEqual([root, bulk]);
  });

  it('lists installed games across libraries, excluding tools and hidden ids, most recently played first', () => {
    const root = join(home, '.local/share/Steam');
    const bulk = join(home, 'bulk-storage', 'steamapps');
    libraries(root, [root, bulk, join(home, 'missing')]);
    manifest(root, '552990', 'World of Warships', '4', '0');
    manifest(root, '1091500', 'Cyberpunk 2077', '6', '1700000000'); // installed, update pending
    manifest(root, '1692250', 'Half Downloaded', '2', '0'); // not installed
    manifest(bulk, '686810', 'Hell Let Loose', '4', '1800000000');
    manifest(bulk, '1222730', 'Alpha Squadron', '4', '0');
    manifest(bulk, '4183110', 'Steam Linux Runtime 4.0', '4');
    manifest(bulk, '1493710', 'Proton Experimental', '4');
    manifest(root, '228980', 'Steamworks Common Redistributables', '4');
    manifest(root, '1826330', 'Some Runtime', '4'); // excluded by app id
    manifest(root, '431960', 'Wallpaper Engine', '4');
    const ids = findSteamGames({ home, hidden: ['431960'] }).map((g) => g.appId);
    expect(ids).toEqual(['686810', '1091500', '1222730', '552990']);
    expect(findSteamGames({ home }).map((g) => g.name)).toContain('Wallpaper Engine');
  });

  it('returns nothing without Steam, and ignores broken manifests', () => {
    expect(findSteamGames({ home })).toEqual([]);
    const root = join(home, '.steam', 'root');
    mkdirSync(join(root, 'steamapps'), { recursive: true });
    writeFileSync(join(root, 'steamapps', 'appmanifest_1.acf'), 'garbage {{');
    writeFileSync(join(root, 'steamapps', 'appmanifest_2.acf'), '"AppState" { "appid" "2" "StateFlags" "4" }'); // no name
    manifest(root, '3', 'Fine Game');
    expect(findSteamGames({ home }).map((g) => g.appId)).toEqual(['3']);
  });

  it('recognises Steam tools by name prefix and app id', () => {
    expect(isSteamTool('9', 'Proton 9.0')).toBe(true);
    expect(isSteamTool('9', 'Steam Linux Runtime 5.0')).toBe(true);
    expect(isSteamTool('228980', 'Anything')).toBe(true);
    expect(isSteamTool('552990', 'World of Warships')).toBe(false);
  });

  it('makes launchable Games-row entries', () => {
    expect(steamGameApps([{ appId: '552990', name: 'World of Warships', lastPlayed: 0 }], '/usr/games/steam')[0]).toMatchObject({
      id: 'steam-552990', group: 'games', type: 'desktop', handOff: true,
      command: ['/usr/games/steam', '-silent', '-applaunch', '552990'], wmClass: 'steam_app_552990',
    });
  });
});

describe('steam artwork', () => {
  it('prefers a named header, then the hashed-folder library_header.jpg', () => {
    const root = join(home, 'Steam');
    const cache = join(root, 'appcache', 'librarycache');
    mkdirSync(join(cache, '10', 'abc123'), { recursive: true });
    writeFileSync(join(cache, '10', 'abc123', 'library_header.jpg'), jpeg(460, 215));
    writeFileSync(join(cache, '10', 'ffff.jpg'), jpeg(32, 32));
    expect(gameArtPath(root, '10')).toBe(join(cache, '10', 'abc123', 'library_header.jpg'));
    writeFileSync(join(cache, '10', 'header.jpg'), jpeg(460, 215));
    expect(gameArtPath(root, '10')).toBe(join(cache, '10', 'header.jpg'));
    writeFileSync(join(cache, '20_header.jpg'), jpeg(460, 215));
    expect(gameArtPath(root, '20')).toBe(join(cache, '20_header.jpg'));
    expect(gameArtPath(root, '30')).toBeUndefined();
  });

  it('otherwise picks the landscape JPEG nearest a header shape, ignoring icons and portraits', () => {
    const root = join(home, 'Steam');
    const dir = join(root, 'appcache', 'librarycache', '40');
    mkdirSync(join(dir, 'h1'), { recursive: true });
    writeFileSync(join(dir, 'aaa.jpg'), jpeg(32, 32));
    writeFileSync(join(dir, 'bbb.jpg'), jpeg(300, 450));
    writeFileSync(join(dir, 'h1', 'ccc.jpg'), jpeg(1920, 620));
    expect(gameArtPath(root, '40')).toBe(join(dir, 'h1', 'ccc.jpg'));
    writeFileSync(join(dir, 'ddd.jpg'), jpeg(616, 353));
    expect(gameArtPath(root, '40')).toBe(join(dir, 'ddd.jpg'));
    expect(jpegSize(join(dir, 'h1', 'ccc.jpg'))).toEqual({ width: 1920, height: 620 });
    writeFileSync(join(dir, 'not-a-jpeg.jpg'), 'hello');
    expect(jpegSize(join(dir, 'not-a-jpeg.jpg'))).toBeNull();
  });
});
