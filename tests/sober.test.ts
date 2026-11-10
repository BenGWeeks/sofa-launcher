import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/main/config';
import { steamGamesRow } from '../src/main/demo';
import { homeCandidates, resolveHome } from '../src/main/home-items';
import { NO_CHOICES, parseHomeVisibility } from '../src/main/home-visibility';
import { detectRoblox, soberInstalled } from '../src/main/sober';
import { steamGameApps } from '../src/main/steam';

const HOME = '/home/someone';
const SYSTEM = '/var/lib/flatpak/app/org.vinegarhq.Sober/current/active/files';
const USER = `${HOME}/.local/share/flatpak/app/org.vinegarhq.Sober/current/active/files`;
const only = (...paths: string[]) => (path: string) => paths.includes(path);
const ids = (list: { id: string }[]) => list.map((a) => a.id);

const BASE = '[[apps]]\nid = "netflix"\ncatalogue = "netflix"\n';
const steam = steamGameApps([{ appId: '100', name: 'Alpha', lastPlayed: 1 }]);

describe('Sober (Roblox) detection', () => {
  it.each([['system', SYSTEM], ['user', USER]])('finds a %s installation', (_, path) => {
    expect(soberInstalled(HOME, only(path))).toBe(true);
    const found = detectRoblox(parseConfig(BASE), { home: HOME, exists: only(path) });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: 'roblox', name: 'Roblox', group: 'games', flatpak: 'org.vinegarhq.Sober', command: ['flatpak', 'run', 'org.vinegarhq.Sober'] });
  });

  it('finds nothing without Sober (or with only a leftover app folder)', () => {
    expect(detectRoblox(parseConfig(BASE), { home: HOME, exists: () => false })).toEqual([]);
    expect(soberInstalled(HOME, only('/var/lib/flatpak/app/org.vinegarhq.Sober'))).toBe(false);
  });

  it.each([
    ['catalogue roblox under another id', '[[apps]]\nid = "kids-roblox"\ncatalogue = "roblox"\n'],
    ['id roblox', '[[apps]]\nid = "roblox"\nname = "Roblox"\ntype = "desktop"\ncommand = ["flatpak", "run", "org.vinegarhq.Sober"]\n'],
    ['a hidden roblox', '[[apps]]\nid = "roblox"\ncatalogue = "roblox"\nhidden = true\n'],
    ['its own Sober app', '[[apps]]\nid = "sober"\ntype = "desktop"\ncommand = ["flatpak", "run", "org.vinegarhq.Sober"]\nflatpak = "org.vinegarhq.Sober"\n'],
  ])('leaves Roblox to config.toml when it has %s (no second tile)', (_, toml) => {
    const config = parseConfig(BASE + toml);
    expect(detectRoblox(config, { home: HOME, exists: () => true })).toEqual([]);
    const list = homeCandidates(config, detectRoblox(config, { home: HOME, exists: () => true }));
    expect(list.filter((c) => c.app.flatpak === 'org.vinegarhq.Sober' || c.app.id === 'roblox')).toHaveLength(1);
  });

  it('is never detected in demo mode', () => {
    let detected = false;
    const row = steamGamesRow({ on: true, games: true }, () => { detected = true; return []; });
    expect(detected).toBe(false);
    expect(ids(row)).not.toContain('roblox');
  });
});

describe('Detected Roblox on the home screen', () => {
  const roblox = detectRoblox(parseConfig(BASE), { home: HOME, exists: only(SYSTEM) });

  it('is in the Games row, before Steam games, shown by default', () => {
    const list = homeCandidates(parseConfig(BASE), [...roblox, ...steam]);
    const games = list.filter((c) => c.section === 'games');
    expect(ids(games.map((c) => c.app))).toEqual(['roblox', 'steam-100']);
    expect(games[0]?.defaultShown).toBe(true);
    expect(ids(resolveHome(list, NO_CHOICES).visible)).toEqual(['netflix', 'roblox', 'steam-100']);
  });

  it('is hidden by Edit home screen (home.json) but still listed and launchable', () => {
    const list = homeCandidates(parseConfig(BASE), roblox);
    const home = resolveHome(list, parseHomeVisibility('{"version":1,"hidden":["roblox"],"shown":[]}'));
    expect(ids(home.visible)).not.toContain('roblox');
    expect(ids(home.launchable)).toContain('roblox');
  });

  it('starts hidden with [games] enabled = false, and home.json can show it', () => {
    const list = homeCandidates(parseConfig(`${BASE}[games]\nenabled = false\n`), roblox);
    expect(list.find((c) => c.app.id === 'roblox')?.defaultShown).toBe(false);
    expect(ids(resolveHome(list, NO_CHOICES).visible)).not.toContain('roblox');
    expect(ids(resolveHome(list, parseHomeVisibility('{"version":1,"hidden":[],"shown":["roblox"]}')).visible)).toContain('roblox');
  });

  it('is unaffected by [games] hidden (Steam app ids only)', () => {
    const list = homeCandidates(parseConfig(`${BASE}[games]\nhidden = ["100"]\n`), [...roblox, ...steam]);
    expect(list.find((c) => c.app.id === 'roblox')?.defaultShown).toBe(true);
    expect(list.find((c) => c.app.id === 'steam-100')?.defaultShown).toBe(false);
  });
});
