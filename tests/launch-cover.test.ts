import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coverToastGate, launchCover, launchCoverTimeout, requiresFullscreen } from '../src/main/launch-cover';
import { resolveCatalogueApp } from '../src/main/config';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fixture() {
  let active: string | null = 'home';
  let fullscreen = false;
  let windows = ['app'];
  const setAbove = vi.fn();
  const activeWindow = vi.fn(async () => active);
  const isFullscreen = vi.fn(async () => fullscreen);
  const targets = vi.fn(async () => windows);
  const cover = launchCover({
    setAbove, activeWindow, isFullscreen, ownWindows: () => ['home'],
  });
  return {
    cover, setAbove, targets, activeWindow, isFullscreen,
    state: (id: string | null, full: boolean, mapped = ['app']) => { active = id; fullscreen = full; windows = mapped; },
  };
}

describe('launchCover', () => {
  it('keeps the cold-start cover through mapping, activation and the normal-to-fullscreen transition', async () => {
    const f = fixture();
    await f.cover(async () => 'opened', f.targets);
    f.state('app', false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.setAbove.mock.calls).toEqual([[true]]);
    f.state('app', true);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove.mock.calls).toEqual([[true], [false]]);
  });

  it.each(['steam-updater', 'flatpak-class-mismatch', 'splash'])('releases for fullscreen %s regardless of configured class', async id => {
    const f = fixture();
    await f.cover(async () => undefined, f.targets);
    f.state('home', true);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove.mock.calls).toEqual([[true]]);
    f.state(id, false, []);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove.mock.calls).toEqual([[true]]);
    f.state(id, true, []);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove.mock.calls).toEqual([[true], [false]]);
  });

  it.each(['edge', 'roblox', 'nodie'])('releases windowed %s on mapping and activation without requiring fullscreen', async id => {
    const f = fixture();
    const app = resolveCatalogueApp(id)!;
    expect(requiresFullscreen(app)).toBe(false);
    await f.cover(async () => ({ ok: true }), f.targets, requiresFullscreen(app));
    f.state('other', false);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove.mock.calls).toEqual([[true]]);
    f.state('app', false, []);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove.mock.calls).toEqual([[true]]);
    f.state('app', false);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove.mock.calls).toEqual([[true], [false]]);
    expect(f.isFullscreen).toHaveBeenCalled();
  });

  it.each(['netflix', 'jellyfin'])('waits for fullscreen when opening %s', async id => {
    const f = fixture();
    const app = resolveCatalogueApp(id)!;
    expect(requiresFullscreen(app)).toBe(true);
    await f.cover(async () => ({ ok: true }), f.targets, requiresFullscreen(app));
    f.state('app', false);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove.mock.calls).toEqual([[true]]);
    f.state('app', true);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove.mock.calls).toEqual([[true], [false]]);
  });

  it('polls focus first every 100 ms and skips search and xprop while Home or no window is active', async () => {
    const f = fixture();
    await f.cover(async () => ({ ok: true }), f.targets);
    expect(f.activeWindow).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(f.activeWindow).toHaveBeenCalledTimes(1);
    f.state(null, false);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.activeWindow).toHaveBeenCalledTimes(2);
    expect(f.targets).not.toHaveBeenCalled();
    expect(f.isFullscreen).not.toHaveBeenCalled();
    f.state('app', true);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.activeWindow.mock.invocationCallOrder.at(-1)!).toBeLessThan(f.isFullscreen.mock.invocationCallOrder[0]!);
    expect(f.targets).not.toHaveBeenCalled();
    expect(f.setAbove).toHaveBeenLastCalledWith(false);
  });

  it('expires eight seconds from launch even while discovery is still pending', async () => {
    const f = fixture();
    let finish!: () => void;
    const pending = f.cover(() => new Promise<void>(resolve => { finish = resolve; }), f.targets);
    await vi.advanceTimersByTimeAsync(7999);
    expect(f.setAbove.mock.calls).toEqual([[true]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.setAbove.mock.calls).toEqual([[true], [false]]);
    finish(); await pending;
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove).toHaveBeenCalledTimes(2);
  });

  it('bounds hung X11 probes and tolerates failed probes', async () => {
    const f = fixture();
    f.state('app', false);
    f.activeWindow.mockImplementationOnce(() => new Promise(() => undefined));
    await f.cover(async () => undefined, f.targets);
    await vi.advanceTimersByTimeAsync(8000);
    expect(f.setAbove).toHaveBeenLastCalledWith(false);
    await f.cover(async () => undefined, async () => { throw new Error('X11 gone'); });
    await vi.advanceTimersByTimeAsync(8000);
    expect(f.setAbove.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it('releases on thrown opening errors', async () => {
    const f = fixture();
    await expect(f.cover(async () => { throw new Error('spawn failed'); }, f.targets)).rejects.toThrow('spawn failed');
    expect(f.setAbove).toHaveBeenLastCalledWith(false);
  });

  it.each(['not installed', 'failed spawn', 'superseded'])('releases immediately on an unsuccessful open: %s', async message => {
    const f = fixture();
    const result = { ok: false, message };
    expect(await f.cover(async () => result, f.targets)).toBe(result);
    expect(f.setAbove.mock.calls).toEqual([[true], [false]]);
    await vi.advanceTimersByTimeAsync(8000);
    expect(f.setAbove).toHaveBeenCalledTimes(2);
  });

  it('does not let a superseded unsuccessful open cancel the newer cover', async () => {
    const f = fixture();
    let finish!: (result: { ok: boolean }) => void;
    const old = f.cover(() => new Promise<{ ok: boolean }>(resolve => { finish = resolve; }), f.targets);
    await f.cover(async () => ({ ok: true }), f.targets);
    finish({ ok: false });
    await old;
    expect(f.setAbove.mock.calls).toEqual([[true], [true]]);
    f.state('app', true);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove.mock.calls).toEqual([[true], [true], [false]]);
  });

  it('a newer launch takes over both the old release and deadline', async () => {
    const f = fixture();
    await f.cover(async () => undefined, f.targets);
    await vi.advanceTimersByTimeAsync(4000);
    await f.cover(async () => undefined, f.targets);
    await vi.advanceTimersByTimeAsync(4000);
    expect(f.setAbove.mock.calls).toEqual([[true], [true]]);
    f.state('app', true);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove.mock.calls).toEqual([[true], [true], [false]]);
  });

  it('navigation cancels the cover and stale polls cannot uncover a later launch', async () => {
    const f = fixture();
    await f.cover(async () => undefined, f.targets);
    f.cover.cancel();
    await f.cover(async () => undefined, f.targets);
    await vi.advanceTimersByTimeAsync(100);
    expect(f.setAbove.mock.calls).toEqual([[true], [false], [true]]);
    f.cover.cancel();
    await vi.advanceTimersByTimeAsync(8000);
  });
});

it.each(['nodie', 'roblox'])('bounds desktop %s cover to four seconds', async id => {
  const f = fixture();
  const app = resolveCatalogueApp(id)!;
  expect(launchCoverTimeout(app)).toBe(4000);
  await f.cover(async () => undefined, f.targets, requiresFullscreen(app), launchCoverTimeout(app));
  await vi.advanceTimersByTimeAsync(3999);
  expect(f.setAbove.mock.calls).toEqual([[true]]);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.setAbove.mock.calls).toEqual([[true], [false]]);
});

it('hides the notification cover before displaying a launch failure toast', async () => {
  const events: unknown[] = [];
  const gate = coverToastGate(above => events.push(['cover', above]), text => events.push(['toast', text]));
  const cover = launchCover({ setAbove: gate.setAbove, activeWindow: async () => null, isFullscreen: async () => false });
  await cover(async () => {
    gate.toast('App did not open');
    expect(events).toEqual([['cover', true]]);
    return { ok: false };
  }, async () => []);
  expect(events).toEqual([['cover', true], ['cover', false], ['toast', 'App did not open']]);
  gate.toast('Ready');
  expect(events.at(-1)).toEqual(['toast', 'Ready']);
});
