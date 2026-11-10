import { describe, expect, it } from 'vitest';
import { parseConfig, SEED_CONFIG } from '../src/main/config';
import { DEMO_STEAM_GAMES, demoArtBitmap, demoCameraHasStill, demoCameraStillBitmap, screenshotConfig } from '../src/main/demo';
import { CATALOGUE } from '../src/main/catalogue';

describe('screenshot config', () => {
  it('includes the loopback Jellyseerr tile after Jellyfin', () => {
    const demo = screenshotConfig();
    expect(demo.apps.slice(0, 2).map((a) => a.id)).toEqual(['jellyfin', 'jellyseerr']);
    expect(demo.apps[1]?.url).toBe('http://127.0.0.1:5055');
    expect(parseConfig(SEED_CONFIG).apps.map((a) => a.id)).toContain('jellyseerr');
    expect(screenshotConfig('nodie').ui.theme).toBe('nodie');
    expect(demo.ui.theme).toBe('knowall');
    expect(demo.ui.background).toBe('midnight');
    expect(screenshotConfig('knowall', false, 'planet').ui.background).toBe('planet');
    expect(CATALOGUE.jellyseerr?.url).toBeUndefined();
  });

  it('adds Roblox as a configured game only with --demo-games, and fictional Steam games', () => {
    expect(screenshotConfig().apps.some((a) => a.group === 'games')).toBe(false);
    const games = screenshotConfig('knowall', true, 'midnight', true).apps.filter((a) => a.group === 'games');
    expect(games.map((a) => a.id)).toEqual(['roblox']);
    expect(DEMO_STEAM_GAMES.length).toBeGreaterThanOrEqual(7);
    expect(demoArtBitmap(200, 46, 20)).toHaveLength(46 * 20 * 4);
  });
});

describe('demo camera stills', () => {
  it('gives most demo cameras a still and leaves some without, to show the ordering', () => {
    const ids = Array.from({ length: 6 }, (_, i) => `camera-demo-${i}`);
    expect(ids.filter(demoCameraHasStill)).toEqual(['camera-demo-0', 'camera-demo-2', 'camera-demo-3', 'camera-demo-5']);
    expect(demoCameraHasStill('all-cameras')).toBe(false);
    expect(demoCameraHasStill('camera-front')).toBe(false);
  });
  it('draws an opaque, deterministic placeholder of the requested size', () => {
    const a = demoCameraStillBitmap(0, 48, 27);
    expect(a.length).toBe(48 * 27 * 4);
    expect(a.equals(demoCameraStillBitmap(0, 48, 27))).toBe(true);
    expect(a.equals(demoCameraStillBitmap(2, 48, 27))).toBe(false);
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
  });
});
