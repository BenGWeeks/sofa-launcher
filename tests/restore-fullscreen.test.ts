import { describe, expect, it } from 'vitest';
import { parseConfig, SEED_CONFIG } from '../src/main/config';
import { restoreFullscreen } from '../src/main/restore-fullscreen';
import { FakeWindowManager } from '../src/main/windows';

const apps = parseConfig(SEED_CONFIG).apps;
const netflix = apps.find((a) => a.id === 'netflix')!;

function setup() {
  const wm = new FakeWindowManager();
  wm.windows.set(netflix.wmClass, ['10', '11']);
  return wm;
}

describe('restoreFullscreen', () => {
  it('puts back an app window that left full screen', async () => {
    const wm = setup();
    expect(await restoreFullscreen(netflix, wm, { active: false })).toBe(true);
    // The window apps.open activates is the last one.
    expect([...wm.fullscreen]).toEqual(['11']);
  });

  it('leaves a window that is already full screen alone', async () => {
    const wm = setup();
    wm.fullscreen.add('11');
    expect(await restoreFullscreen(netflix, wm, { active: false })).toBe(false);
  });

  it('never resizes either window of a screen-in-screen pair', async () => {
    for (const pip of [{ active: true, baseId: 'netflix', insetId: 'youtube' }, { active: true, baseId: 'youtube', insetId: 'netflix' }]) {
      const wm = setup();
      expect(await restoreFullscreen(netflix, wm, pip)).toBe(false);
      expect(wm.fullscreen.size).toBe(0);
    }
  });

  it('still restores the main app under a pinned camera, and apps outside a pair', async () => {
    expect(await restoreFullscreen(netflix, setup(), { active: true, pinned: true, baseId: 'netflix', insetId: 'camera-cot' })).toBe(true);
    expect(await restoreFullscreen(netflix, setup(), { active: true, baseId: 'youtube', insetId: 'prime' })).toBe(true);
  });

  it('does nothing for apps that never promised full screen, or with no window', async () => {
    const wm = setup();
    expect(await restoreFullscreen({ ...netflix, fullBrowser: true }, wm, { active: false })).toBe(false);
    expect(await restoreFullscreen(netflix, new FakeWindowManager(), { active: false })).toBe(false);
  });

  it('is best effort when the window manager fails', async () => {
    const wm = setup();
    wm.setFullscreen = async () => { throw new Error('no display'); };
    expect(await restoreFullscreen(netflix, wm, { active: false })).toBe(false);
  });
});
