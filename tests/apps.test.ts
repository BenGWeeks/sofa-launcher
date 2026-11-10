import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppManager, type OpenOptions, type Spawner } from '../src/main/apps';
import { parseConfig, SEED_CONFIG } from '../src/main/config';
import { FakeMediaController } from '../src/main/mpris';
import { FakeWindowManager } from '../src/main/windows';
import { steamGameApps } from '../src/main/steam';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function open(mgr: AppManager, id: string, options?: OpenOptions) {
  const result = mgr.open(id, options);
  await vi.advanceTimersByTimeAsync(500);
  return result;
}

function setup(opts: { installed?: boolean } = {}) {
  const wm = new FakeWindowManager();
  const kills: string[] = [];
  const spawned: [string, string[]][] = [];
  const spawner: Spawner = (file, args) => {
    spawned.push([file, args]);
    if (args[0] !== 'kill') {
      const cls = file === 'flatpak' ? 'jellyfin-desktop' : args.find((a) => a.startsWith('--class='))?.slice(8) ?? 'nodie';
      setTimeout(() => wm.windows.set(cls, ['99']), 500);
    }
    return { pid: 1, kill: vi.fn((sig) => (kills.push(String(sig)), true)), once: vi.fn(), unref: vi.fn() } as never;
  };
  const mgr = new AppManager(parseConfig(SEED_CONFIG).apps, wm, {
    dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }),
    spawner,
    isExecutable: () => opts.installed ?? true,
    flatpakInstalled: async () => opts.installed ?? true,
    runCommand: async (file, args) => { spawned.push([file, args]); },
  });
  return { wm, mgr, spawned, kills };
}

describe('AppManager', () => {
  it('activates an already-running app instead of launching it again', async () => {
    const { wm, mgr, spawned } = setup();
    wm.windows.set('sofa-netflix', ['42']);
    const r = await open(mgr, 'netflix');
    expect(r.ok).toBe(true);
    expect(wm.activated).toEqual(['42']);
    expect(spawned).toEqual([]);
    expect(mgr.lastAppId).toBe('netflix');
  });

  it('launches an app that is not running', async () => {
    const { mgr, spawned } = setup();
    await open(mgr, 'jellyfin');
    expect(spawned[0]?.[0]).toBe('flatpak');
    expect(mgr.startedIds()).toEqual(['jellyfin']);
  });

  it('reports a missing app instead of failing silently', async () => {
    const { mgr, spawned } = setup({ installed: false });
    const r = await open(mgr, 'netflix');
    expect(r).toEqual({ ok: false, message: "Netflix isn't installed" });
    expect(spawned).toEqual([]);
  });

  it('closes only the apps it started, with SIGTERM', async () => {
    const { wm, mgr, kills } = setup();
    wm.windows.set('sofa-youtube', ['7']);
    await open(mgr, 'youtube'); // already running: not ours
    await open(mgr, 'netflix'); // started by us
    await mgr.closeStarted();
    expect(kills).toEqual(['SIGTERM']);
    expect(mgr.startedIds()).toEqual([]);
  });

  it('reports running and installed state per tile', async () => {
    const { wm, mgr } = setup();
    wm.windows.set('jellyfin-desktop', ['1']);
    const states = await mgr.states();
    expect(states.find((s) => s.id === 'jellyfin')).toMatchObject({ running: true, installed: true });
    expect(states.find((s) => s.id === 'netflix')).toMatchObject({ running: false });
  });

  it('rejects unknown ids', async () => {
    expect((await setup().mgr.open('nope')).ok).toBe(false);
  });
});

describe('AppManager hardening', () => {
  it('closes the actual window process after a launch wrapper has exited', async () => {
    const wm = new FakeWindowManager();
    const killPid = vi.fn();
    const child = { pid: 101, kill: vi.fn(() => false), once: vi.fn(), unref: vi.fn() };
    const mgr = new AppManager(parseConfig(SEED_CONFIG).apps, wm, {
      dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }), isExecutable: () => true, killPid,
      spawner: () => {
        setTimeout(() => { wm.windows.set('sofa-netflix', ['99']); wm.pids.set('99', 202); }, 500);
        return child as never;
      },
    });
    await open(mgr, 'netflix');
    expect(await mgr.close('netflix')).toBe(true);
    expect(killPid).toHaveBeenCalledWith(202);
    expect(mgr.startedIds()).toEqual([]);
  });
  it('does not spawn twice while an app is still launching (held OK button)', async () => {
    const { mgr, spawned } = setup();
    await Promise.all([open(mgr, 'netflix'), mgr.open('netflix'), mgr.open('netflix')]);
    expect(spawned).toHaveLength(1);
    await mgr.closeStarted();
  });

  it('closes flatpak apps with `flatpak kill` instead of signalling bwrap', async () => {
    const { mgr, spawned, kills } = setup();
    await open(mgr, 'jellyfin');
    await mgr.closeStarted();
    expect(spawned.at(-1)).toEqual(['flatpak', ['kill', 'org.jellyfin.JellyfinDesktop']]);
    expect(kills).toEqual([]);
  });

  it('isRunning reflects visible windows', async () => {
    const { wm, mgr } = setup();
    expect(await mgr.isRunning('netflix')).toBe(false);
    wm.windows.set('sofa-netflix', ['3']);
    expect(await mgr.isRunning('netflix')).toBe(true);
  });
});

