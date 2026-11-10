import { expect, it, vi } from 'vitest';
import type { AppearanceState } from '../src/shared/types';
import { followAppearance, followAppearanceState } from '../src/renderer/src/lib/appearance';

function setup() {
  let notify!: (state: AppearanceState) => void;
  let resolve!: (state: AppearanceState) => void;
  const off = vi.fn();
  const apply = vi.fn();
  const stop = followAppearance({
    onAppearance: (cb) => { notify = cb; return off; },
    appearance: () => new Promise((done) => { resolve = done; }),
  }, apply);
  return { notify, resolve, apply, off, stop };
}

it('applies initial appearance and live config changes in each renderer', async () => {
  const s = setup();
  s.resolve({ theme: 'knowall', background: 'midnight', version: '0.2.0' });
  await Promise.resolve();
  expect(s.apply).toHaveBeenLastCalledWith('knowall');
  s.notify({ theme: 'nodie', background: 'midnight', version: '0.2.0' });
  expect(s.apply).toHaveBeenLastCalledWith('nodie');
});

it('does not overwrite a live reload with an older initial response', async () => {
  const s = setup();
  s.notify({ theme: 'nodie', background: 'midnight', version: '0.2.0' });
  s.resolve({ theme: 'knowall', background: 'midnight', version: '0.2.0' });
  await Promise.resolve();
  expect(s.apply.mock.calls).toEqual([['nodie']]);
});

it('unsubscribes and ignores pending initial replies on disposal', async () => {
  const s = setup();
  s.stop();
  s.resolve({ theme: 'knowall', background: 'midnight', version: '0.2.0' });
  await Promise.resolve();
  expect(s.apply).not.toHaveBeenCalled();
  expect(s.off).toHaveBeenCalledOnce();
});

it('passes the whole state, including the background, to state followers', async () => {
  let resolve!: (state: AppearanceState) => void;
  const apply = vi.fn();
  followAppearanceState({ onAppearance: () => () => undefined, appearance: () => new Promise((done) => { resolve = done; }) }, apply);
  resolve({ theme: 'nodie', background: 'planet', version: '0.2.0' });
  await Promise.resolve();
  expect(apply).toHaveBeenLastCalledWith({ theme: 'nodie', background: 'planet', version: '0.2.0' });
});
