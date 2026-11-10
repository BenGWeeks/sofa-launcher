import { describe, expect, it } from 'vitest';
import { Watchdog } from '../src/main/watchdog';
import { FakeWindowManager } from '../src/main/windows';

function setup(opts: { inFront?: boolean } = {}) {
  const wm = new FakeWindowManager();
  let t = 0;
  const gone: [string, boolean][] = [];
  let inFront = opts.inFront ?? false;
  const dog = new Watchdog({
    wm,
    launcherInFront: () => inFront,
    onGone: (id, seen) => gone.push([id, seen]),
    now: () => t,
  });
  return { wm, dog, gone, tick: (ms: number) => (t += ms), setInFront: (v: boolean) => (inFront = v) };
}

describe('Watchdog', () => {
  it('waits out the launch grace period before checking', async () => {
    const { dog, gone, tick } = setup();
    dog.track('netflix', 'sofa-netflix');
    tick(5000);
    await dog.check();
    expect(gone).toEqual([]);
  });

  it('reports an app whose windows have all gone', async () => {
    const { wm, dog, gone, tick } = setup();
    wm.windows.set('sofa-netflix', ['9']);
    dog.track('netflix', 'sofa-netflix');
    tick(11_000);
    await dog.check();
    expect(gone).toEqual([]);
    wm.windows.delete('sofa-netflix');
    tick(3000);
    await dog.check();
    expect(gone).toEqual([['netflix', true]]);
    expect(dog.trackedIds()).toEqual([]);
  });

  it('gives a slow starter 30 s before deciding it never opened', async () => {
    const { dog, gone, tick } = setup();
    dog.track('jellyfin', 'jellyfin-desktop');
    tick(20_000);
    await dog.check();
    expect(gone).toEqual([]);
    tick(11_000);
    await dog.check();
    expect(gone).toEqual([['jellyfin', false]]);
  });

  it('does nothing while the launcher is in front', async () => {
    const { dog, gone, tick, setInFront } = setup({ inFront: true });
    dog.track('netflix', 'sofa-netflix', true);
    tick(60_000);
    await dog.check();
    expect(gone).toEqual([]);
    setInFront(false);
    await dog.check();
    expect(gone).toEqual([['netflix', true]]);
  });

  it('skips a tick when xdotool itself fails, instead of declaring the app gone', async () => {
    const { wm, dog, gone, tick } = setup();
    dog.track('netflix', 'sofa-netflix', true);
    tick(60_000);
    const real = wm.findByClass.bind(wm);
    wm.findByClass = async () => { throw new Error('no DISPLAY'); };
    await dog.check();
    expect(gone).toEqual([]);
    expect(dog.trackedIds()).toEqual(['netflix']);
    wm.findByClass = real;
    await dog.check();
    expect(gone).toEqual([['netflix', true]]);
  });

  it('forgets apps that were closed on purpose', async () => {
    const { dog, gone, tick } = setup();
    dog.track('netflix', 'sofa-netflix', true);
    dog.untrack('netflix');
    tick(60_000);
    await dog.check();
    expect(gone).toEqual([]);
  });
});
