import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Any real process start would go through node:child_process: fail loudly if demo mode reaches it.
const child = vi.hoisted(() => ({
  spawn: vi.fn(() => { throw new Error('spawn in demo mode'); }),
  execFile: vi.fn(() => { throw new Error('execFile in demo mode'); }),
}));
vi.mock('node:child_process', async (importOriginal) => ({ ...(await importOriginal<object>()), ...child }));

import { AppManager } from '../src/main/apps';
import { parseConfig, SEED_CONFIG } from '../src/main/config';
import { DEMO_STEAM_COMMAND, DEMO_STEAM_GAMES, isDemoMode, screenshotConfig, steamGamesRow } from '../src/main/demo';
import { steamGameApps } from '../src/main/steam';
import { FakeWindowManager } from '../src/main/windows';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  child.spawn.mockClear();
  child.execFile.mockClear();
});

describe('demo mode detection', () => {
  it('is on for --demo, --screenshot and any --demo-* flag', () => {
    expect(isDemoMode(['main.js', '--demo'])).toBe(true);
    expect(isDemoMode(['main.js', '--screenshot=/tmp/a.png'])).toBe(true);
    expect(isDemoMode(['main.js', '--demo-games'])).toBe(true);
    expect(isDemoMode(['main.js', '--demo-keys=Enter'])).toBe(true);
    expect(isDemoMode(['main.js', '--dev', '--no-sandbox'])).toBe(false);
    expect(isDemoMode(['main.js', '--demonstration'])).toBe(false);
  });
});

describe('demo Games row', () => {
  it('never calls Steam detection in demo mode, with or without --demo-games', () => {
    const detect = vi.fn(() => steamGameApps([{ appId: '570', name: 'Real game', lastPlayed: 1 }]));
    const games = steamGamesRow({ on: true, games: true }, detect);
    expect(steamGamesRow({ on: true, games: false }, detect)).toEqual([]);
    expect(detect).not.toHaveBeenCalled();
    expect(games.map((g) => g.id)).toEqual(DEMO_STEAM_GAMES.map((g) => `steam-${g.appId}`));
    // Stand-ins don't even name the real Steam command.
    expect(games.every((g) => g.command?.[0] === DEMO_STEAM_COMMAND)).toBe(true);
  });

  it('detects the real library outside demo mode', () => {
    const detect = vi.fn(() => []);
    steamGamesRow({ on: false, games: true }, detect);
    expect(detect).toHaveBeenCalledOnce();
  });
});

describe('AppManager in demo mode', () => {
  it('never opens a real managed camera viewer', async () => {
    const managed = { open: vi.fn(async () => '42'), close: vi.fn(async () => true), pause: vi.fn(async () => undefined) };
    const config = screenshotConfig('knowall', true);
    const mgr = new AppManager(config.apps, new FakeWindowManager(), { dataDir: '/d', demo: true, managed, isExecutable: () => true });
    for (const camera of config.apps.filter(a => a.type === 'camera')) {
      const opening = mgr.open(camera.id);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await opening).ok).toBe(false);
    }
    expect(managed.open).not.toHaveBeenCalled();
  });
  function setup() {
    const wm = new FakeWindowManager();
    const spawner = vi.fn();
    const runCommand = vi.fn(async () => undefined);
    const killPid = vi.fn();
    const config = screenshotConfig('knowall', false, 'midnight', true);
    const steam = [...steamGameApps(DEMO_STEAM_GAMES), ...steamGameApps([{ appId: '570', name: 'Real', lastPlayed: 1 }])];
    const mgr = new AppManager([...config.apps, ...steam], wm, {
      dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }), demo: true, spawner, runCommand, killPid,
      isExecutable: () => true, flatpakInstalled: async () => true,
    });
    return { wm, mgr, spawner, runCommand, killPid };
  }

  it('never spawns a game, Steam, a Flatpak or any app', async () => {
    const { mgr, spawner } = setup();
    for (const id of ['steam-9000001', 'steam-570', 'roblox', 'jellyfin', 'netflix', 'nodie']) {
      const result = mgr.open(id);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await result).ok, id).toBe(false);
    }
    expect(spawner).not.toHaveBeenCalled();
    expect(mgr.startedIds()).toEqual([]);
    expect(child.spawn).not.toHaveBeenCalled();
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it('never reaches node:child_process even without injected runners', async () => {
    const wm = new FakeWindowManager();
    const mgr = new AppManager([...parseConfig(SEED_CONFIG).apps, ...steamGameApps([{ appId: '570', name: 'Real', lastPlayed: 1 }])], wm, { dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }), demo: true, isExecutable: () => true });
    for (const id of ['steam-570', 'jellyfin', 'netflix']) {
      const result = mgr.open(id);
      await vi.advanceTimersByTimeAsync(1000);
      expect((await result).ok, id).toBe(false);
    }
    await mgr.tiles(mgr.list()); // installed probes: no `flatpak info`
    wm.windows.set('steam_app_570', ['7']);
    wm.windows.set('jellyfin-desktop', ['8']);
    wm.pids.set('7', 4242);
    wm.pids.set('8', 4343);
    expect(await mgr.close('steam-570')).toBe(false);
    expect(await mgr.close('jellyfin')).toBe(false);
    expect(child.spawn).not.toHaveBeenCalled();
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it('still activates already-open (fake) windows', async () => {
    const { wm, mgr, spawner } = setup();
    wm.windows.set('sofa-netflix', ['42']);
    expect((await mgr.open('netflix')).ok).toBe(true);
    expect(wm.activated).toEqual(['42']);
    expect(spawner).not.toHaveBeenCalled();
  });

  it('never signals or flatpak-kills a real process on close', async () => {
    const { wm, mgr, runCommand, killPid } = setup();
    wm.windows.set('steam_app_570', ['7']);
    wm.windows.set('jellyfin-desktop', ['8']);
    wm.pids.set('7', 4242);
    wm.pids.set('8', 4343);
    expect(await mgr.close('steam-570')).toBe(false);
    expect(await mgr.close('jellyfin')).toBe(false);
    await mgr.closeSession();
    await mgr.closeStarted();
    expect(killPid).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });
});
