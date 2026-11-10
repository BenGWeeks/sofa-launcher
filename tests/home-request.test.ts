import { describe, expect, it, vi } from 'vitest';
import { HOME_REQUEST_MARKER, homeRequestWatcher } from '../src/main/home-request';

const noSleep = () => Promise.resolve();

describe('homeRequestWatcher', () => {
  it('reports a home request as soon as the title carries the marker', async () => {
    const titles = ['YouTube on TV', `${HOME_REQUEST_MARKER} YouTube on TV`, 'never read'];
    const title = vi.fn(async () => titles.shift() ?? '');
    await expect(homeRequestWatcher({ title, sleep: noSleep })('7')).resolves.toBe(true);
    expect(title).toHaveBeenCalledTimes(2);
    expect(title).toHaveBeenCalledWith('7');
  });

  it('gives up quietly when the app went back by itself or its window is gone', async () => {
    const title = vi.fn(async () => 'Netflix');
    await expect(homeRequestWatcher({ title, sleep: noSleep, attempts: 3 })('7')).resolves.toBe(false);
    expect(title).toHaveBeenCalledTimes(3);
    await expect(homeRequestWatcher({ title: () => Promise.reject(new Error('gone')), sleep: noSleep, attempts: 2 })('7')).resolves.toBe(false);
  });

  it('lets a newer Back press replace an older watch', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let first = true;
    const watch = homeRequestWatcher({ title: async () => `${HOME_REQUEST_MARKER} x`, sleep: () => (first ? ((first = false), gate) : Promise.resolve()) });
    const older = watch('1');
    const newer = watch('1');
    release();
    await expect(older).resolves.toBe(false);
    await expect(newer).resolves.toBe(true);
  });
});
