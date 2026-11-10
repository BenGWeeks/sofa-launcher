import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/main/config';
import { homeCandidates, resolveHome } from '../src/main/home-items';
import { NO_CHOICES, parseHomeVisibility } from '../src/main/home-visibility';
import { steamGameApps } from '../src/main/steam';
import { AppManager } from '../src/main/apps';
import { FakeWindowManager } from '../src/main/windows';

const TOML = `
[homeAssistant]
url = "https://ha.example"

[[apps]]
id = "netflix"
catalogue = "netflix"

[[apps]]
id = "youtube"
catalogue = "youtube"
hidden = true

[[apps]]
id = "mine"
name = "My site"
type = "web"
url = "https://example.com"

[[apps]]
id = "roblox"
catalogue = "roblox"

[[cameras]]
id = "door"
name = "Door"
entity = "camera.door"

[games]
hidden = ["200"]
`;
const steam = steamGameApps([
  { appId: '100', name: 'Alpha', lastPlayed: 2 },
  { appId: '200', name: 'Beta', lastPlayed: 1 },
]);

const ids = (list: { id: string }[]) => list.map((a) => a.id);

describe('Edit home screen candidates', () => {
  const config = parseConfig(TOML);
  const list = homeCandidates(config, steam);
  const section = (s: string) => list.filter((c) => c.section === s);

  it('lists configured apps (hidden too) in file order, then every other non-game catalogue app', () => {
    const apps = section('apps');
    expect(ids(apps.map((c) => c.app)).slice(0, 3)).toEqual(['netflix', 'youtube', 'mine']);
    expect(apps.find((c) => c.app.id === 'youtube')?.defaultShown).toBe(false);
    expect(apps.find((c) => c.app.id === 'mine')?.defaultShown).toBe(true);
    const rest = ids(apps.slice(3).map((c) => c.app));
    expect(rest).toEqual(expect.arrayContaining(['disney', 'iplayer', 'spotify', 'edge', 'jellyfin', 'nodie']));
    expect(rest).not.toContain('roblox');
    expect(rest).not.toContain('netflix');
    expect(apps.slice(3).every((c) => !c.defaultShown)).toBe(true);
  });

  it('marks catalogue apps that need a URL from config.toml', () => {
    const apps = section('apps');
    expect(apps.find((c) => c.app.id === 'homeassistant')?.needsSetup).toBe(true);
    expect(apps.find((c) => c.app.id === 'jellyseerr')?.needsSetup).toBe(true);
    expect(apps.find((c) => c.app.id === 'disney')?.needsSetup).toBeUndefined();
  });

  it('lists configured games, then every Steam game, [games] hidden ones off by default', () => {
    expect(section('games').map((c) => [c.app.id, c.defaultShown])).toEqual([['roblox', true], ['steam-100', true], ['steam-200', false]]);
    const off = homeCandidates(parseConfig(`${TOML.replace('[games]\nhidden = ["200"]', '[games]\nenabled = false')}`), steam);
    expect(off.filter((c) => c.section === 'games').map((c) => c.defaultShown)).toEqual([true, false, false]);
  });

  it('lists the camera grid and each camera', () => {
    expect(ids(section('cameras').map((c) => c.app))).toEqual(['all-cameras', 'camera-door']);
  });
});

describe('what home, panel and chooser show', () => {
  const config = parseConfig(TOML);
  const list = homeCandidates(config, steam);

  it('without choices, matches config.toml', () => {
    const { visible } = resolveHome(list, NO_CHOICES);
    expect(ids(visible)).toEqual(['netflix', 'mine', 'roblox', 'steam-100', 'all-cameras', 'camera-door']);
    expect(ids(visible)).toEqual([...ids(config.apps.filter((a) => a.type !== 'camera')), 'steam-100', 'all-cameras', 'camera-door']);
  });

  it('applies choices over config.toml, newly shown apps after the configured ones, unknown ids ignored', () => {
    const choices = parseHomeVisibility(JSON.stringify({ hidden: ['netflix', 'camera-door', 'steam-100', 'gone-app'], shown: ['youtube', 'disney', 'edge', 'steam-200', 'homeassistant'] }));
    const { visible, launchable } = resolveHome(list, choices);
    const apps = ids(visible.filter((a) => a.type !== 'camera' && a.group !== 'games'));
    expect(apps.slice(0, 2)).toEqual(['youtube', 'mine']);
    expect(apps.slice(2)).toEqual(expect.arrayContaining(['disney', 'edge']));
    expect(apps).toHaveLength(4);
    expect(ids(visible.filter((a) => a.group === 'games'))).toEqual(['roblox', 'steam-200']);
    expect(ids(visible.filter((a) => a.type === 'camera'))).toEqual(['all-cameras']);
    // Hidden things still open by id; a catalogue app without its URL never does.
    expect(ids(launchable)).toEqual(expect.arrayContaining(['camera-door', 'netflix', 'steam-100']));
    expect(ids(launchable)).not.toContain('homeassistant');
  });

  it('a switched-on catalogue app is a full app: launch arguments, numbering by position', async () => {
    const { visible, launchable } = resolveHome(list, parseHomeVisibility('{"shown":["disney"]}'));
    const disney = visible.find((a) => a.id === 'disney')!;
    expect(disney).toMatchObject({ type: 'web', url: 'https://www.disneyplus.com/', wmClass: 'sofa-disney' });
    const mgr = new AppManager(launchable, new FakeWindowManager(), { dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }), isExecutable: () => true, flatpakInstalled: async () => true });
    mgr.setApps(launchable, visible);
    const tiles = (await mgr.states()).filter((t) => t.type !== 'camera' && t.group !== 'games');
    expect(ids(tiles)).toEqual(['netflix', 'mine', 'disney']);
    expect(mgr.get('camera-door')).toBeDefined();
    expect(ids(await mgr.states())).not.toContain('youtube');
  });
});
