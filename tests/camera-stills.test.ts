import { describe, expect, it, vi } from 'vitest';
import { CameraStills, STILL_REFRESH_MS, type CameraStillsOptions } from '../src/main/camera-stills';

/** Manual clock and timers, so rounds run only when the test says so. */
function harness(overrides: Partial<CameraStillsOptions> = {}) {
  let now = 1_000_000;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const changes: [string, string | null][] = [];
  const log = vi.fn();
  const fetchStill = vi.fn(async (id: string): Promise<string | null> => `data:image/jpeg;base64,${id}`);
  const ids = vi.fn(() => ['camera-a', 'camera-b', 'camera-c']);
  const stills = new CameraStills({
    ids, fetchStill, log,
    onChange: (id, value) => changes.push([id, value]),
    now: () => now,
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
    ...overrides,
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  /** Move the clock on and fire due timers (then let the round's promises settle). */
  const advance = async (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now) { timers.delete(id); t.fn(); }
    for (let i = 0; i < 5; i++) await flush();
  };
  return { stills, changes, log, fetchStill, ids, timers, flush, advance };
}

describe('camera tile stills', () => {
  it('fetches every camera when Home shows, then about once a minute, and stops when hidden', async () => {
    const h = harness();
    expect(h.fetchStill).not.toHaveBeenCalled(); // nothing until Home is shown
    h.stills.setActive(true);
    await h.advance(0);
    expect(h.fetchStill).toHaveBeenCalledTimes(3);
    expect(h.stills.stills).toEqual({ 'camera-a': 'data:image/jpeg;base64,camera-a', 'camera-b': 'data:image/jpeg;base64,camera-b', 'camera-c': 'data:image/jpeg;base64,camera-c' });
    expect(h.changes.map(([id]) => id)).toEqual(['camera-a', 'camera-b', 'camera-c']);
    await h.advance(STILL_REFRESH_MS - 1);
    expect(h.fetchStill).toHaveBeenCalledTimes(3);
    await h.advance(1);
    expect(h.fetchStill).toHaveBeenCalledTimes(6);
    h.stills.setActive(false);
    expect(h.timers.size).toBe(0);
    await h.advance(10 * STILL_REFRESH_MS);
    expect(h.fetchStill).toHaveBeenCalledTimes(6);
    // Stills stay for the next time Home shows; unchanged stills are not re-sent.
    expect(h.changes).toHaveLength(3);
  });

  it('showing Home again soon after a round waits for the next minute instead of fetching at once', async () => {
    const h = harness();
    h.stills.setActive(true); await h.advance(0);
    h.stills.setActive(false); await h.advance(5_000);
    h.stills.setActive(true); await h.advance(0);
    expect(h.fetchStill).toHaveBeenCalledTimes(3);
    await h.advance(STILL_REFRESH_MS - 5_000);
    expect(h.fetchStill).toHaveBeenCalledTimes(6);
    h.stills.setActive(false); await h.advance(STILL_REFRESH_MS);
    h.stills.setActive(true); await h.advance(0);
    expect(h.fetchStill).toHaveBeenCalledTimes(9); // long gone: a fresh round at once
  });

  it('makes no requests at all when no camera can be asked (no Home Assistant set up)', async () => {
    const h = harness({ ids: () => [] });
    h.stills.setActive(true);
    await h.advance(0); await h.advance(STILL_REFRESH_MS);
    expect(h.fetchStill).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
  });

  it('drops a failing camera back to its icon and logs once per failure streak', async () => {
    const h = harness();
    h.stills.setActive(true); await h.advance(0);
    h.fetchStill.mockImplementation(async (id) => { if (id === 'camera-b') throw new Error('offline'); return `data:image/jpeg;base64,${id}2`; });
    await h.advance(STILL_REFRESH_MS);
    expect(h.stills.get('camera-b')).toBeUndefined();
    expect(h.changes).toContainEqual(['camera-b', null]);
    expect(h.log).toHaveBeenCalledOnce();
    expect(h.log.mock.calls[0]![0]).toContain('camera-b');
    await h.advance(STILL_REFRESH_MS);
    await h.advance(STILL_REFRESH_MS);
    expect(h.log).toHaveBeenCalledOnce(); // still failing: no new log line
    h.fetchStill.mockImplementation(async (id) => `data:image/jpeg;base64,${id}3`);
    await h.advance(STILL_REFRESH_MS);
    expect(h.stills.get('camera-b')).toBe('data:image/jpeg;base64,camera-b3');
    h.fetchStill.mockImplementation(async (id) => { if (id === 'camera-b') return null; return `data:image/jpeg;base64,${id}4`; });
    await h.advance(STILL_REFRESH_MS);
    expect(h.log).toHaveBeenCalledTimes(2); // a new streak is logged again
    expect(h.stills.get('camera-b')).toBeUndefined();
  });

  it('gives up on a camera that takes too long, without holding up the others', async () => {
    const h = harness({ timeoutMs: 8_000 });
    h.fetchStill.mockImplementation((id) => id === 'camera-a' ? new Promise(() => undefined) : Promise.resolve(`data:image/jpeg;base64,${id}`));
    h.stills.setActive(true); await h.advance(0);
    expect(Object.keys(h.stills.stills).sort()).toEqual(['camera-b', 'camera-c']);
    await h.advance(8_000);
    expect(h.log).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    expect(h.stills.get('camera-a')).toBeUndefined();
  });

  it('asks only a few cameras at a time', async () => {
    let inFlight = 0; let most = 0;
    const resolvers: (() => void)[] = [];
    const h = harness({ ids: () => Array.from({ length: 8 }, (_, i) => `camera-${i}`), concurrency: 3 });
    h.fetchStill.mockImplementation((id) => new Promise((resolve) => {
      inFlight++; most = Math.max(most, inFlight);
      resolvers.push(() => { inFlight--; resolve(`data:image/jpeg;base64,${id}`); });
    }));
    h.stills.setActive(true); await h.flush();
    expect(h.fetchStill).toHaveBeenCalledTimes(3);
    while (resolvers.length) { resolvers.shift()!(); await h.flush(); await h.flush(); }
    expect(h.fetchStill).toHaveBeenCalledTimes(8);
    expect(most).toBe(3);
  });

  it('stops a round part-way when Home is hidden', async () => {
    const resolvers: (() => void)[] = [];
    const h = harness({ ids: () => ['camera-0', 'camera-1', 'camera-2', 'camera-3'], concurrency: 1 });
    h.fetchStill.mockImplementation((id) => new Promise((resolve) => resolvers.push(() => resolve(`data:image/jpeg;base64,${id}`))));
    h.stills.setActive(true); await h.flush();
    h.stills.setActive(false);
    resolvers.shift()!(); await h.advance(0);
    expect(h.fetchStill).toHaveBeenCalledTimes(1);
    expect(h.timers.size).toBe(0);
  });

  it('forgets cameras that are removed or no longer reachable, and starts afresh on reset', async () => {
    const h = harness();
    h.stills.setActive(true); await h.advance(0);
    h.ids.mockReturnValue(['camera-a']);
    await h.advance(STILL_REFRESH_MS);
    expect(Object.keys(h.stills.stills)).toEqual(['camera-a']);
    expect(h.changes).toContainEqual(['camera-b', null]);
    h.stills.reset();
    expect(h.stills.stills).toEqual({});
    await h.advance(0);
    expect(h.stills.stills).toEqual({ 'camera-a': 'data:image/jpeg;base64,camera-a' });
  });

  it('a reset during a round throws away the old round\'s answers and asks the new cameras at once', async () => {
    const pending: (() => void)[] = [];
    const h = harness({ concurrency: 1 });
    h.ids.mockReturnValue(['camera-old']);
    h.fetchStill.mockImplementation((id) => new Promise((resolve) => pending.push(() => resolve(`data:image/jpeg;base64,${id}`))));
    h.stills.setActive(true); await h.flush();
    expect(h.fetchStill).toHaveBeenLastCalledWith('camera-old');
    h.ids.mockReturnValue(['camera-new']);
    h.stills.reset();
    await h.flush();
    expect(h.fetchStill).toHaveBeenLastCalledWith('camera-new'); // not held up by the old round
    pending.shift()!(); await h.advance(0); // the old answer arrives late
    expect(h.stills.get('camera-old')).toBeUndefined();
    pending.shift()!(); await h.advance(0);
    expect(h.stills.stills).toEqual({ 'camera-new': 'data:image/jpeg;base64,camera-new' });
    expect(h.timers.size).toBe(1); // exactly one next round scheduled
    await h.advance(STILL_REFRESH_MS);
    expect(h.fetchStill).toHaveBeenCalledTimes(3);
  });

  it('ignores anything that is not an image data URL', async () => {
    const h = harness();
    h.fetchStill.mockImplementation(async () => 'https://ha.example/api/camera_proxy/camera.a');
    h.stills.setActive(true); await h.advance(0);
    expect(h.stills.stills).toEqual({});
  });
});