describe('AppManager M2: close, search URLs, pause on switch', () => {
  function setupM2() {
    const base = setup();
    const media = new FakeMediaController();
    const killed: number[] = [];
    const opened: [string, boolean][] = [];
    const mgr = new AppManager(parseConfig(SEED_CONFIG).apps, base.wm, {
      dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }),
      spawner: (file, args) => {
        base.spawned.push([file, args]);
        setTimeout(() => base.wm.windows.set(args.find((a) => a.startsWith('--class='))?.slice(8) ?? 'jellyfin-desktop', ['99']), 500);
        return { pid: 1, kill: vi.fn((sig) => (base.kills.push(String(sig)), true)), once: vi.fn(), unref: vi.fn() } as never;
      },
      isExecutable: () => true,
      flatpakInstalled: async () => true,
      media,
      killPid: (p) => killed.push(p),
      onOpened: (a, spawned) => opened.push([a.id, spawned]),
    });
    return { ...base, mgr, media, killed, opened };
  }

  it('opens a web app at a different HTTPS URL and refuses scripts', async () => {
    const { mgr, spawned } = setupM2();
    await open(mgr, 'netflix', { url: 'https://www.netflix.com/search?q=The%20Crown' });
    expect(spawned[0]?.[1]).toContain('--app=https://www.netflix.com/search?q=The%20Crown');
    const r = await open(mgr, 'prime', { url: 'javascript:alert(1)' });
    expect(r.ok).toBe(false);
    expect(spawned).toHaveLength(1);
  });

  it.each(['http://127.0.0.1:5055', 'http://localhost:8080', 'http://192.168.1.50:5055', 'http://homeassistant.local:8123'])('allows loopback and LAN overrides: %s', async (url) => {
    const { mgr, spawned } = setupM2();
    expect((await open(mgr, 'jellyseerr', { url })).ok).toBe(true);
    expect(spawned[0]?.[1]).toContain(`--app=${url}`);
  });

  it.each(['http://192.168.1.50.evil.com', 'http://user@192.168.1.50', 'http://evil.com#@192.168.1.50', 'http://3232235777', 'http://0xC0A80101', 'http://0300.0250.1.1', 'http://127.0.0.1.evil.com', 'http://localhost.evil.com', 'http://user@127.0.0.1@evil'])('rejects remote HTTP overrides: %s', async (url) => {
    const { mgr, spawned } = setupM2();
    expect((await open(mgr, 'jellyseerr', { url })).ok).toBe(false);
    expect(spawned).toEqual([]);
  });

  it('refuses a URL for desktop apps', async () => {
    const { mgr, spawned } = setupM2();
    expect((await open(mgr, 'jellyfin', { url: 'https://x' })).ok).toBe(false);
    expect(spawned).toEqual([]);
  });

  it('pauses the app being left, via its first window', async () => {
    const { wm, mgr, media } = setupM2();
    wm.windows.set('sofa-netflix', ['11']);
    wm.windows.set('sofa-youtube', ['22']);
    await open(mgr, 'netflix');
    expect(media.paused).toEqual([]);
    await open(mgr, 'youtube');
    expect(media.paused).toEqual([{ windowId: '11', hints: { flatpakId: undefined } }]);
    await open(mgr, 'youtube'); // same app again: nothing to pause
    expect(media.paused).toHaveLength(1);
    wm.windows.set('jellyfin-desktop', ['33']);
    await open(mgr, 'jellyfin');
    await open(mgr, 'netflix');
    expect(media.paused.at(-1)).toEqual({ windowId: '33', hints: { flatpakId: 'org.jellyfin.JellyfinDesktop' } });
  });

  it('reports honestly when there was nothing to close', async () => {
    const { wm, mgr, killed } = setupM2();
    expect(await mgr.close('jellyfin')).toBe(false); // flatpak, no windows, not started
    wm.windows.set('sofa-youtube', ['22']); // window without a readable pid
    expect(await mgr.close('youtube')).toBe(false);
    expect(killed).toEqual([]);
    const dead = new AppManager(parseConfig(SEED_CONFIG).apps, wm, {
      dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }),
      spawner: () => { setTimeout(() => wm.windows.set('sofa-netflix', ['99']), 500); return { pid: 1, kill: () => false, once: vi.fn(), unref: vi.fn() } as never; },
      isExecutable: () => true,
      flatpakInstalled: async () => true,
    });
    await open(dead, 'netflix');
    expect(await dead.close('netflix')).toBe(false); // process already gone
    expect(dead.startedIds()).toEqual(['netflix']);
  });

  it('untracks an app whose spawn fails', async () => {
    const wm = new FakeWindowManager();
    const closed: string[] = [];
    let onError: (() => void) | undefined;
    const mgr = new AppManager(parseConfig(SEED_CONFIG).apps, wm, {
      dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }),
      spawner: () => ({ pid: 1, kill: vi.fn(), unref: vi.fn(), once: (ev: string, cb: () => void) => { if (ev === 'error') onError = cb; } }) as never,
      isExecutable: () => true,
      flatpakInstalled: async () => true,
      onClosed: (a) => closed.push(a.id),
    });
    const opening = mgr.open('netflix');
    await vi.advanceTimersByTimeAsync(0);
    onError!();
    expect(await opening).toEqual({ ok: false });
    expect(closed).toEqual(['netflix']);
    expect(mgr.startedIds()).toEqual([]);
  });

  it('closes an app it started with SIGTERM, and one it did not via the window pid', async () => {
    const { wm, mgr, kills, killed } = setupM2();
    await open(mgr, 'netflix');
    expect(await mgr.close('netflix')).toBe(true);
    expect(kills).toEqual(['SIGTERM']);
    wm.windows.set('sofa-youtube', ['22', '23']);
    wm.pids.set('22', 5000);
    wm.pids.set('23', 5000);
    expect(await mgr.close('youtube')).toBe(true);
    expect(killed).toEqual([5000]);
    expect(await mgr.close('prime')).toBe(false); // not running
    expect(await mgr.close('nope')).toBe(false);
  });

  it('tells the watchdog what it opened', async () => {
    const { wm, mgr, opened } = setupM2();
    wm.windows.set('sofa-youtube', ['22']);
    await open(mgr, 'youtube');
    await open(mgr, 'netflix');
    expect(opened).toEqual([['youtube', false], ['netflix', true]]);
  });

  it('finds the app that owns a window, by WM_CLASS when readable', async () => {
    const { wm, mgr } = setupM2();
    wm.classes.set('55', 'Sofa-Youtube'); // one xprop read, case-insensitive
    expect((await mgr.appForWindow('55'))?.id).toBe('youtube');
    wm.classes.set('56', 'microsoft-edge'); // a window that isn't one of ours
    expect(await mgr.appForWindow('56')).toBeNull();
    wm.windows.set('sofa-prime', ['33']); // fallback: search per app
    expect((await mgr.appForWindow('33'))?.id).toBe('prime');
    expect(await mgr.appForWindow('44')).toBeNull();
    expect(await mgr.appForWindow(null)).toBeNull();
  });
});

