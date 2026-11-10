import { describe, expect, it } from 'vitest';
import { parseConfig, SEED_CONFIG } from '../src/main/config';
import { DEMO_STEAM_GAMES, demoArtBitmap, screenshotConfig } from '../src/main/demo';
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
