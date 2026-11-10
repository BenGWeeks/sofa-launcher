import { describe, expect, it } from 'vitest';
import { Debouncer } from '../src/main/debounce';
import { moveFocus } from '../src/renderer/src/lib/nav';

describe('Debouncer', () => {
  it('ignores auto-repeat of a held button until it is released for 400 ms', () => {
    let t = 0;
    const d = new Debouncer(400, () => t);
    expect(d.allow('power')).toBe(true);
    for (t = 30; t < 1000; t += 30) expect(d.allow('power')).toBe(false); // held
    t += 500;
    expect(d.allow('power')).toBe(true); // pressed again
  });

  it('debounces each action independently', () => {
    const d = new Debouncer(400, () => 0);
    expect(d.allow('home')).toBe(true);
    expect(d.allow('power')).toBe(true);
  });
});

describe('moveFocus', () => {
  it('moves within a 6-column grid and clamps at the edges', () => {
    expect(moveFocus(0, 'ArrowLeft', 8, 6)).toBe(0);
    expect(moveFocus(0, 'ArrowRight', 8, 6)).toBe(1);
    expect(moveFocus(1, 'ArrowDown', 8, 6)).toBe(7);
    expect(moveFocus(4, 'ArrowDown', 8, 6)).toBe(7);
    expect(moveFocus(7, 'ArrowUp', 8, 6)).toBe(1);
    expect(moveFocus(2, 'ArrowUp', 8, 6)).toBe(2);
    expect(moveFocus(5, 'ArrowRight', 6, 6)).toBe(5);
  });
});