describe('launch lifecycle regressions', () => {
  function lifecycle() {
    const wm = new FakeWindowManager();
    const events: Record<string, (code?: number | null) => void> = {};
    const toast = vi.fn();
    const onOpened = vi.fn();
    const changed = vi.fn();
    const kill = vi.fn(() => true);
    const spawner = vi.fn(() => ({ pid: 1, kill, once: (event: string, cb: (code?: number | null) => void) => { events[event] = cb; }, unref: vi.fn() })) as unknown as ReturnType<typeof vi.fn<Spawner>>;
    const mgr = new AppManager(parseConfig(SEED_CONFIG).apps, wm, {
      dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }), isExecutable: () => true, flatpakInstalled: async () => true,
      spawner, onToast: toast, onOpened, onStateChanged: changed,
      runCommand: async (file, args) => { spawner(file, args); },
    });
    return { wm, mgr, events, toast, spawner, kill, onOpened, changed };
  }

  it.each([[[]], [['42']]])('cancels discovery before it can spawn or activate (%j)', async (windows) => {
    const { wm, mgr, spawner } = lifecycle();
    let resolve!: (windows: string[]) => void;
    wm.findByClass = () => new Promise((r) => { resolve = r; });
    const pending = mgr.open('netflix');
    await mgr.closeStarted();
    resolve(windows);
    expect(await pending).toEqual({ ok: false });
    expect(spawner).not.toHaveBeenCalled();
    expect(wm.activated).toEqual([]);
  });

  it('cancels while checking Flatpak installation', async () => {
    const { mgr, spawner } = lifecycle();
    let resolve!: (installed: boolean) => void;
    const probe = new Promise<boolean>((r) => { resolve = r; });
    const other = new AppManager(mgr.list(), new FakeWindowManager(), { dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }), spawner, flatpakInstalled: () => probe });
    const pending = other.open('jellyfin');
    await vi.advanceTimersByTimeAsync(0);
    await other.closeStarted();
    resolve(true);
    expect(await pending).toEqual({ ok: false });
    expect(spawner).not.toHaveBeenCalled();
  });

  it('reserves a slow launch past five seconds and activates its discovered window', async () => {
    const { wm, mgr, spawner, onOpened } = lifecycle();
    const pending = mgr.open('netflix');
    await vi.advanceTimersByTimeAsync(10_000);
    await mgr.open('netflix');
    expect(spawner).toHaveBeenCalledTimes(1);
    expect(onOpened).not.toHaveBeenCalled();
    wm.windows.set('sofa-netflix', ['42', '43']);
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toEqual({ ok: true });
    expect(wm.activated).toEqual(['43']);
    expect(onOpened).toHaveBeenCalledWith(mgr.get('netflix'), true);
  });

  it('cancels a spawned launch during polling without late activation or a failure toast', async () => {
    const { wm, mgr, kill, toast } = lifecycle();
    const pending = mgr.open('netflix');
    await vi.advanceTimersByTimeAsync(1000);
    await mgr.closeStarted();
    expect(await pending).toEqual({ ok: false });
    wm.windows.set('sofa-netflix', ['42']);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(wm.activated).toEqual([]);
    expect(toast).not.toHaveBeenCalled();
  });

  it('times out after 20 seconds, clears running state and releases the reservation', async () => {
    const { mgr, wm, toast, changed, spawner } = lifecycle();
    const pending = mgr.open('netflix');
    await vi.advanceTimersByTimeAsync(19_500);
    expect(toast).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toEqual({ ok: false });
    expect(toast).toHaveBeenCalledExactlyOnceWith("Netflix didn't open");
    expect(changed).toHaveBeenCalledTimes(1);
    wm.windows.set('sofa-netflix', ['late-window']);
    expect((await mgr.states()).find((a) => a.id === 'netflix')?.running).toBe(false);
    wm.windows.clear();
    const retry = mgr.open('netflix');
    await vi.advanceTimersByTimeAsync(0);
    expect(spawner).toHaveBeenCalledTimes(2);
    await mgr.closeStarted();
    await retry;
  });

  it.each(['error', 'exit'])('reports a process %s immediately, with no running tile or duplicate toast', async (event) => {
    const { mgr, wm, events, toast } = lifecycle();
    const pending = mgr.open('netflix');
    await vi.advanceTimersByTimeAsync(1000);
    events[event]!(1);
    expect(await pending).toEqual({ ok: false });
    events.error!();
    wm.windows.set('sofa-netflix', ['42']);
    expect((await mgr.states()).find((a) => a.id === 'netflix')?.running).toBe(false);
    expect(toast).toHaveBeenCalledExactlyOnceWith("Netflix couldn't start");
    expect(mgr.startedIds()).toEqual([]);
  });

  it('reports an immediate exit even after the window was activated', async () => {
    const { mgr, wm, events, toast } = lifecycle();
    const pending = mgr.open('netflix');
    await vi.advanceTimersByTimeAsync(0);
    wm.windows.set('sofa-netflix', ['42']);
    await vi.advanceTimersByTimeAsync(500);
    expect((await pending).ok).toBe(true);
    events.exit!(1);
    expect(toast).toHaveBeenCalledWith("Netflix couldn't start");
    expect((await mgr.states()).find((a) => a.id === 'netflix')?.running).toBe(false);
  });

  it('handles a synchronous spawn error', async () => {
    const { mgr, spawner, toast } = lifecycle();
    spawner.mockImplementation(() => { throw new Error('spawn failed'); });
    expect(await mgr.open('netflix')).toEqual({ ok: false });
    expect(toast).toHaveBeenCalledWith("Netflix couldn't start");
  });

  it('keeps Nod.ie running on launcher close, but permits explicit app close', async () => {
    const { mgr, wm, kill } = lifecycle();
    mgr.setApps(mgr.list().map((a) => a.id === 'nodie' ? { ...a, keepOnClose: true } : a));
    const pending = mgr.open('nodie');
    await vi.advanceTimersByTimeAsync(0);
    wm.windows.set('nodie', ['42']);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    await mgr.closeStarted();
    expect(kill).not.toHaveBeenCalled();
    expect(mgr.startedIds()).toEqual(['nodie']);
    expect(await mgr.close('nodie')).toBe(true);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('does not treat talk hotkeys as a keep-running policy', async () => {
    const { mgr, wm, kill } = lifecycle();
    mgr.setApps(mgr.list().map((a) => ({ ...a, keepOnClose: false, hotkeys: { talk: 'ctrl+t' } })));
    const pending = mgr.open('netflix');
    await vi.advanceTimersByTimeAsync(0);
    wm.windows.set('sofa-netflix', ['42']);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    await mgr.closeStarted();
    expect(kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('uses explicit Flatpak metadata even with trailing command arguments', async () => {
    const { mgr, spawner, wm } = lifecycle();
    mgr.setApps(mgr.list().map((a) => a.id === 'jellyfin' ? { ...a, command: [...a.command!, '--fullscreen'] } : a));
    const pending = mgr.open('jellyfin');
    await vi.advanceTimersByTimeAsync(0);
    wm.windows.set('jellyfin-desktop', ['42']);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    await mgr.closeStarted();
    expect(spawner).toHaveBeenLastCalledWith('flatpak', ['kill', 'org.jellyfin.JellyfinDesktop']);
  });

  it.each([true, false])('caches Flatpak installation (%s) for 60 seconds independently of executable presence', async (installed) => {
    const probe = vi.fn().mockResolvedValue(installed);
    const mgr = new AppManager(parseConfig(SEED_CONFIG).apps, new FakeWindowManager(), {
      dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }), isExecutable: () => true, flatpakInstalled: probe,
    });
    const state = async () => (await mgr.states()).find((a) => a.id === 'jellyfin')!;
    expect((await state()).installed).toBe(installed);
    await vi.advanceTimersByTimeAsync(59_999);
    await state();
    expect(probe).toHaveBeenCalledExactlyOnceWith('org.jellyfin.JellyfinDesktop');
    await vi.advanceTimersByTimeAsync(1);
    await state();
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe('TV session cleanup', () => {
  it('closes an adopted Jellyfin window but leaves untouched apps alone', async () => {
    const { mgr, wm, spawned } = setup();
    wm.windows.set('jellyfin-desktop', ['42']);
    wm.windows.set('sofa-netflix', ['43']);
    await open(mgr, 'jellyfin');
    await mgr.closeSession();
    expect(spawned).toEqual([['flatpak', ['kill', 'org.jellyfin.JellyfinDesktop']]]);
  });

  it('closes Nod.ie by default and honours explicit keepOnClose', async () => {
    const { mgr, kills } = setup();
    await open(mgr, 'nodie');
    await mgr.closeSession();
    expect(kills).toEqual(['SIGTERM']);
    await open(mgr, 'netflix');
    mgr.setApps(mgr.list().map((a) => ({ ...a, keepOnClose: true })));
    await mgr.closeSession();
    expect(kills).toEqual(['SIGTERM']);
  });
});

describe('navigation, handoff and close regressions', () => {
  function fixture() {
    const wm = new FakeWindowManager();
    const callbacks = new Map<string, Record<string, (code: number | null) => void>>();
    const onOpened = vi.fn();
    const onClosed = vi.fn();
    const onToast = vi.fn();
    const runCommand = vi.fn().mockResolvedValue({});
    const media = new FakeMediaController();
    const spawner: Spawner = (_file, args) => {
      const events: Record<string, (code: number | null) => void> = {};
      callbacks.set(args.find((a) => a.startsWith('--class='))?.slice(8) ?? 'jellyfin-desktop', events);
      return { pid: 1, kill: () => true, unref: () => {}, once: (event: string, cb: (code: number | null) => void) => { events[event] = cb; } } as never;
    };
    const mgr = new AppManager(parseConfig(SEED_CONFIG).apps, wm, {
      dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }), spawner, isExecutable: () => true, flatpakInstalled: async () => true,
      onOpened, onClosed, onToast, runCommand, media,
    });
    return { mgr, wm, callbacks, onOpened, onClosed, onToast, runCommand, media };
  }

  it.each(['Home', 'another app'])('a slow launch cannot steal focus after %s, but remains tracked', async (destination) => {
    const { mgr, wm, onOpened, onToast } = fixture();
    const pending = mgr.open('netflix');
    await vi.advanceTimersByTimeAsync(1000);
    if (destination === 'Home') mgr.navigate();
    else {
      wm.windows.set('sofa-youtube', ['22']);
      await mgr.open('youtube');
    }
    wm.windows.set('sofa-netflix', ['11']);
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toEqual({ ok: false });
    expect(wm.activated).toEqual(destination === 'Home' ? [] : ['22']);
    expect(mgr.lastAppId).toBe(destination === 'Home' ? null : 'youtube');
    expect(mgr.startedIds()).toEqual(['netflix']);
    expect(onOpened).toHaveBeenCalledWith(mgr.get('netflix'), true);
    expect(onToast).not.toHaveBeenCalled();
  });

  it('can select a pending background launch again without spawning twice', async () => {
    const { mgr, wm, media } = fixture();
    const pending = mgr.open('netflix');
    await vi.advanceTimersByTimeAsync(0);
    wm.windows.set('sofa-youtube', ['22']);
    await mgr.open('youtube');
    await mgr.open('netflix');
    wm.windows.set('sofa-netflix', ['11']);
    await vi.advanceTimersByTimeAsync(500);
    expect((await pending).ok).toBe(true);
    expect(wm.activated).toEqual(['22', '11']);
    expect(mgr.lastAppId).toBe('netflix');
    expect(media.paused).toEqual([{ windowId: '22', hints: { flatpakId: undefined } }]);
  });

  it('does not pause the app being left when the destination is not installed', async () => {
    const { wm, media } = fixture();
    const mgr = new AppManager(parseConfig(SEED_CONFIG).apps, wm, {
      dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }), isExecutable: () => false, media,
    });
    wm.windows.set('sofa-netflix', ['11']);
    await mgr.open('netflix');
    expect(await mgr.open('youtube')).toEqual({ ok: false, message: "YouTube isn't installed" });
    expect(media.paused).toEqual([]);
  });

  it('keeps both players running when explicitly opening a screen-in-screen pair', async () => {
    const { mgr, wm, media } = fixture();
    wm.windows.set('sofa-netflix', ['11']);
    wm.windows.set('sofa-youtube', ['22']);
    await mgr.open('netflix');
    await mgr.open('youtube', { pausePrevious: false });
    expect(media.paused).toEqual([]);
    await mgr.open('netflix');
    expect(media.paused).toEqual([{ windowId: '22', hints: { flatpakId: undefined } }]);
  });

  it.each(['before', 'after'])('keeps tracking a clean handoff %s window discovery', async (when) => {
    const { mgr, wm, callbacks, onOpened, onClosed, onToast } = fixture();
    const pending = mgr.open('netflix');
    await vi.advanceTimersByTimeAsync(0);
    if (when === 'before') callbacks.get('sofa-netflix')!.exit!(0);
    wm.windows.set('sofa-netflix', ['11']);
    await vi.advanceTimersByTimeAsync(500);
    expect((await pending).ok).toBe(true);
    if (when === 'after') callbacks.get('sofa-netflix')!.exit!(0);
    expect(mgr.startedIds()).toEqual(['netflix']);
    expect(onOpened).toHaveBeenCalledOnce();
    expect(onClosed).not.toHaveBeenCalled();
    expect(onToast).not.toHaveBeenCalled();
    expect((await mgr.states()).find((s) => s.id === 'netflix')?.running).toBe(true);
  });

  it('cleans up background spawn errors after navigation without a failure toast', async () => {
    const { mgr, callbacks, onClosed, onToast } = fixture();
    const pending = mgr.open('netflix');
    await vi.advanceTimersByTimeAsync(0);
    mgr.navigate();
    callbacks.get('sofa-netflix')!.error!(null);
    expect((await pending).ok).toBe(false);
    expect(mgr.startedIds()).toEqual([]);
    expect(onClosed).toHaveBeenCalledOnce();
    expect(onToast).not.toHaveBeenCalled();
  });

  it('does not pause the current app when the destination cannot open', async () => {
    const { mgr, wm, media } = fixture();
    wm.windows.set('sofa-netflix', ['11']);
    await mgr.open('netflix');
    expect((await mgr.open('youtube', { url: 'javascript:bad' })).ok).toBe(false);
    expect(media.paused).toEqual([]);
  });

  it('waits for destination discovery before starting a pause', async () => {
    const { mgr, wm, media } = fixture();
    wm.windows.set('sofa-netflix', ['11']);
    await mgr.open('netflix');
    const pending = mgr.open('youtube');
    await vi.advanceTimersByTimeAsync(1000);
    expect(media.paused).toEqual([]);
    wm.windows.set('sofa-youtube', ['22']);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(media.paused).toHaveLength(1);
  });

  it('invalidates a delayed pause if the user returns to its app', async () => {
    const { mgr, wm, media } = fixture();
    wm.windows.set('sofa-netflix', ['11']);
    wm.windows.set('sofa-youtube', ['22']);
    await mgr.open('netflix');
    let complete!: () => boolean;
    media.pauseWindow = vi.fn(async (_window, hints) => {
      complete = () => hints?.shouldPause?.() ?? true;
      return true;
    });
    await mgr.open('youtube');
    const oldPause = complete;
    await mgr.open('netflix');
    expect(oldPause()).toBe(false);
  });

  it.each(['spawn error', 'nonzero exit', 'timeout'])('retains Flatpak tracking on %s and permits retry', async (reason) => {
    const { mgr, wm, runCommand, onClosed } = fixture();
    const pending = mgr.open('jellyfin');
    await vi.advanceTimersByTimeAsync(0);
    wm.windows.set('jellyfin-desktop', ['33']);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    runCommand.mockRejectedValueOnce(new Error(reason));
    expect(await mgr.close('jellyfin')).toBe(false);
    expect(runCommand).toHaveBeenCalledWith('flatpak', ['kill', 'org.jellyfin.JellyfinDesktop'], { timeout: 5000 });
    expect(mgr.startedIds()).toEqual(['jellyfin']);
    expect(onClosed).not.toHaveBeenCalled();
    expect(await mgr.close('jellyfin')).toBe(true);
    expect(mgr.startedIds()).toEqual([]);
    expect(onClosed).toHaveBeenCalledOnce();
  });

  it('continues background discovery when closing a pending Flatpak launch fails', async () => {
    const { mgr, wm, runCommand, onOpened } = fixture();
    const pending = mgr.open('jellyfin');
    await vi.advanceTimersByTimeAsync(0);
    runCommand.mockRejectedValueOnce(new Error('kill failed'));
    await mgr.closeStarted();
    wm.windows.set('jellyfin-desktop', ['33']);
    await vi.advanceTimersByTimeAsync(500);
    expect((await pending).ok).toBe(false);
    expect(wm.activated).toEqual([]);
    expect(mgr.startedIds()).toEqual(['jellyfin']);
    expect(onOpened).toHaveBeenCalledWith(mgr.get('jellyfin'), true);
  });

  it('awaits Flatpak command completion before forgetting ownership', async () => {
    const { mgr, wm, runCommand, onClosed } = fixture();
    const pending = mgr.open('jellyfin');
    await vi.advanceTimersByTimeAsync(0);
    wm.windows.set('jellyfin-desktop', ['33']);
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    let finish!: () => void;
    runCommand.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const closing = mgr.closeStarted();
    expect(mgr.startedIds()).toEqual(['jellyfin']);
    expect(onClosed).not.toHaveBeenCalled();
    finish();
    await closing;
    expect(mgr.startedIds()).toEqual([]);
    expect(onClosed).toHaveBeenCalledOnce();
  });
});

describe('managed camera windows', () => {
  it('opens, resumes and closes a camera without spawning or signalling the shared process', async () => {
    const wm = new FakeWindowManager();
    const config = parseConfig('[homeAssistant]\nurl="https://ha.example"\n[[cameras]]\nid="door"\nname="Door"\nentity="camera.door"');
    const spawner = vi.fn(), killPid = vi.fn();
    const managed = {
      open: vi.fn(async () => { wm.windows.set('sofa-camera-door', ['42']); wm.pids.set('42', process.pid); return '42'; }),
      close: vi.fn(async () => { wm.windows.delete('sofa-camera-door'); return true; }),
      pause: vi.fn(async () => undefined),
    };
    const mgr = new AppManager(config.apps, wm, {dataDir:'/d',managed,spawner,killPid});
    expect((await mgr.states()).find(a => a.id === 'camera-door')).toMatchObject({type:'camera',installed:true});
    expect((await mgr.open('camera-door')).ok).toBe(true);
    expect((await mgr.open('camera-door')).activated).toBe(true);
    expect(managed.open).toHaveBeenCalledTimes(2);
    await mgr.closeSession();
    expect(managed.close).toHaveBeenCalledTimes(1);
    expect(spawner).not.toHaveBeenCalled(); expect(killPid).not.toHaveBeenCalled();
  });
});

describe('AppManager: games', () => {
  function setupGames() {
    const wm = new FakeWindowManager();
    const media = new FakeMediaController();
    const spawned: [string, string[]][] = [];
    const childKill = vi.fn(() => true);
    const killed: number[] = [];
    const steam = steamGameApps([{ appId: '552990', name: 'World of Warships', lastPlayed: 0 }], '/usr/games/steam');
    const apps = [...parseConfig(SEED_CONFIG + '\n[[apps]]\nid = "roblox"\ncatalogue = "roblox"\n').apps, ...steam];
    const mgr = new AppManager(apps, wm, {
      dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }),
      spawner: (file, args) => {
        spawned.push([file, args]);
        if (file === '/usr/games/steam') setTimeout(() => { wm.windows.set('steam_app_552990', ['77']); wm.pids.set('77', 4242); }, 500);
        return { pid: 1000, kill: childKill, once: vi.fn(), unref: vi.fn() } as never;
      },
      isExecutable: () => true,
      flatpakInstalled: async () => true,
      media,
      killPid: (pid) => killed.push(pid),
    });
    return { wm, media, mgr, spawned, childKill, killed };
  }

  it('never pauses (or sends anything to) a game when another app is opened', async () => {
    const { wm, media, mgr } = setupGames();
    wm.windows.set('steam_app_552990', ['77']);
    wm.windows.set('sober', ['78']);
    wm.windows.set('sofa-netflix', ['11']);
    await open(mgr, 'steam-552990');
    await open(mgr, 'netflix');
    await open(mgr, 'roblox');
    await open(mgr, 'netflix');
    // Only Netflix (window 11) was paused, when Roblox opened; the games' windows (77, 78) never.
    expect(media.paused.map((p) => p.windowId)).toEqual(['11']);
    await mgr.pause('steam-552990');
    await mgr.pause('roblox');
    expect(media.paused).toHaveLength(1);
  });

  it('brings a running game forward instead of starting it again', async () => {
    const { wm, mgr, spawned } = setupGames();
    wm.windows.set('steam_app_552990', ['77']);
    const result = await open(mgr, 'steam-552990');
    expect(result).toMatchObject({ ok: true, activated: true });
    expect(wm.activated).toEqual(['77']);
    expect(spawned).toEqual([]);
  });

  it('launches a Steam game through Steam and finds its Proton window', async () => {
    const { wm, mgr, spawned } = setupGames();
    const result = await open(mgr, 'steam-552990');
    expect(spawned).toEqual([['/usr/games/steam', ['-silent', '-applaunch', '552990']]]);
    expect(result.ok).toBe(true);
    expect(wm.activated).toEqual(['77']);
  });

  it('waits longer than other apps for a game window before giving up', async () => {
    const { mgr } = setupGames();
    const toasts: string[] = [];
    const slow = new AppManager([{ ...mgr.get('steam-552990')!, wmClass: 'never-appears' }], new FakeWindowManager(), {
      dataDir: '/d', browserFor: () => ({ id: 'edge', binary: '/usr/bin/microsoft-edge-stable' }), isExecutable: () => true, onToast: (t) => toasts.push(t),
      spawner: () => ({ pid: 1, kill: vi.fn(), once: vi.fn(), unref: vi.fn() }) as never,
    });
    const result = slow.open('steam-552990');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(toasts).toEqual([]); // an ordinary app would have failed at 20 s
    await vi.advanceTimersByTimeAsync(95_000);
    expect(await result).toEqual({ ok: false });
    expect(toasts).toEqual(["World of Warships didn't open"]);
  });

  it('closes a Steam game by its window process, never signalling the Steam command it ran', async () => {
    const { mgr, childKill, killed } = setupGames();
    await open(mgr, 'steam-552990');
    expect(await mgr.close('steam-552990')).toBe(true);
    expect(childKill).not.toHaveBeenCalled();
    expect(killed).toEqual([4242]);
  });
});
